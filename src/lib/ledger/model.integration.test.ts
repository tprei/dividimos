import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { allocateByWeights } from "@/lib/expense-money";
import { decodeGroupSnapshot } from "@/lib/ledger/decode";
import {
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { propertyConfig } from "@/test/property";
import type { GroupSnapshot } from "@/types/ledger";
import {
  type ExpenseFact,
  type LedgerFact,
  projectBalances,
  projectPairwiseEdges,
} from "./model";

interface ExpenseSpec {
  participants: number[];
  weights: number[];
  totalCents: number;
  splitPayers: boolean;
  edit: boolean;
  remove: boolean;
  restore: boolean;
}

interface SettlementSpec {
  from: number;
  to: number;
  amountCents: number;
  voided: boolean;
}

interface ScriptSpec {
  expenses: ExpenseSpec[];
  settlements: SettlementSpec[];
}

const USER_COUNT = 4;

const expenseSpec = fc
  .record({
    participants: fc.uniqueArray(fc.nat({ max: USER_COUNT - 1 }), {
      minLength: 2,
      maxLength: USER_COUNT,
    }),
    weights: fc.array(fc.integer({ min: 1, max: 9 }), { minLength: USER_COUNT, maxLength: USER_COUNT }),
    totalCents: fc.integer({ min: 100, max: 50_000 }),
    splitPayers: fc.boolean(),
    edit: fc.boolean(),
    remove: fc.boolean(),
    restore: fc.boolean(),
  })
  .map((spec): ExpenseSpec => ({ ...spec, weights: spec.weights.slice(0, spec.participants.length) }));

const settlementSpec = fc
  .record({
    from: fc.nat({ max: USER_COUNT - 1 }),
    offset: fc.nat({ max: USER_COUNT - 2 }),
    amountCents: fc.integer({ min: 1, max: 20_000 }),
    voided: fc.boolean(),
  })
  .map(
    ({ from, offset, amountCents, voided }): SettlementSpec => ({
      from,
      to: (from + 1 + offset) % USER_COUNT,
      amountCents,
      voided,
    }),
  );

const scriptSpec = fc.record({
  expenses: fc.array(expenseSpec, { minLength: 1, maxLength: 4 }),
  settlements: fc.array(settlementSpec, { maxLength: 3 }),
});

function sharesFor(totalCents: number, weights: number[]): number[] {
  const allocated = allocateByWeights(totalCents, weights);
  if (!allocated.ok) {
    throw new Error(`share allocation failed: ${allocated.issue.code}`);
  }
  return allocated.value.map((cents) => cents as number);
}

function payloadFor(userIds: string[], shares: number[], payers: { participantIndex: number; amountCents: number }[]) {
  return {
    items: [],
    participants: userIds.map((userId) => ({ kind: "user", userId })),
    shares,
    payers,
    itemAssignments: null,
  };
}

function rowsFor(
  userIds: string[],
  shares: number[],
  payers: { participantIndex: number; amountCents: number }[],
): ExpenseFact["rows"] {
  return userIds.map((participantId, index) => ({
    participantId,
    shareCents: shares[index],
    paidCents: payers
      .filter((payer) => payer.participantIndex === index)
      .reduce((sum, payer) => sum + payer.amountCents, 0),
  }));
}

describe.skipIf(!isIntegrationTestReady)("ledger model parity", () => {
  let users: TestUser[];

  beforeAll(async () => {
    users = await createTestUsers(USER_COUNT);
  });

  async function readSnapshot(groupId: string): Promise<GroupSnapshot> {
    const client = authenticateAs(users[0]);
    const { data, error } = await client.rpc("get_group", { p_group_id: groupId });
    if (error) {
      throw new Error(`get_group failed: ${error.message}`);
    }
    const decoded = decodeGroupSnapshot(data);
    if (!decoded.ok) {
      throw new Error(`get_group payload rejected at ${decoded.issue.path.join(".")}`);
    }
    return decoded.value;
  }

  async function applyScript(groupId: string, script: ScriptSpec): Promise<LedgerFact[]> {
    const facts: LedgerFact[] = [];

    for (const [index, spec] of script.expenses.entries()) {
      const participantIds = spec.participants.map((position) => users[position].id);
      const actor = users[spec.participants[0]];
      const shares = sharesFor(spec.totalCents, spec.weights);
      const firstPaid = spec.splitPayers ? Math.max(1, Math.floor(spec.totalCents / 2)) : spec.totalCents;
      const payers = spec.splitPayers
        ? [
            { participantIndex: 0, amountCents: firstPaid },
            { participantIndex: 1, amountCents: spec.totalCents - firstPaid },
          ].filter((payer) => payer.amountCents > 0)
        : [{ participantIndex: 0, amountCents: spec.totalCents }];

      const created = await createExpense(actor, {
        groupId,
        title: `Parity ${index}`,
        totalCents: spec.totalCents,
        payload: payloadFor(participantIds, shares, payers),
      });

      let rows = rowsFor(participantIds, shares, payers);
      let versionNo = created.versionNo;
      const client = authenticateAs(actor);

      if (spec.edit && shares[0] > 1) {
        const edited = [...shares];
        edited[0] -= 1;
        edited[1] += 1;
        const { error } = await client.rpc("edit_expense", {
          p_expense_id: created.expenseId,
          p_expected_version_no: versionNo,
          p_occurred_on: new Date().toISOString().slice(0, 10),
          p_title: `Parity ${index} revisado`,
          p_merchant_name: "",
          p_expense_type: "single_amount",
          p_total_cents: spec.totalCents,
          p_service_fee_bps: 0,
          p_fixed_fee_cents: 0,
          p_payload: payloadFor(participantIds, edited, payers),
        });
        if (error) {
          throw new Error(`edit_expense failed: ${error.message}`);
        }
        rows = rowsFor(participantIds, edited, payers);
        versionNo += 1;
      }

      let status: ExpenseFact["status"] = "active";
      if (spec.remove) {
        const { error } = await client.rpc("delete_expense", { p_expense_id: created.expenseId });
        if (error) {
          throw new Error(`delete_expense failed: ${error.message}`);
        }
        status = "deleted";

        if (spec.restore) {
          const { error: restoreError } = await client.rpc("restore_expense", {
            p_expense_id: created.expenseId,
          });
          if (restoreError) {
            throw new Error(`restore_expense failed: ${restoreError.message}`);
          }
          status = "active";
        }
      }

      facts.push({
        kind: "expense",
        expenseId: created.expenseId,
        clientId: `parity-${index}`,
        status,
        versionNo,
        rows,
      });
    }

    for (const spec of script.settlements) {
      const payer = users[spec.from];
      const payee = users[spec.to];
      const client = authenticateAs(payer);
      const { data, error } = await client.rpc("record_settlement", {
        p_operation_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_from_user_id: payer.id,
        p_to_user_id: payee.id,
        p_amount_cents: spec.amountCents,
        p_allow_overpay: true,
      });
      if (error) {
        throw new Error(`record_settlement failed: ${error.message}`);
      }
      const settlementId = (data as { settlementId: string }).settlementId;

      if (spec.voided) {
        const { error: voidError } = await client.rpc("void_settlement", {
          p_settlement_id: settlementId,
        });
        if (voidError) {
          throw new Error(`void_settlement failed: ${voidError.message}`);
        }
      }

      facts.push({
        kind: "settlement",
        settlementId,
        operationId: settlementId,
        status: spec.voided ? "voided" : "confirmed",
        fromUserId: payer.id,
        toUserId: payee.id,
        amountCents: spec.amountCents,
      });
    }

    return facts;
  }

  it("projects the same balances and pairwise edges as the database", async () => {
    let caseIndex = 0;
    await fc.assert(
      fc.asyncProperty(scriptSpec, async (script) => {
        caseIndex += 1;
        const groupId = await createGroupWithMembers(
          users[0],
          users.slice(1),
          `Parity ${caseIndex}`,
        );

        const facts = await applyScript(groupId, script);
        const snapshot = await readSnapshot(groupId);

        expect(snapshot.balances).toEqual(projectBalances(facts));
        expect(snapshot.pairwiseEdges).toEqual(projectPairwiseEdges(facts));
      }),
      propertyConfig(50),
    );
  });
});
