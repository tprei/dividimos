import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { AssignmentRoomView } from "@/types/assignment-room";
import type { ExpensePayload } from "@/types/ledger";
import { buildAssignmentExpense } from "@/lib/assignment-room-money";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { forceLockContentionRace } from "@/test/db-race-barrier";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;
type CreateArgs =
  Database["public"]["Functions"]["create_assignment_room"]["Args"];

interface RoomView {
  role: "host" | "participant";
  room: {
    id: string;
    revision: number;
    status: string;
    selfParticipantId: string;
    items: Array<{ id: string; revision: number }>;
    participants: Array<{
      id: string;
      ordinal: number;
      displayName: string;
      removed: boolean;
    }>;
    claims: Array<{ itemId: string; participantId: string; ticks: number }>;
  };
  groupTarget?: Json;
  participantRefs?: Json[];
}

interface FinalizeResult {
  room: RoomView;
  ack: {
    expenseId: string;
    groupId: string;
    versionNo: number;
    ledgerVersion: number;
    eventId: number | null;
  };
}

const HEADER = {
  title: "Conta em terços",
  occurredOn: "2026-09-19",
  serviceFeeBasisPoints: 1_000,
  fixedFeeCents: 1,
};
const ITEMS = [
  {
    description: "Prato compartilhado",
    quantityMilliunits: 1_000,
    unitPriceCents: 100,
    totalPriceCents: 100,
  },
];

function joinToken(fill: string): string {
  return `armj1_${fill.repeat(43)}`;
}

function memberToken(): string {
  const random = crypto.randomUUID().replaceAll("-", "") + "AAAAAAAAAAA";
  return `armm1_${random}`;
}

