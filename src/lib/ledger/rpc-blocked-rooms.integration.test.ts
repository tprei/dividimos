import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { ExpensePayload } from "@/types/ledger";
import { buildAssignmentExpense } from "@/lib/assignment-room-money";
import {
  decodeAssignmentRoomView,
  decodeFinalizeAssignmentRoomResult,
  decodeOpenAssignmentRooms,
} from "@/lib/ledger/decode-assignment-room";
import type { AssignmentRoomView } from "@/types/assignment-room";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUser,
  createTestUsers,
  expectRpcError,
  rpcDecoded,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

type Client = SupabaseClient<Database>;

const header = {
  title: "Almoço",
  occurredOn: "2026-09-26",
  serviceFeeBasisPoints: 1_000,
  fixedFeeCents: 100,
};

const items = [
  {
    description: "Prato",
    quantityMilliunits: 1_000,
    unitPriceCents: 2_500,
    totalPriceCents: 2_500,
  },
];

function joinToken(fill = "A"): string {
  return `armj1_${fill.repeat(43)}`;
}

function participant(
  user: TestUser,
  overrides: { displayName?: string } = {},
): Json {
  return {
    id: crypto.randomUUID(),
    displayName: user.name,
    userId: user.id,
    ...overrides,
  };
}

function guestParticipant(displayName: string): Json {
  return { id: crypto.randomUUID(), displayName, userId: null };
}

interface RoomCall {
  roomId: string;
  groupTarget: Json;
  participants: Json[];
  joinToken: string;
}

function roomCall(overrides: Partial<RoomCall> = {}): RoomCall {
  return {
    roomId: crypto.randomUUID(),
    groupTarget: { kind: "new", name: "Viagem" },
    participants: [],
    joinToken: joinToken(),
    ...overrides,
  };
}

async function rpcRoom(
  client: Client,
  name: keyof Database["public"]["Functions"],
  args: Record<string, unknown>,
): Promise<RoomView> {
  return rpcDecoded(client, name, args, decodeAssignmentRoomView);
}

async function createRoom(
  client: Client,
  call: RoomCall,
): Promise<RoomView> {
  return rpcRoom(client, "create_assignment_room", {
    p_room_id: call.roomId,
    p_group_target: call.groupTarget,
    p_header: header,
    p_items: items,
    p_participants: call.participants,
    p_join_token: call.joinToken,
  });
}

async function roomRowCounts(roomId: string): Promise<Record<string, number>> {
  return withPg(async (client) => {
    const result = await client.query<Record<string, string>>(
      "select " +
        "(select count(*) from public.assignment_rooms where id = $1)::text as rooms, " +
        "(select count(*) from public.assignment_room_items where room_id = $1)::text as items, " +
        "(select count(*) from public.assignment_room_participants where room_id = $1)::text as participants, " +
        "(select count(*) from guest_credentials.assignment_room_access where room_id = $1)::text as access",
      [roomId],
    );
    return {
      rooms: Number(result.rows[0].rooms),
      items: Number(result.rows[0].items),
      participants: Number(result.rows[0].participants),
      access: Number(result.rows[0].access),
    };
  });
}

