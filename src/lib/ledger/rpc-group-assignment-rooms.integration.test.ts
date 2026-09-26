import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { buildAssignmentExpense } from "@/lib/assignment-room-money";
import type { AssignmentRoomView } from "@/types/assignment-room";
import { decodeAssignmentRoomView } from "@/lib/ledger/decode-assignment-room";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  acceptInvitation,
  authenticateAs,
  createGroup,
  createGroupWithMembers,
  createTestUsers,
  expectRpcError,
  rpcDecoded,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;
type CreateArgs =
  Database["public"]["Functions"]["create_assignment_room"]["Args"];
type RoomView = AssignmentRoomView;

interface OpenRoom {
  id: string;
  title: string;
  occurredOn: string;
  totalCents: number;
  host: { id: string; name: string };
  createdAt: string;
  joined: boolean;
}

interface RoomsResponse {
  rooms: OpenRoom[];
}

const HEADER = {
  title: "Conta do grupo",
  occurredOn: "2026-09-26",
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
const ROOM_TOTAL_CENTS = 4_500;

function existingTarget(groupId: string): Json {
  return { kind: "existing", groupId };
}

function joinToken(fill: string): string {
  return `armj1_${fill.repeat(43)}`;
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
    p_join_token: joinToken("A"),
  };
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

async function claimItem(
  client: Client,
  roomId: string,
  itemId: string,
  itemRevision: number,
  participantId: string,
  ticks: number
): Promise<RoomView> {
  return rpcRoom(client, "set_assignment_room_claim", {
    p_room_id: roomId,
    p_member_token: null,
    p_item_id: itemId,
    p_participant_id: participantId,
    p_expected_item_revision: itemRevision,
    p_ticks: ticks,
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
    view = await claimItem(
      hostClient,
      created.room.id,
      item.id,
      item.revision,
      created.room.selfParticipantId,
      120_000
    );
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

describe.skipIf(!isIntegrationTestReady)(
  "assignment rooms for existing groups",
  () => {
    let host: TestUser;
    let member: TestUser;
    let invitedOnly: TestUser;
    let latecomer: TestUser;
    let outsider: TestUser;
    let leftMember: TestUser;
    let removedMember: TestUser;
    let hostClient: Client;
    let memberClient: Client;
    let invitedOnlyClient: Client;
    let latecomerClient: Client;
    let outsiderClient: Client;
    let leftMemberClient: Client;
    let removedMemberClient: Client;
    let anonClient: Client;
    let groupId: string;
    let otherGroupId: string;

    beforeAll(async () => {
      [host, member, invitedOnly, latecomer, outsider, leftMember, removedMember] =
        await createTestUsers(7);
      hostClient = authenticateAs(host);
      memberClient = authenticateAs(member);
      invitedOnlyClient = authenticateAs(invitedOnly);
      latecomerClient = authenticateAs(latecomer);
      outsiderClient = authenticateAs(outsider);
      leftMemberClient = authenticateAs(leftMember);
      removedMemberClient = authenticateAs(removedMember);
      anonClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );

      const created = await createGroup(host, "Grupo salas", [
        member.id,
        invitedOnly.id,
        latecomer.id,
        leftMember.id,
        removedMember.id,
      ]);
      groupId = created.groupId;
      await acceptInvitation(member, groupId);
      await acceptInvitation(latecomer, groupId);
      await acceptInvitation(leftMember, groupId);
      await acceptInvitation(removedMember, groupId);
      otherGroupId = await createGroupWithMembers(host, [member], "Outro grupo");
    });

    it("lists the group's open rooms newest first with exactly the documented keys", async () => {
      const older = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      const newer = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));

      const list = await rpc<RoomsResponse>(memberClient, "list_open_assignment_rooms", {
        p_group_id: groupId,
      });
      const ids = list.rooms.map((room) => room.id);
      expect(ids.indexOf(newer.room.id)).toBeLessThan(ids.indexOf(older.room.id));

      const entry = list.rooms.find((room) => room.id === newer.room.id);
      expect(entry).toBeDefined();
      expect(Object.keys(entry!).sort()).toEqual([
        "createdAt",
        "host",
        "id",
        "joined",
        "occurredOn",
        "title",
        "totalCents",
      ]);
      expect(entry!.title).toBe(HEADER.title);
      expect(entry!.occurredOn).toBe(HEADER.occurredOn);
      expect(entry!.totalCents).toBe(ROOM_TOTAL_CENTS);
      expect(entry!.host.id).toBe(host.id);
      expect(entry!.host.name).toBe(host.name);
      expect(typeof entry!.createdAt).toBe("string");
      expect(entry!.joined).toBe(false);
    });

    it("reports joined false for members, true for the host, and true after entering", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));

      const before = await rpc<RoomsResponse>(memberClient, "list_open_assignment_rooms", {
        p_group_id: groupId,
      });
      expect(before.rooms.find((room) => room.id === created.room.id)?.joined).toBe(false);

      const hostList = await rpc<RoomsResponse>(hostClient, "list_open_assignment_rooms", {
        p_group_id: groupId,
      });
      expect(hostList.rooms.find((room) => room.id === created.room.id)?.joined).toBe(true);

      await enterRoom(memberClient, created.room.id, memberToken());

      const after = await rpc<RoomsResponse>(memberClient, "list_open_assignment_rooms", {
        p_group_id: groupId,
      });
      expect(after.rooms.find((room) => room.id === created.room.id)?.joined).toBe(true);
    });

    it("excludes closed, cancelled, finalized, other-group and new-target rooms", async () => {
      const closed = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      const claimedClosed = await claimEveryItemAsHost(hostClient, closed);
      await closeRoom(hostClient, closed.room.id, claimedClosed.room.revision);

      const cancelled = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      await rpc(hostClient, "cancel_assignment_room", {
        p_room_id: cancelled.room.id,
        p_expected_revision: cancelled.room.revision,
      });

      const finalized = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      await finalizeRoom(hostClient, finalized);

      const otherGroup = await createRoom(
        hostClient,
        roomArgs(host, existingTarget(otherGroupId))
      );
      const newTarget = await createRoom(
        hostClient,
        roomArgs(host, { kind: "new", name: "Sala nova" })
      );

      const excluded = [
        closed.room.id,
        cancelled.room.id,
        finalized.room.id,
        otherGroup.room.id,
        newTarget.room.id,
      ];
      const list = await rpc<RoomsResponse>(memberClient, "list_open_assignment_rooms", {
        p_group_id: groupId,
      });
      const ids = list.rooms.map((room) => room.id);
      for (const roomId of excluded) {
        expect(ids).not.toContain(roomId);
      }
    });

    it("refuses list and enter to invited-only members, outsiders and anon", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));

      await expect(
        expectRpcError(
          invitedOnlyClient.rpc("list_open_assignment_rooms", { p_group_id: groupId })
        )
      ).resolves.toContain("not_a_member");
      await expect(
        expectRpcError(
          outsiderClient.rpc("list_open_assignment_rooms", { p_group_id: groupId })
        )
      ).resolves.toContain("not_a_member");

      await expect(
        expectRpcError(
          anonClient.rpc("list_open_assignment_rooms", { p_group_id: groupId })
        )
      ).resolves.toMatch(/permission denied/);
      await expect(
        expectRpcError(
          anonClient.rpc("enter_group_assignment_room", {
            p_room_id: created.room.id,
            p_member_token: memberToken(),
          })
        )
      ).resolves.toMatch(/permission denied/);
    });

    it("admits a member by membership and the issued token claims their own item", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      const token = memberToken();

      const view = await enterRoom(memberClient, created.room.id, token);
      expect(view.role).toBe("participant");
      const self = view.room.participants.find(
        (participant) => participant.id === view.room.selfParticipantId
      );
      expect(self?.displayName).toBe(member.name);
      expect(self?.isGuest).toBe(false);
      expect(self?.removed).toBe(false);

      const item = view.room.items[0];
      const claimed = await rpcRoom(memberClient, "set_assignment_room_claim", {
        p_room_id: created.room.id,
        p_member_token: token,
        p_item_id: item.id,
        p_participant_id: view.room.selfParticipantId,
        p_expected_item_revision: item.revision,
        p_ticks: 60_000,
      });
      expect(claimed.room.claims).toContainEqual({
        itemId: item.id,
        participantId: view.room.selfParticipantId,
        ticks: 60_000,
      });
    });

    it("rotates the member token on re-enter and retires the old one", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      const firstToken = memberToken();
      const first = await enterRoom(memberClient, created.room.id, firstToken);
      const secondToken = memberToken();
      const second = await enterRoom(memberClient, created.room.id, secondToken);

      expect(second.room.selfParticipantId).toBe(first.room.selfParticipantId);
      expect(second.room.participants.filter((p) => !p.removed)).toEqual(
        first.room.participants.filter((p) => !p.removed)
      );

      const item = second.room.items[0];
      await expect(
        expectRpcError(
          memberClient.rpc("set_assignment_room_claim", {
            p_room_id: created.room.id,
            p_member_token: firstToken,
            p_item_id: item.id,
            p_participant_id: second.room.selfParticipantId,
            p_expected_item_revision: item.revision,
            p_ticks: 60_000,
          })
        )
      ).resolves.toContain("invalid_token");
    });

    it("refuses outsiders, invited-only members and new-target rooms with not_a_member", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));

      await expect(
        expectRpcError(
          outsiderClient.rpc("enter_group_assignment_room", {
            p_room_id: created.room.id,
            p_member_token: memberToken(),
          })
        )
      ).resolves.toContain("not_a_member");

      await expect(
        expectRpcError(
          invitedOnlyClient.rpc("enter_group_assignment_room", {
            p_room_id: created.room.id,
            p_member_token: memberToken(),
          })
        )
      ).resolves.toContain("not_a_member");

      const newTarget = await createRoom(
        hostClient,
        roomArgs(host, { kind: "new", name: "Sala nova" })
      );
      await expect(
        expectRpcError(
          memberClient.rpc("enter_group_assignment_room", {
            p_room_id: newTarget.room.id,
            p_member_token: memberToken(),
          })
        )
      ).resolves.toContain("not_a_member");
    });

    it("rejects malformed tokens with invalid_token and unknown rooms with room_not_found", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));

      await expect(
        expectRpcError(
          memberClient.rpc("enter_group_assignment_room", {
            p_room_id: created.room.id,
            p_member_token: "not-a-token",
          })
        )
      ).resolves.toContain("invalid_token");

      await expect(
        expectRpcError(
          memberClient.rpc("enter_group_assignment_room", {
            p_room_id: crypto.randomUUID(),
            p_member_token: memberToken(),
          })
        )
      ).resolves.toContain("room_not_found");
    });

    it("gives room_closed to new participants on a closed room but lets participants re-enter", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      const firstToken = memberToken();
      const first = await enterRoom(memberClient, created.room.id, firstToken);

      const claimed = await claimEveryItemAsHost(hostClient, created);
      await closeRoom(hostClient, created.room.id, claimed.room.revision);

      await expect(
        expectRpcError(
          latecomerClient.rpc("enter_group_assignment_room", {
            p_room_id: created.room.id,
            p_member_token: memberToken(),
          })
        )
      ).resolves.toContain("room_closed");

      const reEntered = await enterRoom(memberClient, created.room.id, memberToken());
      expect(reEntered.room.selfParticipantId).toBe(first.room.selfParticipantId);
      expect(reEntered.room.status).toBe("closed");
    });

    it("gives room_cancelled to a member of a cancelled room", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      const joined = await enterRoom(memberClient, created.room.id, memberToken());
      await rpc(hostClient, "cancel_assignment_room", {
        p_room_id: created.room.id,
        p_expected_revision: joined.room.revision,
      });

      await expect(
        expectRpcError(
          memberClient.rpc("enter_group_assignment_room", {
            p_room_id: created.room.id,
            p_member_token: memberToken(),
          })
        )
      ).resolves.toContain("room_cancelled");

      await expect(
        expectRpcError(
          latecomerClient.rpc("enter_group_assignment_room", {
            p_room_id: created.room.id,
            p_member_token: memberToken(),
          })
        )
      ).resolves.toContain("room_cancelled");
    });

    it("keeps a host-removed participant out with invalid_token", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      const view = await enterRoom(memberClient, created.room.id, memberToken());

      await rpc(hostClient, "remove_assignment_room_participant", {
        p_room_id: created.room.id,
        p_participant_id: view.room.selfParticipantId,
        p_expected_revision: view.room.revision,
        p_join_token: joinToken("A"),
      });

      await expect(
        expectRpcError(
          memberClient.rpc("enter_group_assignment_room", {
            p_room_id: created.room.id,
            p_member_token: memberToken(),
          })
        )
      ).resolves.toContain("invalid_token");
    });

    it("hides a room from the list of a member the host removed, others still see it", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      const view = await enterRoom(memberClient, created.room.id, memberToken());

      const before = await rpc<RoomsResponse>(memberClient, "list_open_assignment_rooms", {
        p_group_id: groupId,
      });
      expect(before.rooms.some((room) => room.id === created.room.id)).toBe(true);

      await rpc(hostClient, "remove_assignment_room_participant", {
        p_room_id: created.room.id,
        p_participant_id: view.room.selfParticipantId,
        p_expected_revision: view.room.revision,
        p_join_token: joinToken("A"),
      });

      const after = await rpc<RoomsResponse>(memberClient, "list_open_assignment_rooms", {
        p_group_id: groupId,
      });
      expect(after.rooms.some((room) => room.id === created.room.id)).toBe(false);

      const latecomerList = await rpc<RoomsResponse>(latecomerClient, "list_open_assignment_rooms", {
        p_group_id: groupId,
      });
      expect(latecomerList.rooms.some((room) => room.id === created.room.id)).toBe(true);
    });

    it("returns the same participant when the identical token is retried", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      const token = memberToken();
      const first = await enterRoom(memberClient, created.room.id, token);
      const retry = await enterRoom(memberClient, created.room.id, token);

      expect(retry.room.selfParticipantId).toBe(first.room.selfParticipantId);
      expect(retry.room.participants.filter((p) => !p.removed)).toEqual(
        first.room.participants.filter((p) => !p.removed)
      );
    });

    it("lets an existing participant re-enter a finalized room", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      const first = await enterRoom(memberClient, created.room.id, memberToken());
      await finalizeRoom(hostClient, created);

      const reEntered = await enterRoom(memberClient, created.room.id, memberToken());
      expect(reEntered.room.selfParticipantId).toBe(first.room.selfParticipantId);
      expect(reEntered.room.status).toBe("finalized");
    });

    it("caps active participants at 50", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      await withPg((client) =>
        client.query(
          "insert into public.assignment_room_participants " +
            "(room_id, id, ordinal, display_name, user_id) " +
            "select $1, gen_random_uuid(), ordinal, 'Convidado ' || ordinal, null " +
            "from generate_series(1, 49) as ordinal",
          [created.room.id]
        )
      );

      await expect(
        expectRpcError(
          memberClient.rpc("enter_group_assignment_room", {
            p_room_id: created.room.id,
            p_member_token: memberToken(),
          })
        )
      ).resolves.toContain("too_many_participants");
    });

    it("denies list and enter to members who left or were removed", async () => {
      await rpc(leftMemberClient, "leave_group", { p_group_id: groupId });
      await rpc(hostClient, "remove_member", {
        p_group_id: groupId,
        p_user_id: removedMember.id,
      });
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));

      for (const client of [leftMemberClient, removedMemberClient]) {
        await expect(
          expectRpcError(client.rpc("list_open_assignment_rooms", { p_group_id: groupId }))
        ).resolves.toContain("not_a_member");
        await expect(
          expectRpcError(
            client.rpc("enter_group_assignment_room", {
              p_room_id: created.room.id,
              p_member_token: memberToken(),
            })
          )
        ).resolves.toContain("not_a_member");
      }
    });
  }
);
