import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import {
  isIntegrationTestReady,
  adminClient,
  unregisterTestUser,
} from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUser,
  createTestUsers,
  decodeRpcData,
  expectRpcError,
  rpcDecoded,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";
import { decodeMutationAck } from "@/lib/ledger/decode";
import { decodeAssignmentRoomView } from "@/lib/ledger/decode-assignment-room";
import type { AssignmentRoomView } from "@/types/assignment-room";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;
type CreateRoomArgs =
  Database["public"]["Functions"]["create_assignment_room"]["Args"];
type RoomView = AssignmentRoomView;

const header = {
  title: "Almoço",
  occurredOn: "2026-09-19",
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

function participants(host: TestUser, extra: Json[] = []): Json[] {
  return [
    { id: crypto.randomUUID(), displayName: host.name, userId: host.id },
    ...extra,
  ];
}

function roomArgs(
  host: TestUser,
  overrides: Partial<CreateRoomArgs> = {}
): CreateRoomArgs {
  return {
    p_room_id: crypto.randomUUID(),
    p_group_target: { kind: "new", name: "Viagem" },
    p_header: header,
    p_items: items,
    p_participants: participants(host),
    p_join_token: joinToken(),
    ...overrides,
  };
}

async function createRoom(
  client: Client,
  args: CreateRoomArgs,
): Promise<RoomView> {
  return rpcDecoded(
    client,
    "create_assignment_room",
    args,
    decodeAssignmentRoomView,
  );
}

describe.skipIf(!isIntegrationTestReady)("assignment room storage RPCs", () => {
  let host: TestUser;
  let selected: TestUser;
  let outsider: TestUser;
  let hostClient: Client;
  let outsiderClient: Client;
  let anonClient: Client;

  beforeAll(async () => {
    [host, selected, outsider] = await createTestUsers(3);
    hostClient = authenticateAs(host);
    outsiderClient = authenticateAs(outsider);
    anonClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  });

  it("requires authentication and the strict armj1 token shape", async () => {
    const args = roomArgs(host);
    expect(
      await expectRpcError(anonClient.rpc("create_assignment_room", args))
    ).toMatch(/permission denied|unauthenticated/i);

    for (const token of [
      "A".repeat(43),
      "armj1_short",
      `armj1_${"+".repeat(43)}`,
    ]) {
      const error = await expectRpcError(
        hostClient.rpc("create_assignment_room", {
          ...roomArgs(host),
          p_join_token: token,
        })
      );
      expect(error).toContain("invalid_argument");
    }
  });

  it("opens a one-person room without writing any ledger facts", async () => {
    const args = roomArgs(host);
    const before = await withPg(async (db) => {
      const result = await db.query(
        "select (select count(*) from public.groups)::int as groups, " +
          "(select count(*) from public.expenses)::int as expenses, " +
          "(select count(*) from public.expense_versions)::int as versions, " +
          "(select count(*) from public.guests)::int as guests, " +
          "(select count(*) from public.group_balances)::int as balances"
      );
      return result.rows[0] as Record<string, number>;
    });

    const view = await createRoom(hostClient, args);

    expect(view).toMatchObject({
      role: "host",
      room: {
        id: args.p_room_id,
        revision: 1,
        status: "open",
        title: "Almoço",
        totalCents: 2_850,
        currentBill: null,
        claims: [],
      },
      groupTarget: { kind: "new", name: "Viagem" },
    });
    expect(view.room.topic).toMatch(
      new RegExp(`^assignment:${args.p_room_id}:[A-Za-z0-9_-]{43}$`)
    );
    expect(view.room.items).toHaveLength(1);
    expect(view.room.items[0]).toMatchObject({
      ordinal: 0,
      revision: 1,
      totalPriceCents: 2_500,
    });
    expect(view.room.participants).toHaveLength(1);
    expect(view.room.participants[0]).toMatchObject({
      ordinal: 0,
      displayName: host.name,
      isGuest: false,
      removed: false,
    });

    const after = await withPg(async (db) => {
      const result = await db.query(
        "select (select count(*) from public.groups)::int as groups, " +
          "(select count(*) from public.expenses)::int as expenses, " +
          "(select count(*) from public.expense_versions)::int as versions, " +
          "(select count(*) from public.guests)::int as guests, " +
          "(select count(*) from public.group_balances)::int as balances, " +
          "(select count(*) from public.assignment_room_claims where room_id = $1)::int as claims",
        [args.p_room_id]
      );
      return result.rows[0] as Record<string, number>;
    });
    expect(after).toEqual({ ...before, claims: 0 });
  });

  it("is idempotent only for identical immutable input and the same join secret", async () => {
    const args = roomArgs(host, {
      p_participants: participants(host, [
        { id: crypto.randomUUID(), displayName: "Convidada", userId: null },
      ]),
    });
    const first = await createRoom(hostClient, args);
    const retry = await createRoom(hostClient, args);

    expect(retry).toEqual(first);
    const count = await withPg(async (db) => {
      const result = await db.query(
        "select count(*)::int as count from public.assignment_rooms where id = $1",
        [args.p_room_id]
      );
      return result.rows[0]?.count;
    });
    expect(count).toBe(1);

    const mismatches = [
      { ...args, p_header: { ...header, title: "Outro" } },
      { ...args, p_join_token: joinToken("B") },
    ];
    for (const mismatch of mismatches) {
      expect(
        await expectRpcError(hostClient.rpc("create_assignment_room", mismatch))
      ).toContain("invalid_argument");
    }
  });

  it("validates exact receipt arithmetic and participant identities", async () => {
    const badLine = roomArgs(host, {
      p_items: [{ ...items[0], totalPriceCents: 2_499 }],
    });
    expect(
      await expectRpcError(hostClient.rpc("create_assignment_room", badLine))
    ).toContain("invalid_argument");

    const tooLarge = roomArgs(host, {
      p_header: { ...header, fixedFeeCents: 99_999_999 },
    });
    expect(
      await expectRpcError(hostClient.rpc("create_assignment_room", tooLarge))
    ).toContain("invalid_argument");

    const duplicateId = crypto.randomUUID();
    const duplicateParticipants = roomArgs(host, {
      p_participants: [
        { id: duplicateId, displayName: host.name, userId: host.id },
        { id: duplicateId, displayName: "Pessoa", userId: null },
      ],
    });
    expect(
      await expectRpcError(
        hostClient.rpc("create_assignment_room", duplicateParticipants)
      )
    ).toContain("invalid_argument");

    const missingUser = roomArgs(host, {
      p_participants: participants(host, [
        {
          id: crypto.randomUUID(),
          displayName: "Inexistente",
          userId: crypto.randomUUID(),
        },
      ]),
    });
    expect(
      await expectRpcError(
        hostClient.rpc("create_assignment_room", missingUser)
      )
    ).toContain("user_not_found");

    const tooManyItems = roomArgs(host, {
      p_items: Array.from({ length: 101 }, (_, index) => ({
        description: `Item ${index}`,
        quantityMilliunits: 1_000,
        unitPriceCents: 1,
        totalPriceCents: 1,
      })),
    });
    expect(
      await expectRpcError(
        hostClient.rpc("create_assignment_room", tooManyItems)
      )
    ).toContain("invalid_argument");

    const tooManyParticipants = roomArgs(host, {
      p_participants: participants(
        host,
        Array.from({ length: 50 }, (_, index) => ({
          id: crypto.randomUUID(),
          displayName: `Pessoa ${index}`,
          userId: null,
        }))
      ),
    });
    expect(
      await expectRpcError(
        hostClient.rpc("create_assignment_room", tooManyParticipants)
      )
    ).toContain("invalid_argument");
  });

  it("accepts an existing group only for an accepted member and rejects DMs", async () => {
    const groupId = await createGroupWithMembers(host, [selected]);
    const groupArgs = roomArgs(host, {
      p_group_target: { kind: "existing", groupId },
      p_participants: participants(host, [
        {
          id: crypto.randomUUID(),
          displayName: selected.name,
          userId: selected.id,
        },
      ]),
    });
    const view = await createRoom(hostClient, groupArgs);
    if (view.role !== "host") {
      throw new Error("expected the creator to receive a host view");
    }
    expect(view.groupTarget).toEqual({ kind: "existing", groupId });

    const foreign = roomArgs(outsider, {
      p_group_target: { kind: "existing", groupId },
    });
    expect(
      await expectRpcError(
        outsiderClient.rpc("create_assignment_room", foreign)
      )
    ).toContain("not_a_member");

    const { data: dm, error: dmError } = await hostClient.rpc(
      "get_or_create_dm",
      { p_user_id: selected.id }
    );
    if (dmError) throw new Error(dmError.message);
    const dmId = decodeRpcData("get_or_create_dm", dm, decodeMutationAck).groupId;
    const dmArgs = roomArgs(host, {
      p_group_target: { kind: "existing", groupId: dmId },
    });
    expect(
      await expectRpcError(hostClient.rpc("create_assignment_room", dmArgs))
    ).toContain("invalid_operation");
  });

  it("rotates join access only for the host of an open room", async () => {
    const args = roomArgs(host);
    const first = await createRoom(hostClient, args);
    const before = await withPg(async (db) => {
      const result = await db.query<{ digest: string; topic: string }>(
        "select encode(join_digest, 'hex') as digest, broadcast_topic as topic " +
          "from guest_credentials.assignment_room_access where room_id = $1",
        [args.p_room_id]
      );
      return result.rows[0];
    });

    expect(
      await expectRpcError(
        outsiderClient.rpc("rotate_assignment_room_join", {
          p_room_id: args.p_room_id,
          p_join_token: joinToken("B"),
        })
      )
    ).toContain("not_room_host");

    const { data, error } = await hostClient.rpc(
      "rotate_assignment_room_join",
      {
        p_room_id: args.p_room_id,
        p_join_token: joinToken("B"),
      }
    );
    if (error) throw new Error(error.message);
    const rotated = decodeRpcData(
      "rotate_assignment_room_join",
      data,
      decodeAssignmentRoomView,
    );
    expect(rotated.room.revision).toBe(first.room.revision + 1);
    expect(rotated.room.topic).toBe(before?.topic);

    const after = await withPg(async (db) => {
      const result = await db.query<{ digest: string; seconds: number }>(
        "select encode(join_digest, 'hex') as digest, " +
          "extract(epoch from (join_expires_at - now()))::int as seconds " +
          "from guest_credentials.assignment_room_access where room_id = $1",
        [args.p_room_id]
      );
      return result.rows[0];
    });
    expect(after?.digest).not.toBe(before?.digest);
    expect(after?.seconds).toBeGreaterThan(6 * 24 * 60 * 60);

    await withPg(async (db) => {
      await db.query(
        "update public.assignment_rooms set status = 'closed', closed_at = now() where id = $1",
        [args.p_room_id]
      );
    });
    expect(
      await expectRpcError(
        hostClient.rpc("rotate_assignment_room_join", {
          p_room_id: args.p_room_id,
          p_join_token: joinToken("C"),
        })
      )
    ).toContain("room_closed");
  });

  it("keeps reviewed receipt fields, ordinals, and the host immutable", async () => {
    const args = roomArgs(host);
    const view = await createRoom(hostClient, args);
    const itemId = view.room.items[0]?.id;
    const hostParticipantId = view.room.participants[0]?.id;
    expect(itemId).toBeDefined();
    expect(hostParticipantId).toBeDefined();

    await withPg(async (db) => {
      await expect(
        db.query(
          "update public.assignment_rooms set group_target = $2::jsonb where id = $1",
          [args.p_room_id, JSON.stringify({ kind: "new", name: "Outra" })]
        )
      ).rejects.toMatchObject({
        message: expect.stringContaining("invalid_operation"),
      });
      await expect(
        db.query(
          "update public.assignment_room_items set ordinal = 2 where room_id = $1 and id = $2",
          [args.p_room_id, itemId]
        )
      ).rejects.toMatchObject({
        message: expect.stringContaining("invalid_operation"),
      });
      await expect(
        db.query(
          "update public.assignment_room_participants set removed_at = now() where room_id = $1 and id = $2",
          [args.p_room_id, hostParticipantId]
        )
      ).rejects.toMatchObject({
        message: expect.stringContaining("invalid_operation"),
      });
    });
  });

  it("cascades standalone room data when its host is deleted", async () => {
    const disposable = await createTestUser();
    const client = authenticateAs(disposable);
    const args = roomArgs(disposable);
    await createRoom(client, args);

    const { error } = await adminClient!.auth.admin.deleteUser(disposable.id);
    if (error) throw new Error(error.message);
    unregisterTestUser(disposable.id);

    const counts = await withPg(async (db) => {
      const result = await db.query(
        "select (select count(*) from public.assignment_rooms where id = $1)::int as rooms, " +
          "(select count(*) from public.assignment_room_items where room_id = $1)::int as items, " +
          "(select count(*) from public.assignment_room_participants where room_id = $1)::int as participants, " +
          "(select count(*) from guest_credentials.assignment_room_access where room_id = $1)::int as access",
        [args.p_room_id]
      );
      return result.rows[0];
    });
    expect(counts).toEqual({ rooms: 0, items: 0, participants: 0, access: 0 });
  });
});
