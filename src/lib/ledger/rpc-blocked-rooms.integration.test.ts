import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUser,
  createTestUsers,
  expectRpcError,
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

async function createRoom(
  client: Client,
  call: RoomCall,
): Promise<unknown> {
  const { data, error } = await client.rpc("create_assignment_room", {
    p_room_id: call.roomId,
    p_group_target: call.groupTarget,
    p_header: header,
    p_items: items,
    p_participants: call.participants,
    p_join_token: call.joinToken,
  });
  if (error) {
    throw new Error(`create_assignment_room failed: ${error.message}`);
  }
  return data;
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
