import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { buildAssignmentExpense } from "@/lib/assignment-room-money";
import type { AssignmentRoomView, HostedAssignmentRoom } from "@/types/assignment-room";
import {
  decodeAssignmentRoomView,
  decodeHostedAssignmentRooms,
} from "@/lib/ledger/decode-assignment-room";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  acceptInvitation,
  authenticateAs,
  createGroup,
  createTestUsers,
  expectRpcError,
  rpcDecoded,
  type TestUser,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;
type CreateArgs = Database["public"]["Functions"]["create_assignment_room"]["Args"];

const HEADER = {
  title: "Bar do Zé",
  occurredOn: "2026-09-27",
  serviceFeeBasisPoints: 1_000,
  fixedFeeCents: 100,
};
const ITEMS = [
  { description: "Pizza", quantityMilliunits: 1_000, unitPriceCents: 4_000, totalPriceCents: 4_000 },
  { description: "Suco", quantityMilliunits: 1_000, unitPriceCents: 1_000, totalPriceCents: 1_000 },
];
const ROOM_TOTAL_CENTS = 5_600;
const JOIN_TOKEN = `armj1_${"H".repeat(43)}`;

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
    p_participants: [{ id: crypto.randomUUID(), displayName: host.name, userId: host.id }],
    p_join_token: JOIN_TOKEN,
  };
}

function rpcRoom(
  client: Client,
  name: keyof Database["public"]["Functions"],
  args: Record<string, unknown>,
): Promise<AssignmentRoomView> {
  return rpcDecoded(client, name, args as never, decodeAssignmentRoomView);
}

function listHosted(client: Client): Promise<HostedAssignmentRoom[]> {
  return rpcDecoded(client, "list_hosted_assignment_rooms", {} as never, decodeHostedAssignmentRooms);
}

