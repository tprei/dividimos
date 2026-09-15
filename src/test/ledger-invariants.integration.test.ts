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

  it("catches a raw version payload edit the projection never saw", async () => {
    const { groupId, expenseId } = await corruptibleGroup();
    await withPg(async (client) => {
      const { rows } = await client.query<{ payload: { shares: number[] } }>(
        "select payload from public.expense_versions ev " +
          "join public.expenses e on e.id = ev.expense_id " +
          "where e.id = $1 and ev.version_no = e.current_version_no",
        [expenseId],
      );
      const payload = rows[0].payload;
      payload.shares = [payload.shares[0] + 1, payload.shares[1] - 1];
      await client.query(
        "update public.expense_versions set payload = $2 " +
          "where expense_id = $1 and version_no = " +
          "(select current_version_no from public.expenses where id = $1)",
        [expenseId, JSON.stringify(payload)],
      );
    });

    await expect(assertLedgerInvariants(groupId)).rejects.toThrow(/\[3\]/);
  });

  it("rejects a zeroed row in the projection via group_balances_nonzero constraint", async () => {
    const { groupId } = await corruptibleGroup();
    await expect(
      withPg((client) =>
        client.query(
          "insert into public.group_balances (group_id, kind, participant_id, net_cents) " +
            "values ($1, 'guest', gen_random_uuid(), 0)",
          [groupId],
        ),
      ),
    ).rejects.toThrow(/group_balances_nonzero/);
  });
});
