import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { applyExpenseDelta, applySettlementDelta } from "@/lib/ledger/apply";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  getBalances,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { assertLedgerInvariants } from "@/test/ledger-invariants";
import { propertyConfig } from "@/test/property";
import type { BalanceRow, ExpensePayload } from "@/types/ledger";

const MAX_TOTAL_CENTS = 99_999_999;

/**
 * Domain rejections the simulation may legitimately provoke. Anything else —
 * a constraint violation, a cast error, a deadlock — fails the run.
 */
const EXPECTED_REJECTIONS = [
  "stale_version",
  "expense_deleted",
  "expense_not_deleted",
  "amount_exceeds_debt",
  "settlement_voided",
] as const;

type SimCommand =
  | { kind: "create"; participants: number; total: number; withGuest: boolean }
  | { kind: "edit"; expense: number; participants: number; total: number; stale: boolean }
  | { kind: "delete"; expense: number }
  | { kind: "restore"; expense: number }
  | { kind: "settle"; fraction: number }
  | { kind: "void"; settlement: number };

const amount = fc.oneof(
  fc.constant(1),
  fc.constant(MAX_TOTAL_CENTS),
  fc.integer({ min: 1, max: MAX_TOTAL_CENTS }),
);

const command: fc.Arbitrary<SimCommand> = fc.oneof(
  { weight: 4, arbitrary: fc.record({
    kind: fc.constant("create" as const),
    participants: fc.integer({ min: 2, max: 4 }),
    total: amount,
    withGuest: fc.boolean(),
  }) },
  { weight: 3, arbitrary: fc.record({
    kind: fc.constant("edit" as const),
    expense: fc.nat({ max: 50 }),
    participants: fc.integer({ min: 2, max: 4 }),
    total: amount,
    stale: fc.boolean(),
  }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("delete" as const), expense: fc.nat({ max: 50 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("restore" as const), expense: fc.nat({ max: 50 }) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant("settle" as const), fraction: fc.constantFrom(0.01, 0.5, 1) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("void" as const), settlement: fc.nat({ max: 50 }) }) },
);

interface SimExpense {
  id: string;
  versionNo: number;
  status: "active" | "deleted";
  payload: ExpensePayload;
}

interface SimSettlement {
  id: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  status: "confirmed" | "voided";
}

function evenSplit(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const rest = total % count;
  return Array.from({ length: count }, (_, index) => (index < rest ? base + 1 : base));
}

function buildPayload(
  userIds: readonly string[],
  total: number,
  guestName: string | null,
): ExpensePayload {
  const slots = guestName === null ? userIds.length : userIds.length + 1;
  const shares = evenSplit(total, slots);
  const participants: ExpensePayload["participants"] = userIds.map((userId) => ({
    kind: "user",
    userId,
  }));
  if (guestName !== null) {
    participants.push({ kind: "guest", guestId: null, displayName: guestName });
  }
  return {
    items: [],
    participants,
    shares,
    payers: [{ participantIndex: 0, amountCents: total }],
    itemAssignments: null,
  };
}

function sortBalances(balances: readonly BalanceRow[]): BalanceRow[] {
  return [...balances].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.participantId === b.participantId) return 0;
    return a.participantId < b.participantId ? -1 : 1;
  });
}

function expectedBalances(
  expenses: readonly SimExpense[],
  settlements: readonly SimSettlement[],
): BalanceRow[] {
  let balances: BalanceRow[] = [];
  for (const expense of expenses) {
    if (expense.status !== "active") continue;
    balances = applyExpenseDelta(balances, expense.payload, 1);
  }
  for (const settlement of settlements) {
    if (settlement.status !== "confirmed") continue;
    balances = applySettlementDelta(
      balances,
      {
        fromUserId: settlement.fromUserId,
        toUserId: settlement.toUserId,
        amountCents: settlement.amountCents,
      },
      1,
    );
  }
  return sortBalances(balances);
}

function classify(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const known = EXPECTED_REJECTIONS.find((candidate) => message === candidate);
  if (!known) {
    throw new Error(`unexpected ledger failure: ${message}`);
  }
  return known;
}