async function claimEveryItem(client: Client, created: AssignmentRoomView): Promise<AssignmentRoomView> {
  let view = created;
  for (const item of created.room.items) {
    view = await rpcRoom(client, "set_assignment_room_claim", {
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

async function closeRoom(client: Client, view: AssignmentRoomView): Promise<AssignmentRoomView> {
  return rpcRoom(client, "close_assignment_room", {
    p_room_id: view.room.id,
    p_expected_revision: view.room.revision,
  });
}

describe.skipIf(!isIntegrationTestReady)("rooms a host can get back to", () => {
  let host: TestUser;
  let member: TestUser;
  let joiner: TestUser;
  let hostClient: Client;
  let memberClient: Client;
  let joinerClient: Client;
  let anonClient: Client;
  let groupId: string;

  beforeAll(async () => {
    [host, member, joiner] = await createTestUsers(3);
    hostClient = authenticateAs(host);
    memberClient = authenticateAs(member);
    joinerClient = authenticateAs(joiner);
    anonClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    groupId = (await createGroup(host, "Viagem Floripa", [member.id])).groupId;
    await acceptInvitation(member, groupId);
  });

  it("lists open rooms with and without a group, newest first, with live progress", async () => {
    const grouped = await rpcRoom(hostClient, "create_assignment_room", roomArgs(host, { kind: "existing", groupId }));
    const standalone = await rpcRoom(hostClient, "create_assignment_room", roomArgs(host, { kind: "new", name: "Bar do Zé" }));
    const pizza = standalone.room.items[0];
    await rpcRoom(hostClient, "set_assignment_room_claim", {
      p_room_id: standalone.room.id,
      p_member_token: null,
      p_item_id: pizza.id,
      p_participant_id: standalone.room.selfParticipantId,
      p_expected_item_revision: pizza.revision,
      p_ticks: 120_000,
    });

    const rooms = await listHosted(hostClient);
    const ids = rooms.map((room) => room.id);
    expect(ids.indexOf(standalone.room.id)).toBeLessThan(ids.indexOf(grouped.room.id));

    const listedStandalone = rooms.find((room) => room.id === standalone.room.id);
    expect(listedStandalone).toMatchObject({
      groupId: null,
      groupName: null,
      status: "open",
      title: "Bar do Zé",
      totalCents: ROOM_TOTAL_CENTS,
      itemCount: 2,
      ownedItemCount: 1,
      host: { id: host.id },
      claimers: [{ userId: host.id }],
      expenseId: null,
    });
    expect(rooms.find((room) => room.id === grouped.room.id)).toMatchObject({
      groupId,
      groupName: "Viagem Floripa",
      status: "open",
      ownedItemCount: 0,
      claimers: [],
    });
  });

  it("keeps rooms in review and drops finalized and cancelled ones", async () => {
    const closing = await rpcRoom(hostClient, "create_assignment_room", roomArgs(host, { kind: "new", name: "Revisão" }));
    const closed = await closeRoom(hostClient, await claimEveryItem(hostClient, closing));

    const cancelling = await rpcRoom(hostClient, "create_assignment_room", roomArgs(host, { kind: "new", name: "Cancelada" }));
    await rpcRoom(hostClient, "cancel_assignment_room", {
      p_room_id: cancelling.room.id,
      p_expected_revision: cancelling.room.revision,
    });

    const finalizing = await rpcRoom(hostClient, "create_assignment_room", roomArgs(host, { kind: "existing", groupId }));
    const toFinalize = await closeRoom(hostClient, await claimEveryItem(hostClient, finalizing));
    if (toFinalize.role !== "host") throw new Error("expected a host view after closing");
    const built = buildAssignmentExpense(toFinalize, [
      { participantIndex: 0, amountCents: toFinalize.room.totalCents },
    ]);
    if (!built.ok) throw new Error(JSON.stringify(built.issue));
    const finalized = await hostClient.rpc("finalize_assignment_room", {
      p_room_id: toFinalize.room.id,
      p_expected_revision: toFinalize.room.revision,
      p_payload: built.value as unknown as Json,
    });
    expect(finalized.error).toBeNull();

    const rooms = await listHosted(hostClient);
    expect(rooms.find((room) => room.id === closed.room.id)?.status).toBe("closed");
    const ids = rooms.map((room) => room.id);
    expect(ids).not.toContain(cancelling.room.id);
    expect(ids).not.toContain(finalizing.room.id);
  });

  it("never lists a room to people who only joined it", async () => {
    const grouped = await rpcRoom(hostClient, "create_assignment_room", roomArgs(host, { kind: "existing", groupId }));
    await rpcRoom(memberClient, "enter_group_assignment_room", {
      p_room_id: grouped.room.id,
      p_member_token: memberToken(),
    });
    const standalone = await rpcRoom(hostClient, "create_assignment_room", roomArgs(host, { kind: "new", name: "Bar" }));
    await rpcRoom(joinerClient, "join_assignment_room", {
      p_room_id: standalone.room.id,
      p_join_token: JOIN_TOKEN,
      p_member_token: memberToken(),
      p_display_name: joiner.name,
    });

    await expect(listHosted(memberClient)).resolves.toEqual([]);
    await expect(listHosted(joinerClient)).resolves.toEqual([]);
  });

  it("hides the group's name once the host is no longer a member", async () => {
    const [leaver] = await createTestUsers(1);
    const leaverClient = authenticateAs(leaver);
    const ownGroupId = (await createGroup(host, "Churrasco", [leaver.id])).groupId;
    await acceptInvitation(leaver, ownGroupId);
    const created = await rpcRoom(leaverClient, "create_assignment_room", roomArgs(leaver, { kind: "existing", groupId: ownGroupId }));
    expect((await listHosted(leaverClient))[0]).toMatchObject({ id: created.room.id, groupName: "Churrasco" });

    const left = await leaverClient.rpc("leave_group", { p_group_id: ownGroupId });
    expect(left.error).toBeNull();

    expect((await listHosted(leaverClient))[0]).toMatchObject({
      id: created.room.id,
      groupId: ownGroupId,
      groupName: null,
    });
  });

  it("denies anonymous callers", async () => {
    await expect(
      expectRpcError(anonClient.rpc("list_hosted_assignment_rooms")),
    ).resolves.toMatch(/permission denied/);
  });
});
