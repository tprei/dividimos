import { describe, expect, it } from "vitest";

import {
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  equalSplitPayload,
  withPg,
} from "@/test/integration-helpers";
import { isIntegrationTestReady, untrackTestGroup } from "@/test/integration-setup";
import { assertLedgerInvariants } from "@/test/ledger-invariants";

/**
 * Every other ledger suite trusts assertLedgerInvariants to notice corruption.
 * These cases corrupt a group on purpose so a harness that silently stopped
 * checking cannot pass.
 */
describe.skipIf(!isIntegrationTestReady)("assertLedgerInvariants", () => {
  async function corruptibleGroup(): Promise<{ groupId: string; expenseId: string; payerId: string }> {
    const [alice, bruno] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const expense = await createExpense(alice, {
      groupId,
      totalCents: 4000,
      payload: equalSplitPayload([alice.id, bruno.id], 4000),
    });
    untrackTestGroup(groupId);
    return { groupId, expenseId: expense.expenseId, payerId: alice.id };
  }

  it("passes on a group built through the RPCs", async () => {
    const { groupId } = await corruptibleGroup();
    await expect(assertLedgerInvariants(groupId)).resolves.toBeUndefined();
  });

  it("catches a projection that no longer sums to zero", async () => {
    const { groupId, payerId } = await corruptibleGroup();
    await withPg((client) =>
      client.query(
        "update public.group_balances set net_cents = net_cents + 1 " +
          "where group_id = $1 and participant_id = $2",
        [groupId, payerId],
      ),
    );

    await expect(assertLedgerInvariants(groupId)).rejects.toThrow(/\[1\][\s\S]*\[3\]/);
  });

  it("catches a materialized participant that drifted from its payload", async () => {
    const { groupId, expenseId } = await corruptibleGroup();
    await withPg((client) =>
      client.query(
        "update public.expense_participants set share_cents = share_cents + 1 " +
          "where expense_id = $1 and participant_index = 0",
        [expenseId],
      ),
    );

    await expect(assertLedgerInvariants(groupId)).rejects.toThrow(/\[4\]/);
  });

  it("catches participant rows left behind by a deleted expense", async () => {
    const { groupId, expenseId } = await corruptibleGroup();
    await withPg((client) =>
      client.query("update public.expenses set status = 'deleted' where id = $1", [expenseId]),
    );

    await expect(assertLedgerInvariants(groupId)).rejects.toThrow(/\[5\]/);
  });

  it("catches a zeroed row left in the projection", async () => {
    const { groupId } = await corruptibleGroup();
    await withPg((client) =>
      client.query(
        "insert into public.group_balances (group_id, kind, participant_id, net_cents) " +
          "values ($1, 'guest', gen_random_uuid(), 0)",
        [groupId],
      ),
    );

    await expect(assertLedgerInvariants(groupId)).rejects.toThrow(/\[2\]/);
  });
});