describe.skipIf(!isIntegrationTestReady)("ledger simulation", () => {
  let users: TestUser[] = [];
  let clients: SupabaseClient[] = [];
  const createdGroupIds: string[] = [];

  beforeAll(async () => {
    users = await createTestUsers(4);
    clients = users.map((user) => authenticateAs(user));
  });

  afterAll(async () => {
    if (createdGroupIds.length === 0) return;
    await withPg((client) =>
      client.query("delete from public.groups where id = any($1::uuid[])", [createdGroupIds]),
    );
  });

  async function rpc<T>(
    client: SupabaseClient,
    fn: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  }

  it("keeps the database ledger equal to a TypeScript model of the same commands", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(command, { minLength: 10, maxLength: 40 }),
        async (commands) => {
          const groupId = await createGroupWithMembers(users[0], users.slice(1));
          createdGroupIds.push(groupId);
          const expenses: SimExpense[] = [];
          const settlements: SimSettlement[] = [];
          let guestSeq = 0;

          for (const [step, next] of commands.entries()) {
            const before = expectedBalances(expenses, settlements);

            switch (next.kind) {
              case "create": {
                const memberIds = users.slice(0, next.participants).map((user) => user.id);
                const guestName = next.withGuest ? `Convidado ${(guestSeq += 1)}` : null;
                const payload = buildPayload(memberIds, next.total, guestName);
                const ack = await rpc<{ expenseId: string; versionNo: number }>(
                  clients[0],
                  "create_expense",
                  {
                    p_client_id: crypto.randomUUID(),
                    p_group_id: groupId,
                    p_occurred_on: "2026-01-01",
                    p_title: `Sim ${step}`,
                    p_merchant_name: null,
                    p_expense_type: "single_amount",
                    p_total_cents: next.total,
                    p_service_fee_bps: 0,
                    p_fixed_fee_cents: 0,
                    p_payload: payload,
                  },
                );
                expenses.push({
                  id: ack.expenseId,
                  versionNo: ack.versionNo,
                  status: "active",
                  payload: await resolveGuestIds(ack.expenseId, payload),
                });
                break;
              }

              case "edit": {
                if (expenses.length === 0) break;
                const target = expenses[next.expense % expenses.length];
                const memberIds = users.slice(0, next.participants).map((user) => user.id);
                const payload = buildPayload(memberIds, next.total, null);
                const sentVersion = next.stale ? target.versionNo - 1 : target.versionNo;
                try {
                  const ack = await rpc<{ versionNo: number }>(clients[0], "edit_expense", {
                    p_expense_id: target.id,
                    p_expected_version_no: sentVersion,
                    p_occurred_on: "2026-01-02",
                    p_title: `Sim edit ${step}`,
                    p_merchant_name: null,
                    p_expense_type: "single_amount",
                    p_total_cents: next.total,
                    p_service_fee_bps: 0,
                    p_fixed_fee_cents: 0,
                    p_payload: payload,
                  });
                  expect(next.stale).toBe(false);
                  expect(target.status).toBe("active");
                  target.versionNo = ack.versionNo;
                  target.payload = payload;
                } catch (error) {
                  const code = classify(error);
                  if (code === "stale_version") expect(sentVersion).not.toBe(target.versionNo);
                  else expect(code).toBe("expense_deleted");
                }
                break;
              }

              case "delete": {
                if (expenses.length === 0) break;
                const target = expenses[next.expense % expenses.length];
                try {
                  await rpc(clients[0], "delete_expense", { p_expense_id: target.id });
                  expect(target.status).toBe("active");
                  target.status = "deleted";
                } catch (error) {
                  expect(classify(error)).toBe("expense_deleted");
                }
                break;
              }

              case "restore": {
                if (expenses.length === 0) break;
                const target = expenses[next.expense % expenses.length];
                try {
                  await rpc(clients[0], "restore_expense", { p_expense_id: target.id });
                  expect(target.status).toBe("deleted");
                  target.status = "active";
                } catch (error) {
                  expect(classify(error)).toBe("expense_not_deleted");
                }
                break;
              }

              case "settle": {
                const debtor = before
                  .filter((row) => row.kind === "user" && row.netCents < 0)
                  .sort((a, b) => a.netCents - b.netCents)[0];
                const creditor = before
                  .filter((row) => row.kind === "user" && row.netCents > 0)
                  .sort((a, b) => b.netCents - a.netCents)[0];
                if (!debtor || !creditor) break;
                const payable = Math.min(-debtor.netCents, creditor.netCents);
                const amountCents = Math.max(1, Math.ceil(payable * next.fraction));
                if (amountCents > MAX_TOTAL_CENTS) break;

                const actor = clients[users.findIndex((user) => user.id === debtor.participantId)];
                try {
                  const ack = await rpc<{ settlementId: string }>(actor, "record_settlement", {
                    p_operation_id: crypto.randomUUID(),
                    p_group_id: groupId,
                    p_from_user_id: debtor.participantId,
                    p_to_user_id: creditor.participantId,
                    p_amount_cents: amountCents,
                  });
                  expect(amountCents).toBeLessThanOrEqual(payable);
                  settlements.push({
                    id: ack.settlementId,
                    fromUserId: debtor.participantId,
                    toUserId: creditor.participantId,
                    amountCents,
                    status: "confirmed",
                  });
                } catch (error) {
                  expect(classify(error)).toBe("amount_exceeds_debt");
                  expect(amountCents).toBeGreaterThan(payable);
                }
                break;
              }

              case "void": {
                if (settlements.length === 0) break;
                const target = settlements[next.settlement % settlements.length];
                const actor = clients[users.findIndex((user) => user.id === target.fromUserId)];
                try {
                  await rpc(actor, "void_settlement", { p_settlement_id: target.id });
                  expect(target.status).toBe("confirmed");
                  target.status = "voided";
                } catch (error) {
                  expect(classify(error)).toBe("settlement_voided");
                }
                break;
              }
            }

            const actual = sortBalances(
              (await getBalances(groupId)).map((row) => ({
                kind: row.kind as BalanceRow["kind"],
                participantId: row.participant_id,
                netCents: Number(row.net_cents),
              })),
            );
            expect(actual).toEqual(expectedBalances(expenses, settlements));
            await assertLedgerInvariants(groupId);
          }
        },
      ),
      propertyConfig(15),
    );
  }, 600_000);
});

/**
 * create_expense assigns guest ids server-side, so the model reads them back
 * once. Every amount in the model is still the one the test sent.
 */
async function resolveGuestIds(
  expenseId: string,
  payload: ExpensePayload,
): Promise<ExpensePayload> {
  if (!payload.participants.some((participant) => participant.kind === "guest")) {
    return payload;
  }
  const guestIds = await withPg(async (client) => {
    const result = await client.query<{ participant_index: number; guest_id: string }>(
      "select participant_index, guest_id from public.expense_participants " +
        "where expense_id = $1 and guest_id is not null order by participant_index",
      [expenseId],
    );
    return result.rows;
  });
  let cursor = 0;
  return {
    ...payload,
    participants: payload.participants.map((participant) => {
      if (participant.kind !== "guest") return participant;
      const resolved = guestIds[cursor];
      cursor += 1;
      return { ...participant, guestId: resolved.guest_id };
    }),
  };
}