describe.skipIf(!isIntegrationTestReady)("blocked assignment rooms — creation", () => {
  it("allows host self and unrelated onboarded participants", async () => {
    const [ana, carla] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);

    const call = roomCall({
      participants: [participant(ana), participant(carla)],
    });
    await createRoom(anaClient, call);

    const stored = await withPg(async (client) => {
      const result = await client.query<{ user_id: string | null }>(
        "select user_id from public.assignment_room_participants where room_id = $1 order by ordinal",
        [call.roomId],
      );
      return result.rows.map((row) => row.user_id);
    });
    expect(stored).toEqual([ana.id, carla.id]);
  });

  it("rejects named blocked users in both directions for new and existing group targets", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo sala");
    await rpcBlock(anaClient, bruno.id);

    for (const target of [
      { kind: "new", name: "Viagem" },
      { kind: "existing", groupId },
    ]) {
      expect(
        await denialCode(anaClient, roomCall({
          groupTarget: target,
          participants: [participant(ana), participant(bruno)],
        })),
      ).toBe("member_excluded");
      expect(
        await denialCode(brunoClient, roomCall({
          groupTarget: target,
          participants: [participant(bruno), participant(ana)],
        })),
      ).toBe("member_excluded");
    }
  });

  it("refuses a group member in a blocked pair with the host from entering the host's group room", async () => {
    const [ana, bruno, carla] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(ana, [bruno, carla], "Grupo da sala");
    const call = roomCall({
      groupTarget: { kind: "existing", groupId },
      participants: [participant(ana)],
    });
    await createRoom(authenticateAs(ana), call);
    await rpcBlock(authenticateAs(bruno), ana.id);

    const enter = (client: Client) =>
      client.rpc("enter_group_assignment_room", {
        p_room_id: call.roomId,
        p_member_token: `armm1_${crypto.randomUUID().replaceAll("-", "")}AAAAAAAAAAA`,
      });

    expect(await expectRpcError(Promise.resolve(enter(authenticateAs(bruno))))).toBe("member_excluded");
    const admitted = await enter(authenticateAs(carla));
    expect(admitted.error).toBeNull();
    expect((await roomRowCounts(call.roomId)).participants).toBe(2);
  });

  it("does not create room items participants or credentials after contact denial", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    await rpcBlock(anaClient, bruno.id);

    const call = roomCall({
      participants: [participant(ana), participant(bruno)],
    });
    expect(await denialCode(anaClient, call)).toBe("member_excluded");
    expect(await roomRowCounts(call.roomId)).toEqual({
      rooms: 0,
      items: 0,
      participants: 0,
      access: 0,
    });
  });

  it("keeps room ownership token and idempotency validation", async () => {
    const [ana] = await createTestUsers(1);
    const anaClient = authenticateAs(ana);

    const call = roomCall({ participants: [participant(ana)] });
    await createRoom(anaClient, call);
    await createRoom(anaClient, call);

    expect(
      await denialCode(anaClient, { ...call, joinToken: joinToken("B") }),
    ).toBe("invalid_argument");

    const [intruder] = await createTestUsers(1);
    expect(
      await denialCode(authenticateAs(intruder), call),
    ).toBe("invalid_argument");

    const access = await withPg(async (client) => {
      const result = await client.query<{ count: string }>(
        "select count(*)::text as count from guest_credentials.assignment_room_access where room_id = $1",
        [call.roomId],
      );
      return Number(result.rows[0].count);
    });
    expect(access).toBe(1);
  });

  it("rejects anonymous and non-member existing-group callers", async () => {
    const [ana, bruno, dave] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo existente");
    const anonClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const call = roomCall({
      groupTarget: { kind: "existing", groupId },
      participants: [participant(ana)],
    });
    const anonError = await expectRpcError(anonClient.rpc("create_assignment_room", {
      p_room_id: call.roomId,
      p_group_target: call.groupTarget,
      p_header: header,
      p_items: items,
      p_participants: call.participants,
      p_join_token: call.joinToken,
    }));
    expect(anonError).toMatch(/permission denied for function create_assignment_room/);

    expect(
      await denialCode(authenticateAs(dave), call),
    ).toBe("not_a_member");
  });

  it("keeps unknown non-onboarded and mismatched-profile-name denial", async () => {
    const [ana] = await createTestUsers(1);
    const [namedUser] = await createTestUsers(1);
    const notOnboarded = await createTestUser({ onboarded: false });
    const anaClient = authenticateAs(ana);

    expect(
      await denialCode(anaClient, roomCall({
        participants: [
          participant(ana),
          { id: crypto.randomUUID(), displayName: "Fantasma", userId: crypto.randomUUID() },
        ],
      })),
    ).toBe("user_not_found");

    expect(
      await denialCode(anaClient, roomCall({
        participants: [participant(ana), participant(notOnboarded)],
      })),
    ).toBe("user_not_found");

    expect(
      await denialCode(anaClient, roomCall({
        participants: [
          participant(ana),
          participant(namedUser, { displayName: `Outro ${namedUser.name}` }),
        ],
      })),
    ).toBe("user_not_found");
  });

  it("does not reinterpret unnamed guests as blocked registered users", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    await rpcBlock(anaClient, bruno.id);

    const call = roomCall({
      participants: [participant(ana), guestParticipant(bruno.name)],
    });
    await createRoom(anaClient, call);

    const stored = await withPg(async (client) => {
      const result = await client.query<{ display_name: string; user_id: string | null }>(
        "select display_name, user_id from public.assignment_room_participants where room_id = $1 order by ordinal",
        [call.roomId],
      );
      return result.rows;
    });
    expect(stored).toEqual([
      { display_name: ana.name, user_id: ana.id },
      { display_name: bruno.name, user_id: null },
    ]);
  });
});

