import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { buildAssignmentExpense } from "@/lib/assignment-room-money";
import type { AssignmentRoomView, OpenAssignmentRoom } from "@/types/assignment-room";
import { decodeMutationAck } from "@/lib/ledger/decode";
import {
  decodeAssignmentRoomView,
  decodeOpenAssignmentRooms,
} from "@/lib/ledger/decode-assignment-room";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  acceptInvitation,
  authenticateAs,
  createGroup,
  createGroupWithMembers,
  createTestUsers,
  decodeRpcData,
  expectRpcError,
  rpcDecoded,
  type TestUser,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;
type CreateArgs = Database["public"]["Functions"]["create_assignment_room"]["Args"];
type RoomView = AssignmentRoomView;

const HEADER = {
  title: "Conta do grupo",
  occurredOn: "2026-10-03",
  serviceFeeBasisPoints: 1_000,
  fixedFeeCents: 100,
};
const ITEMS = [
  {
    description: "Pizza",
    quantityMilliunits: 1_000,
    unitPriceCents: 4_000,
    totalPriceCents: 4_000,
  },
];

function joinToken(): string {
  const random = (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", "");
  return `armj1_${random.slice(0, 43)}`;
}

function memberToken(): string {
  const random = crypto.randomUUID().replaceAll("-", "") + "AAAAAAAAAAA";
  return `armm1_${random}`;
}

function roomArgs(host: TestUser, groupTarget: Json): CreateArgs {
  return {
    p_room_id: crypto.randomUUID(),
    p_group_target: groupTarget,
    p_header: HEADER,
    p_items: ITEMS,
    p_participants: [
      { id: crypto.randomUUID(), displayName: host.name, userId: host.id },
    ],
    p_join_token: joinToken(),
  };
}

function existingTarget(groupId: string): Json {
  return { kind: "existing", groupId };
}

async function rpc<T>(
  client: Client,
  name: keyof Database["public"]["Functions"],
  args: Record<string, unknown>
): Promise<T> {
  const { data, error } = await client.rpc(name, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

async function rpcRoom(
  client: Client,
  name: keyof Database["public"]["Functions"],
  args: Record<string, unknown>
): Promise<RoomView> {
  return rpcDecoded(client, name, args as never, decodeAssignmentRoomView);
}

async function createRoom(client: Client, args: CreateArgs): Promise<RoomView> {
  return rpcRoom(client, "create_assignment_room", args);
}

async function listMyRooms(client: Client): Promise<OpenAssignmentRoom[]> {
  return rpcDecoded(
    client,
    "list_my_open_assignment_rooms",
    {},
    decodeOpenAssignmentRooms
  );
}

async function listGroupRooms(
  client: Client,
  groupId: string
): Promise<OpenAssignmentRoom[]> {
  return rpcDecoded(
    client,
    "list_open_assignment_rooms",
    { p_group_id: groupId },
    decodeOpenAssignmentRooms
  );
}

async function enterRoom(
  client: Client,
  roomId: string,
  token: string
): Promise<RoomView> {
  return rpcRoom(client, "enter_group_assignment_room", {
    p_room_id: roomId,
    p_member_token: token,
  });
}

async function closeRoom(
  client: Client,
  roomId: string,
  expectedRevision: number
): Promise<RoomView> {
  return rpcRoom(client, "close_assignment_room", {
    p_room_id: roomId,
    p_expected_revision: expectedRevision,
  });
}

async function claimEveryItemAsHost(
  hostClient: Client,
  created: RoomView
): Promise<RoomView> {
  let view = created;
  for (const item of created.room.items) {
    view = await rpcRoom(hostClient, "set_assignment_room_claim", {
      p_room_id: created.room.id,
      p_member_token: null,
      p_item_id: item.id,
      p_participant_id: created.room.selfParticipantId,
      p_expected_item_revision: item.revision,
      p_ticks: 120_000,
    });
  }
  return view;
}

async function finalizeRoom(hostClient: Client, created: RoomView): Promise<void> {
  const claimed = await claimEveryItemAsHost(hostClient, created);
  const closed = await closeRoom(hostClient, created.room.id, claimed.room.revision);
  if (closed.role !== "host") {
    throw new Error("expected a host view after closing the room");
  }
  const built = buildAssignmentExpense(closed, [
    { participantIndex: 0, amountCents: closed.room.totalCents },
  ]);
  if (!built.ok) throw new Error(JSON.stringify(built.issue));
  await rpc(hostClient, "finalize_assignment_room", {
    p_room_id: created.room.id,
    p_expected_revision: closed.room.revision,
    p_payload: built.value,
  });
}

function byNewestFirst(a: OpenAssignmentRoom, b: OpenAssignmentRoom): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

describe.skipIf(!isIntegrationTestReady)("my open assignment rooms", () => {
  let viewer: TestUser;
  let host: TestUser;
  let stranger: TestUser;
  let outsider: TestUser;
  let blockedHost: TestUser;
  let bystander: TestUser;
  let pendingMember: TestUser;
  let departingMember: TestUser;
  let viewerClient: Client;
  let hostClient: Client;
  let strangerClient: Client;
  let blockedHostClient: Client;
  let bystanderClient: Client;
  let departingClient: Client;
  let anonClient: Client;
  let groupA: string;
  let groupB: string;
  let groupC: string;
  let groupD: string;
  let groupE: string;
  let dmId: string;
  let roomOpen: string;
  let roomJoined: string;
  let roomRemoved: string;
  let roomCancelled: string;
  let roomFinalized: string;
  let roomOutsider: string;
  let roomDm: string;
  let roomBlocked: string;
  let roomE: string;
  let cappedRoomIds: string[];

  beforeAll(async () => {
    [viewer, host, stranger, outsider, blockedHost, bystander, pendingMember, departingMember] =
      await createTestUsers(8);
    viewerClient = authenticateAs(viewer);
    hostClient = authenticateAs(host);
    strangerClient = authenticateAs(stranger);
    blockedHostClient = authenticateAs(blockedHost);
    bystanderClient = authenticateAs(bystander);
    departingClient = authenticateAs(departingMember);
    anonClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    groupA = await createGroupWithMembers(host, [viewer], "Grupo A");
    groupB = await createGroupWithMembers(stranger, [outsider], "Grupo B");
    groupC = await createGroupWithMembers(host, [viewer], "Grupo C");
    groupD = await createGroupWithMembers(blockedHost, [viewer, bystander], "Grupo D");
    groupE = (
      await createGroup(host, "Grupo E", [
        viewer.id,
        pendingMember.id,
        departingMember.id,
      ])
    ).groupId;
    await acceptInvitation(viewer, groupE);
    await acceptInvitation(departingMember, groupE);

    const { data: dmData, error: dmError } = await hostClient.rpc("get_or_create_dm", {
      p_user_id: viewer.id,
    });
    if (dmError) throw new Error(dmError.message);
    const dmAck = decodeRpcData("get_or_create_dm", dmData, decodeMutationAck);
    if (!dmAck.groupId) throw new Error("get_or_create_dm returned no groupId");
    dmId = dmAck.groupId;
    await acceptInvitation(viewer, dmId);

    const openCreated = await createRoom(hostClient, roomArgs(host, existingTarget(groupA)));
    roomOpen = openCreated.room.id;
    const joinedCreated = await createRoom(hostClient, roomArgs(host, existingTarget(groupA)));
    roomJoined = joinedCreated.room.id;
    await enterRoom(viewerClient, roomJoined, memberToken());

    const removedArgs = roomArgs(host, existingTarget(groupA));
    const removedCreated = await createRoom(hostClient, removedArgs);
    roomRemoved = removedCreated.room.id;
    const entered = await enterRoom(viewerClient, roomRemoved, memberToken());
    await rpc(hostClient, "remove_assignment_room_participant", {
      p_room_id: roomRemoved,
      p_participant_id: entered.room.selfParticipantId,
      p_expected_revision: entered.room.revision,
      p_join_token: removedArgs.p_join_token,
    });

    const cancelledCreated = await createRoom(hostClient, roomArgs(host, existingTarget(groupA)));
    roomCancelled = cancelledCreated.room.id;
    await rpc(hostClient, "cancel_assignment_room", {
      p_room_id: roomCancelled,
      p_expected_revision: cancelledCreated.room.revision,
    });

    const finalizedCreated = await createRoom(hostClient, roomArgs(host, existingTarget(groupA)));
    roomFinalized = finalizedCreated.room.id;
    await finalizeRoom(hostClient, finalizedCreated);

    const outsiderCreated = await createRoom(
      strangerClient,
      roomArgs(stranger, existingTarget(groupB))
    );
    roomOutsider = outsiderCreated.room.id;

    const dmCreated = await createRoom(hostClient, roomArgs(host, existingTarget(dmId)));
    roomDm = dmCreated.room.id;

    const blockedCreated = await createRoom(
      blockedHostClient,
      roomArgs(blockedHost, existingTarget(groupD))
    );
    roomBlocked = blockedCreated.room.id;
    const { error: blockError } = await blockedHostClient.rpc("block_user", {
      p_user_id: viewer.id,
    });
    if (blockError) throw new Error(blockError.message);

    const groupECreated = await createRoom(hostClient, roomArgs(host, existingTarget(groupE)));
    roomE = groupECreated.room.id;

    cappedRoomIds = [];
    for (let i = 0; i < 21; i += 1) {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupC)));
      cappedRoomIds.push(created.room.id);
    }
  });

  it("lists open rooms from groups and DMs with the caller's joined flag", async () => {
    const rooms = await listMyRooms(viewerClient);
    const [firstRoom] = rooms;

    expect(Object.keys(firstRoom ?? {}).sort()).toEqual([
      "claimers",
      "createdAt",
      "expenseId",
      "groupId",
      "host",
      "id",
      "itemCount",
      "joined",
      "occurredOn",
      "ownedItemCount",
      "revision",
      "status",
      "title",
      "totalCents",
    ]);

    const knownRooms = rooms.filter(
      (room) =>
        room.id === roomOpen ||
        room.id === roomJoined ||
        room.id === roomDm ||
        room.id === roomOutsider ||
        room.id === roomBlocked
    );
    expect(knownRooms).toEqual([
      expect.objectContaining({ id: roomDm, groupId: dmId, joined: false }),
      expect.objectContaining({ id: roomJoined, groupId: groupA, joined: true }),
      expect.objectContaining({ id: roomOpen, groupId: groupA, joined: false }),
    ]);
    expect(rooms.some((room) => room.id === roomOutsider)).toBe(false);
    expect(rooms.some((room) => room.id === roomBlocked)).toBe(false);
    expect(rooms.some((room) => room.id === roomRemoved)).toBe(false);

    const ids = rooms.map((room) => room.id);
    expect(ids).toEqual([...rooms].sort(byNewestFirst).map((room) => room.id));
  });

  it("excludes finalized and cancelled rooms", async () => {
    const rooms = await listMyRooms(viewerClient);

    expect(rooms.some((room) => room.id === roomFinalized)).toBe(false);
    expect(rooms.some((room) => room.id === roomCancelled)).toBe(false);
  });

  it("skips rooms in groups the caller never joined, while members still see them", async () => {
    const viewerRooms = await listMyRooms(viewerClient);
    expect(viewerRooms.some((room) => room.id === roomOutsider)).toBe(false);

    const strangerRooms = await listMyRooms(strangerClient);
    expect(strangerRooms).toEqual([
      expect.objectContaining({ id: roomOutsider, groupId: groupB, joined: true }),
    ]);
  });

  it("matches list_open_assignment_rooms for one group, including removal exclusions", async () => {
    const mine = await listMyRooms(viewerClient);
    const perGroup = await listGroupRooms(viewerClient, groupA);

    expect(mine.filter((room) => room.groupId === groupA)).toEqual(perGroup);
    expect(perGroup.map((room) => room.id)).toEqual([roomJoined, roomOpen]);
  });

  it("hides a group's rooms from an invited member and from a member who left", async () => {
    const pendingRooms = await listMyRooms(authenticateAs(pendingMember));
    expect(pendingRooms.some((room) => room.id === roomE)).toBe(false);

    const departingBefore = await listMyRooms(departingClient);
    expect(departingBefore).toEqual([
      expect.objectContaining({ id: roomE, groupId: groupE, joined: false }),
    ]);

    await rpc(departingClient, "leave_group", { p_group_id: groupE });

    const departingAfter = await listMyRooms(departingClient);
    expect(departingAfter.some((room) => room.id === roomE)).toBe(false);
  });

  it("caps each group at the 20 newest rooms and keeps every other group", async () => {
    const mine = await listMyRooms(viewerClient);
    const perGroup = await listGroupRooms(viewerClient, groupC);
    const capped = mine.filter((room) => room.groupId === groupC);

    expect(cappedRoomIds).toHaveLength(21);
    expect(capped).toEqual(perGroup);
    expect(capped).toHaveLength(20);
    expect(capped.some((room) => room.id === cappedRoomIds[0])).toBe(false);
    expect(mine.some((room) => room.id === roomDm)).toBe(true);
  });

  it("hides a blocked host's room and agrees with the per-group list", async () => {
    const mine = await listMyRooms(viewerClient);
    const perGroup = await listGroupRooms(viewerClient, groupD);

    expect(mine.filter((room) => room.groupId === groupD)).toEqual(perGroup);
    expect(perGroup).toEqual([]);

    const bystanderRooms = await listMyRooms(bystanderClient);
    expect(bystanderRooms).toEqual([
      expect.objectContaining({ id: roomBlocked, groupId: groupD, joined: false }),
    ]);
  });

  it("returns an empty list for an account without groups", async () => {
    const [lonely] = await createTestUsers(1);
    const rooms = await listMyRooms(authenticateAs(lonely));
    expect(rooms).toEqual([]);
  });

  it("refuses anonymous callers", async () => {
    await expect(
      expectRpcError(anonClient.rpc("list_my_open_assignment_rooms"))
    ).resolves.toMatch(/permission denied/);
  });
});