function roomArgs(
  host: TestUser,
  groupTarget: Json = { kind: "new", name: "Conta compartilhada" },
  participants: Json[] = []
): CreateArgs {
  return {
    p_room_id: crypto.randomUUID(),
    p_group_target: groupTarget,
    p_header: HEADER,
    p_items: ITEMS,
    p_participants: [
      { id: crypto.randomUUID(), displayName: host.name, userId: host.id },
      ...participants,
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

async function createRoom(client: Client, args: CreateArgs): Promise<RoomView> {
  return rpc<RoomView>(client, "create_assignment_room", args);
}

async function claim(
  client: Client,
  roomId: string,
  memberTokenValue: string | null,
  itemId: string,
  participantId: string,
  expectedItemRevision: number,
  ticks: number
): Promise<RoomView> {
  return rpc<RoomView>(client, "set_assignment_room_claim", {
    p_room_id: roomId,
    p_member_token: memberTokenValue,
    p_item_id: itemId,
    p_participant_id: participantId,
    p_expected_item_revision: expectedItemRevision,
    p_ticks: ticks,
  });
}

async function closeRoom(
  client: Client,
  roomId: string,
  expectedRevision: number
): Promise<RoomView> {
  return rpc<RoomView>(client, "close_assignment_room", {
    p_room_id: roomId,
    p_expected_revision: expectedRevision,
  });
}

function expensePayload(view: RoomView, payerIndex = 0): ExpensePayload {
  const built = buildAssignmentExpense(
    view as unknown as Extract<AssignmentRoomView, { role: "host" }>,
    [{ participantIndex: payerIndex, amountCents: 111 }]
  );
  if (!built.ok) throw new Error(JSON.stringify(built.issue));
  return built.value;
}

async function finalize(
  client: Client,
  roomId: string,
  revision: number,
  payload: ExpensePayload
): Promise<FinalizeResult> {
  return rpc<FinalizeResult>(client, "finalize_assignment_room", {
    p_room_id: roomId,
    p_expected_revision: revision,
    p_payload: payload,
  });
}

describe.skipIf(!isIntegrationTestReady)(
  "assignment room finalization",
  () => {
    let host: TestUser;
    let selected: TestUser;
    let hostClient: Client;
    let anonClient: Client;

    beforeAll(async () => {
      [host, selected] = await createTestUsers(2);
      hostClient = authenticateAs(host);
      anonClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
    });

    async function closedThreeWayRoom(
      groupTarget?: Json
    ): Promise<{ args: CreateArgs; closed: RoomView }> {
      const firstToken = memberToken();
      const secondToken = memberToken();
      const args = roomArgs(host, groupTarget);
      const created = await createRoom(hostClient, args);
      const first = await rpc<RoomView>(anonClient, "join_assignment_room", {
        p_room_id: args.p_room_id,
        p_join_token: args.p_join_token,
        p_member_token: firstToken,
        p_display_name: "Bia",
      });
      const second = await rpc<RoomView>(anonClient, "join_assignment_room", {
        p_room_id: args.p_room_id,
        p_join_token: args.p_join_token,
        p_member_token: secondToken,
        p_display_name: "Caio",
      });
      let current = await claim(
        hostClient,
        args.p_room_id,
        null,
        created.room.items[0].id,
        created.room.selfParticipantId,
        created.room.items[0].revision,
        40_000
      );
      current = await claim(
        anonClient,
        args.p_room_id,
        firstToken,
        current.room.items[0].id,
        first.room.selfParticipantId,
        current.room.items[0].revision,
        40_000
      );
      current = await claim(
        anonClient,
        args.p_room_id,
        secondToken,
        current.room.items[0].id,
        second.room.selfParticipantId,
        current.room.items[0].revision,
        40_000
      );
      return {
        args,
        closed: await closeRoom(
          hostClient,
          args.p_room_id,
          current.room.revision
        ),
      };
    }

    it("creates one exact expense and makes retry side-effect free", async () => {
      const { args, closed } = await closedThreeWayRoom();
      const payload = expensePayload(closed);
      expect(payload.itemAssignments).toEqual([
        { itemIndex: 0, participantIndex: 0, amountCents: 34 },
        { itemIndex: 0, participantIndex: 1, amountCents: 33 },
        { itemIndex: 0, participantIndex: 2, amountCents: 33 },
      ]);
      expect(payload.shares).toEqual([39, 36, 36]);

      const result = await finalize(
        hostClient,
        args.p_room_id,
        closed.room.revision,
        payload
      );
      expect(result.room.room.status).toBe("finalized");
      expect(result.ack.versionNo).toBe(1);
      const beforeRetry = await withPg(async (db) => {
        const rows = await db.query(
          "select " +
            "(select count(*) from public.expenses where client_id = $1)::int as expenses, " +
            "(select count(*) from public.guests where expense_id = $3)::int as guests, " +
            "(select count(*) from public.group_events where expense_id = $3 and kind = 'expense_created')::int as events, " +
            "(select count(*) from public.group_balances where group_id = $2 and kind = 'guest' and net_cents = -36)::int as guest_balances, " +
            "(select coalesce(sum(net_cents), 0) from public.group_balances where group_id = $2)::int as balance_sum",
          [args.p_room_id, result.ack.groupId, result.ack.expenseId]
        );
        return rows.rows[0];
      });
      expect(beforeRetry).toEqual({
        expenses: 1,
        guests: 2,
        events: 1,
        guest_balances: 2,
        balance_sum: 0,
      });

      const retry = await finalize(
        hostClient,
        args.p_room_id,
        closed.room.revision,
        payload
      );
      expect(retry.ack).toMatchObject({
        expenseId: result.ack.expenseId,
        groupId: result.ack.groupId,
        versionNo: 1,
        eventId: null,
      });
      const afterRetry = await withPg(async (db) => {
        const rows = await db.query(
          "select " +
            "(select count(*) from public.expenses where client_id = $1)::int as expenses, " +
            "(select count(*) from public.guests where expense_id = $2)::int as guests, " +
            "(select count(*) from public.group_events where expense_id = $2 and kind = 'expense_created')::int as events",
          [args.p_room_id, result.ack.expenseId]
        );
        return rows.rows[0];
      });
      expect(afterRetry).toEqual({ expenses: 1, guests: 2, events: 1 });
    });

    it("rolls back new groups for incomplete, stale, and forged rooms", async () => {
      const before = await withPg(async (db) => {
        const result = await db.query("select count(*)::int as count from public.groups");
        return result.rows[0].count as number;
      });
      const openArgs = roomArgs(host);
      const open = await createRoom(hostClient, openArgs);
      expect(
        await expectRpcError(
          hostClient.rpc("finalize_assignment_room", {
            p_room_id: openArgs.p_room_id,
            p_expected_revision: open.room.revision,
            p_payload: {},
          })
        )
      ).toContain("room_incomplete");

      const { args, closed } = await closedThreeWayRoom();
      const payload = expensePayload(closed);
      expect(
        await expectRpcError(
          hostClient.rpc("finalize_assignment_room", {
            p_room_id: args.p_room_id,
            p_expected_revision: closed.room.revision - 1,
            p_payload: payload,
          })
        )
      ).toContain("stale_version");
      const forged = { ...payload, shares: [38, 37, 36] };
      expect(
        await expectRpcError(
          hostClient.rpc("finalize_assignment_room", {
            p_room_id: args.p_room_id,
            p_expected_revision: closed.room.revision,
            p_payload: forged,
          })
        )
      ).toMatch(/invalid_payload|item_assignment_share_mismatch/);
      const after = await withPg(async (db) => {
        const result = await db.query("select count(*)::int as count from public.groups");
        return result.rows[0].count as number;
      });
      expect(after).toBe(before);
    });

    it("maps users without group membership to guests and rejects them as payers", async () => {
      const args = roomArgs(host, undefined, [
        {
          id: crypto.randomUUID(),
          displayName: selected.name,
          userId: selected.id,
        },
      ]);
      const created = await createRoom(hostClient, args);
      const claimed = await claim(
        hostClient,
        args.p_room_id,
        null,
        created.room.items[0].id,
        created.room.selfParticipantId,
        created.room.items[0].revision,
        120_000
      );
      const closed = await closeRoom(
        hostClient,
        args.p_room_id,
        claimed.room.revision
      );
      const forgedPayer = expensePayload(closed, 1);
      expect(
        await expectRpcError(
          hostClient.rpc("finalize_assignment_room", {
            p_room_id: args.p_room_id,
            p_expected_revision: closed.room.revision,
            p_payload: forgedPayer,
          })
        )
      ).toContain("invalid_payload");
    });

    it("rejects removed host membership and a colliding expense client id", async () => {
      const groupId = await createGroupWithMembers(host, [], "Grupo existente");
      const groupTarget = { kind: "existing", groupId };
      const first = await closedThreeWayRoom(groupTarget);
      await withPg(async (db) => {
        await db.query(
          "delete from public.group_members where group_id = $1 and user_id = $2",
          [groupId, host.id]
        );
      });
      expect(
        await expectRpcError(
          hostClient.rpc("finalize_assignment_room", {
            p_room_id: first.args.p_room_id,
            p_expected_revision: first.closed.room.revision,
            p_payload: expensePayload(first.closed),
          })
        )
      ).toContain("not_a_member");

      const otherGroupId = await createGroupWithMembers(host, [], "Outro grupo");
      const second = await closedThreeWayRoom({
        kind: "existing",
        groupId: otherGroupId,
      });
      await rpc(hostClient, "create_expense", {
        p_client_id: second.args.p_room_id,
        p_group_id: otherGroupId,
        p_occurred_on: "2026-09-19",
        p_title: "Outra despesa",
        p_merchant_name: null,
        p_expense_type: "single_amount",
        p_total_cents: 1,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: {
          items: [],
          participants: [{ kind: "user", userId: host.id }],
          shares: [1],
          payers: [{ participantIndex: 0, amountCents: 1 }],
          itemAssignments: null,
          splitMethod: "fixed",
        },
        p_chave_acesso: null,
      });
      expect(
        await expectRpcError(
          hostClient.rpc("finalize_assignment_room", {
            p_room_id: second.args.p_room_id,
            p_expected_revision: second.closed.room.revision,
            p_payload: expensePayload(second.closed),
          })
        )
      ).toContain("invalid_operation");
    });

    it("serializes finalization against a host correction", async () => {
      const { args, closed } = await closedThreeWayRoom();
      const payload = expensePayload(closed);
      const hostParticipant = closed.room.participants.find(
        (participant) => participant.ordinal === 0
      )!;
      const item = closed.room.items[0];
      const race = await forceLockContentionRace(
        process.env.SUPABASE_DB_URL!,
        {
          lockSql: "select id from public.assignment_rooms where id = $1 for update",
          lockParams: [args.p_room_id],
          queryContains: [
            "finalize_assignment_room",
            "set_assignment_room_claim",
          ],
          expectedRacers: 2,
        },
        async () =>
          Promise.all([
            hostClient.rpc("finalize_assignment_room", {
              p_room_id: args.p_room_id,
              p_expected_revision: closed.room.revision,
              p_payload: payload,
            }),
            hostClient.rpc("set_assignment_room_claim", {
              p_room_id: args.p_room_id,
              p_member_token: null as never,
              p_item_id: item.id,
              p_participant_id: hostParticipant.id,
              p_expected_item_revision: item.revision,
              p_ticks: 39_999,
            }),
          ])
      );
      expect(race.contention.observed).toBe(true);
      expect(race.result.filter((result) => result.error === null)).toHaveLength(1);
      const current = await rpc<RoomView>(hostClient, "get_assignment_room", {
        p_room_id: args.p_room_id,
        p_member_token: null,
      });
      expect(["closed", "finalized"]).toContain(current.room.status);
      const expenseCount = await withPg(async (db) => {
        const result = await db.query(
          "select count(*)::int as count from public.expenses where client_id = $1",
          [args.p_room_id]
        );
        return result.rows[0].count as number;
      });
      expect(expenseCount).toBe(current.room.status === "finalized" ? 1 : 0);
    });
  }
);