async function rpcBlock(client: Client, userId: string): Promise<void> {
  const { error } = await client.rpc("block_user", { p_user_id: userId });
  if (error) {
    throw new Error(`block_user failed: ${error.message}`);
  }
}

async function denialCode(client: Client, call: RoomCall): Promise<string> {
  return expectRpcError(
    Promise.resolve(
      client.rpc("create_assignment_room", {
        p_room_id: call.roomId,
        p_group_target: call.groupTarget,
        p_header: header,
        p_items: items,
        p_participants: call.participants,
        p_join_token: call.joinToken,
      }),
    ),
  );
}

type RoomView = AssignmentRoomView;

function memberTokenValue(): string {
  const random = crypto.randomUUID().replaceAll("-", "") + "AAAAAAAAAAA";
  return `armm1_${random}`;
}

async function joinRoom(
  client: Client,
  roomId: string,
  joinToken: string,
  memberToken: string,
): Promise<RoomView> {
  return rpcRoom(client, "join_assignment_room", {
    p_room_id: roomId,
    p_join_token: joinToken,
    p_member_token: memberToken,
    p_display_name: "",
  });
}

async function claimItem(
  client: Client,
  roomId: string,
  memberToken: string | null,
  itemId: string,
  participantId: string,
  expectedItemRevision: number,
): Promise<RoomView> {
  return rpcRoom(client, "set_assignment_room_claim", {
    p_room_id: roomId,
    p_member_token: memberToken,
    p_item_id: itemId,
    p_participant_id: participantId,
    p_expected_item_revision: expectedItemRevision,
    p_ticks: 60_000,
  });
}

async function closeRoom(
  client: Client,
  roomId: string,
  expectedRevision: number,
): Promise<RoomView> {
  return rpcRoom(client, "close_assignment_room", {
    p_room_id: roomId,
    p_expected_revision: expectedRevision,
  });
}

function finalizePayload(view: RoomView): ExpensePayload {
  if (view.role !== "host") {
    throw new Error("expected a host view to build the expense payload");
  }
  const built = buildAssignmentExpense(view, [
    { participantIndex: 0, amountCents: view.room.totalCents },
  ]);
  if (!built.ok) {
    throw new Error(JSON.stringify(built.issue));
  }

  return built.value;
}

