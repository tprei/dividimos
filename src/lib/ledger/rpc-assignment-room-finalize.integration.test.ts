import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { ExpensePayload } from "@/types/ledger";
import { buildAssignmentExpense } from "@/lib/assignment-room-money";
import type { AssignmentRoomView } from "@/types/assignment-room";
import {
  decodeAssignmentRoomView,
  decodeFinalizeAssignmentRoomResult,
  type FinalizeAssignmentRoomResult,
} from "@/lib/ledger/decode-assignment-room";
import { decodeMutationAck } from "@/lib/ledger/decode";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  expectRpcError,
  rpcDecoded,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { forceLockContentionRace } from "@/test/db-race-barrier";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;
type CreateArgs =
  Database["public"]["Functions"]["create_assignment_room"]["Args"];
type RoomView = AssignmentRoomView;

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

async function rpcRoom(
  client: Client,
  name: keyof Database["public"]["Functions"],
  args: Record<string, unknown>
): Promise<RoomView> {
  return rpcDecoded(client, name, args, decodeAssignmentRoomView);
}

async function createRoom(client: Client, args: CreateArgs): Promise<RoomView> {
  return rpcRoom(client, "create_assignment_room", args);
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
  return rpcRoom(client, "set_assignment_room_claim", {
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
  return rpcRoom(client, "close_assignment_room", {
    p_room_id: roomId,
    p_expected_revision: expectedRevision,
  });
}

function expensePayload(view: RoomView, payerIndex = 0): ExpensePayload {
  if (view.role !== "host") {
    throw new Error("expected a host view to build the expense payload");
  }
  const built = buildAssignmentExpense(view, [
    { participantIndex: payerIndex, amountCents: 111 },
  ]);
  if (!built.ok) throw new Error(JSON.stringify(built.issue));
  return built.value;
}

async function finalize(
  client: Client,
  roomId: string,
  revision: number,
  payload: ExpensePayload
): Promise<FinalizeAssignmentRoomResult> {
  return rpcDecoded(
    client,
    "finalize_assignment_room",
    {
      p_room_id: roomId,
      p_expected_revision: revision,
      p_payload: payload,
    },
    decodeFinalizeAssignmentRoomResult
  );
}

describe.skipIf(!isIntegrationTestReady)(
  "assignment room finalization",
  () => {
    let host: TestUser;
    let selected: TestUser;
    let groupOwner: TestUser;
    let hostClient: Client;
    let selectedClient: Client;
    let groupOwnerClient: Client;
    let anonClient: Client;

    beforeAll(async () => {
      [host, selected, groupOwner] = await createTestUsers(3);
      hostClient = authenticateAs(host);
      selectedClient = authenticateAs(selected);
      groupOwnerClient = authenticateAs(groupOwner);
      anonClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
    });

    /**
     * Host plus one signed-in participant who joined through the invitation,
     * each owning half of the only line, with the room closed for review.
     */
    async function closedAccountRoom(
      joiner: Client,
      groupTarget?: Json
    ): Promise<{ args: CreateArgs; closed: RoomView; joinedId: string }> {
      const token = memberToken();
      const args = roomArgs(host, groupTarget);
      const created = await createRoom(hostClient, args);
      const joined = await rpcRoom(joiner, "join_assignment_room", {
        p_room_id: args.p_room_id,
        p_join_token: args.p_join_token,
        p_member_token: token,
        p_display_name: "",
      });
      let current = await claim(
        hostClient,
        args.p_room_id,
        null,
        created.room.items[0].id,
        created.room.selfParticipantId,
        created.room.items[0].revision,
        60_000
      );
      current = await claim(
        joiner,
        args.p_room_id,
        token,
        current.room.items[0].id,
        joined.room.selfParticipantId,
        current.room.items[0].revision,
        60_000
      );
      return {
        args,
        joinedId: joined.room.selfParticipantId,
        closed: await closeRoom(
          hostClient,
          args.p_room_id,
          current.room.revision
        ),
      };
    }

    async function closedThreeWayRoom(
      groupTarget?: Json
    ): Promise<{ args: CreateArgs; closed: RoomView }> {
      const firstToken = memberToken();
      const secondToken = memberToken();
      const args = roomArgs(host, groupTarget);
      const created = await createRoom(hostClient, args);
      const first = await rpcRoom(anonClient, "join_assignment_room", {
        p_room_id: args.p_room_id,
        p_join_token: args.p_join_token,
        p_member_token: firstToken,
        p_display_name: "Bia",
      });
      const second = await rpcRoom(anonClient, "join_assignment_room", {
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

    it("keeps an account share and invites that account into a new group", async () => {
      const { args, closed } = await closedAccountRoom(selectedClient);
      const result = await finalize(
        hostClient,
        args.p_room_id,
        closed.room.revision,
        expensePayload(closed)
      );

      const ledger = await withPg(async (db) => {
        const participants = await db.query<{ payload: Json }>(
          "select payload from public.expense_versions where expense_id = $1 order by version_no desc limit 1",
          [result.ack.expenseId]
        );
        const membership = await db.query<{ status: string }>(
          "select status from public.group_members where group_id = $1 and user_id = $2",
          [result.ack.groupId, selected.id]
        );
        const guests = await db.query<{ count: number }>(
          "select count(*)::int as count from public.guests where expense_id = $1",
          [result.ack.expenseId]
        );
        return {
          payload: participants.rows[0].payload as {
            participants: Array<{ kind: string; userId?: string }>;
          },
          membership: membership.rows[0]?.status ?? null,
          guests: guests.rows[0].count,
        };
      });

      expect(ledger.payload.participants).toEqual(
        expect.arrayContaining([{ kind: "user", userId: selected.id }])
      );
      expect(ledger.membership).toBe("invited");
      expect(ledger.guests).toBe(0);
    });

    it("invites a new account into an existing group and leaves members alone", async () => {
      const groupId = await createGroupWithMembers(
        host,
        [groupOwner],
        "Grupo com membro"
      );
      const { args, closed } = await closedAccountRoom(selectedClient, {
        kind: "existing",
        groupId,
      });
      const result = await finalize(
        hostClient,
        args.p_room_id,
        closed.room.revision,
        expensePayload(closed)
      );
      expect(result.ack.groupId).toBe(groupId);

      const membership = await withPg(async (db) => {
        const rows = await db.query<{ user_id: string; status: string }>(
          "select user_id, status from public.group_members where group_id = $1 order by user_id",
          [groupId]
        );
        const invitations = await db.query<{ count: number }>(
          "select count(*)::int as count from public.group_events where group_id = $1 and kind = 'member_invited' and subject_user_id = $2",
          [groupId, selected.id]
        );
        return { rows: rows.rows, invitations: invitations.rows[0].count };
      });
      const byUser = new Map(
        membership.rows.map((row) => [row.user_id, row.status])
      );
      expect(byUser.get(host.id)).toBe("accepted");
      expect(byUser.get(groupOwner.id)).toBe("accepted");
      expect(byUser.get(selected.id)).toBe("invited");
      expect(membership.invitations).toBe(1);
    });

    it("rolls back the invitation when the payload is forged", async () => {
      const groupId = await createGroupWithMembers(host, [], "Grupo intacto");
      const { args, closed } = await closedAccountRoom(selectedClient, {
        kind: "existing",
        groupId,
      });
      // The invitation loop runs before the payload comparison, so a payload
      // that demotes the account holder to a guest fails after those writes.
      const valid = expensePayload(closed);
      const forged: ExpensePayload = {
        ...valid,
        participants: valid.participants.map((ref, index) =>
          index === 1
            ? { kind: "guest", guestId: null, displayName: "Impostor" }
            : ref
        ),
      };
      expect(
        await expectRpcError(
          hostClient.rpc("finalize_assignment_room", {
            p_room_id: args.p_room_id,
            p_expected_revision: closed.room.revision,
            p_payload: forged,
          })
        )
      ).toContain("invalid_payload");

      const traces = await withPg(async (db) => {
        const result = await db.query<{
          members: number;
          events: number;
          expenses: number;
        }>(
          "select (select count(*)::int from public.group_members where group_id = $1 and user_id = $2) as members, " +
            "(select count(*)::int from public.group_events where group_id = $1 and subject_user_id = $2) as events, " +
            "(select count(*)::int from public.expenses where client_id = $3) as expenses",
          [groupId, selected.id, args.p_room_id]
        );
        return result.rows[0];
      });
      expect(traces).toEqual({ members: 0, events: 0, expenses: 0 });
    });

    it("adds no second invitation when a finalized room is retried", async () => {
      const groupId = await createGroupWithMembers(host, [], "Grupo repetido");
      const { args, closed } = await closedAccountRoom(selectedClient, {
        kind: "existing",
        groupId,
      });
      const payload = expensePayload(closed);
      const first = await finalize(
        hostClient,
        args.p_room_id,
        closed.room.revision,
        payload
      );
      const retry = await finalize(
        hostClient,
        args.p_room_id,
        closed.room.revision,
        payload
      );
      expect(retry.ack.expenseId).toBe(first.ack.expenseId);

      const counts = await withPg(async (db) => {
        const result = await db.query<{
          members: number;
          invitations: number;
          expenses: number;
        }>(
          "select (select count(*)::int from public.group_members where group_id = $1 and user_id = $2) as members, " +
            "(select count(*)::int from public.group_events where group_id = $1 and kind = 'member_invited' and subject_user_id = $2) as invitations, " +
            "(select count(*)::int from public.expenses where client_id = $3) as expenses",
          [groupId, selected.id, args.p_room_id]
        );
        return result.rows[0];
      });
      expect(counts).toEqual({ members: 1, invitations: 1, expenses: 1 });
    });

    it("recovers a closed room when a participant loses group access", async () => {
      const groupId = await createGroupWithMembers(
        groupOwner,
        [host, selected],
        "Grupo do dono"
      );
      const { args, closed, joinedId } = await closedAccountRoom(
        selectedClient,
        { kind: "existing", groupId }
      );

      // The group creator, who is not this room's host, revokes access after
      // the person already picked their items.
      await rpcDecoded(
        groupOwnerClient,
        "remove_member",
        {
          p_group_id: groupId,
          p_user_id: selected.id,
        },
        decodeMutationAck
      );
      expect(
        await expectRpcError(
          hostClient.rpc("finalize_assignment_room", {
            p_room_id: args.p_room_id,
            p_expected_revision: closed.room.revision,
            p_payload: expensePayload(closed),
          })
        )
      ).toContain("member_excluded");

      const corrected = await rpcRoom(
        hostClient,
        "remove_assignment_room_participant",
        {
          p_room_id: args.p_room_id,
          p_participant_id: joinedId,
          p_expected_revision: closed.room.revision,
          p_join_token: joinToken("Z"),
        }
      );
      expect(corrected.room.status).toBe("closed");
      const reassigned = await claim(
        hostClient,
        args.p_room_id,
        null,
        corrected.room.items[0].id,
        corrected.room.selfParticipantId,
        corrected.room.items[0].revision,
        120_000
      );
      const result = await finalize(
        hostClient,
        args.p_room_id,
        reassigned.room.revision,
        expensePayload(reassigned)
      );
      expect(result.ack.groupId).toBe(groupId);

      const aftermath = await withPg(async (db) => {
        const rows = await db.query<{ members: number; expenses: number }>(
          "select (select count(*)::int from public.group_members where group_id = $1 and user_id = $2) as members, " +
            "(select count(*)::int from public.expenses where client_id = $3) as expenses",
          [groupId, selected.id, args.p_room_id]
        );
        return rows.rows[0];
      });
      expect(aftermath).toEqual({ members: 0, expenses: 1 });
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
      await rpcDecoded(
        hostClient,
        "create_expense",
        {
          p_client_id: second.args.p_room_id,
          p_group_id: otherGroupId,
          p_occurred_on: "2026-09-19",
          p_title: "Outra despesa",
          p_merchant_name: "",
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
        },
        decodeMutationAck
      );
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
      const current = await rpcRoom(hostClient, "get_assignment_room", {
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