describe.skipIf(!isIntegrationTestReady)("blocked assignment rooms — join and finalize", () => {
  it.each([
    ["blocker hosts", "host"] as const,
    ["blocker joins", "joiner"] as const,
  ])(
    "admits a blocked account through the link as an unlinked guest and finalizes as a guest slot (%s)",
    async (_label, blockerSide) => {
      const [ana, bruno] = await createTestUsers(2);
      const anaClient = authenticateAs(ana);
      const brunoClient = authenticateAs(bruno);
      const token = memberTokenValue();

      const call = roomCall({ participants: [participant(ana)] });
      const created = await createRoom(anaClient, call);

      if (blockerSide === "host") {
        await rpcBlock(brunoClient, ana.id);
      } else {
        await rpcBlock(anaClient, bruno.id);
      }

      const joined = await joinRoom(brunoClient, call.roomId, call.joinToken, token);

      const self = joined.room.participants.find(
        (entry) => entry.id === joined.room.selfParticipantId,
      );
      expect(self).toMatchObject({ displayName: bruno.name, isGuest: true });

      let current = await claimItem(
        anaClient,
        call.roomId,
        null,
        created.room.items[0].id,
        created.room.selfParticipantId,
        created.room.items[0].revision,
      );
      current = await claimItem(
        brunoClient,
        call.roomId,
        token,
        current.room.items[0].id,
        joined.room.selfParticipantId,
        current.room.items[0].revision,
      );
      const closed = await closeRoom(anaClient, call.roomId, current.room.revision);
      const finalize = await rpcDecoded(
        anaClient,
        "finalize_assignment_room",
        {
          p_room_id: call.roomId,
          p_expected_revision: closed.room.revision,
          p_payload: finalizePayload(closed),
        },
        decodeFinalizeAssignmentRoomResult,
      );

      const expenseId = finalize.ack.expenseId;
      const ledger = await withPg(async (client) => {
        const participant = await client.query<{ user_id: string | null; display_name: string }>(
          "select user_id, display_name from public.assignment_room_participants where room_id = $1 and id = $2",
          [call.roomId, joined.room.selfParticipantId],
        );
        const payload = await client.query<{
          payload: { participants: Array<{ kind: string; userId?: string | null; displayName?: string }> };
        }>(
          "select payload from public.expense_versions where expense_id = $1 order by version_no desc limit 1",
          [expenseId],
        );
        return {
          participant: participant.rows[0] ?? null,
          participants: payload.rows[0].payload.participants,
        };
      });

      expect(ledger.participant).toEqual({
        user_id: null,
        display_name: bruno.name,
      });
      expect(ledger.participants).toEqual([
        { kind: "user", userId: ana.id },
        { kind: "guest", guestId: expect.any(String), displayName: bruno.name },
      ]);
    },
  );

  it("finalizes a room that named the person before the block as a guest slot instead of inviting", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);
    const token = memberTokenValue();

    const call = roomCall({
      participants: [participant(ana), participant(bruno)],
      groupTarget: { kind: "new", name: "Sala antes do bloqueio" },
    });
    const created = await createRoom(anaClient, call);
    const joined = await joinRoom(brunoClient, call.roomId, call.joinToken, token);

    await rpcBlock(brunoClient, ana.id);

    let current = await claimItem(
      anaClient,
      call.roomId,
      null,
      created.room.items[0].id,
      created.room.selfParticipantId,
      created.room.items[0].revision,
    );
    current = await claimItem(
      brunoClient,
      call.roomId,
      token,
      current.room.items[0].id,
      joined.room.selfParticipantId,
      current.room.items[0].revision,
    );
    const closed = await closeRoom(anaClient, call.roomId, current.room.revision);
    const finalize = await rpcDecoded(
      anaClient,
      "finalize_assignment_room",
      {
        p_room_id: call.roomId,
        p_expected_revision: closed.room.revision,
        p_payload: finalizePayload(closed),
      },
      decodeFinalizeAssignmentRoomResult,
    );

    const expenseId = finalize.ack.expenseId;
    const ledger = await withPg(async (client) => {
      const group = await client.query<{ group_id: string }>(
        "select group_id from public.expenses where id = $1",
        [expenseId],
      );
      const memberships = await client.query<{ user_id: string; status: string }>(
        "select user_id, status from public.group_members where group_id = $1 order by user_id",
        [group.rows[0].group_id],
      );
      const payload = await client.query<{
        payload: { participants: Array<{ kind: string; userId?: string | null; displayName?: string }> };
      }>(
        "select payload from public.expense_versions where expense_id = $1 order by version_no desc limit 1",
        [expenseId],
      );
      return {
        groupId: group.rows[0].group_id,
        memberships: memberships.rows,
        participants: payload.rows[0].payload.participants,
      };
    });

    expect(ledger.groupId).toBeTruthy();
    expect(ledger.memberships).toEqual([{ user_id: ana.id, status: "accepted" }]);
    expect(ledger.participants).toEqual([
      { kind: "user", userId: ana.id },
      { kind: "guest", guestId: expect.any(String), displayName: bruno.name },
    ]);
  });

  it("hides a blocked host's open group room from the other member of the pair", async () => {
    const [ana, bruno, carla] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(ana, [bruno, carla], "Grupo das salas");
    const call = roomCall({
      groupTarget: { kind: "existing", groupId },
      participants: [participant(ana)],
    });
    await createRoom(authenticateAs(ana), call);
    await rpcBlock(authenticateAs(ana), bruno.id);

    const listed = async (user: TestUser) => {
      const rooms = await rpcDecoded(
        authenticateAs(user),
        "list_open_assignment_rooms",
        { p_group_id: groupId },
        decodeOpenAssignmentRooms,
      );
      return rooms.map((room) => room.id);
    };
    expect(await listed(bruno)).toEqual([]);
    expect(await listed(carla)).toEqual([call.roomId]);
  });
});
