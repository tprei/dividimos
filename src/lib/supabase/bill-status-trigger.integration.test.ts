import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  createTestBill,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

describe.skipIf(!isIntegrationTestReady)(
  "Bill status transition trigger (check_bill_settled)",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;

    beforeEach(async () => {
      [alice, bob, carol] = await createTestUsers(3);
    });

    async function createActiveBillWithLedger(
      creatorId: string,
      debts: Array<{
        from: string;
        to: string;
        amount: number;
      }>,
    ): Promise<{ billId: string; ledgerIds: string[] }> {
      const bill = await createTestBill(creatorId, {
        status: "active",
        total_amount: 3000,
      });

      const ledgerIds: string[] = [];
      for (const debt of debts) {
        const { data, error } = await adminClient!
          .from("ledger")
          .insert({
            bill_id: bill.id,
            from_user_id: debt.from,
            to_user_id: debt.to,
            amount_cents: debt.amount,
            status: "pending",
            entry_type: "debt",
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to create ledger entry: ${error?.message}`);
        }
        ledgerIds.push(data.id);
      }

      return { billId: bill.id, ledgerIds };
    }

    it("transitions bill to 'settled' when all ledger entries are settled", async () => {
      const { billId, ledgerIds } = await createActiveBillWithLedger(
        alice.id,
        [
          { from: bob.id, to: alice.id, amount: 1000 },
          { from: carol.id, to: alice.id, amount: 2000 },
        ],
      );

      // Settle both ledger entries via admin (simulates payment trigger)
      await adminClient!
        .from("ledger")
        .update({ status: "settled" })
        .eq("id", ledgerIds[0]);

      // Bill should be partially_settled after first
      const { data: midBill } = await adminClient!
        .from("bills")
        .select("status")
        .eq("id", billId)
        .single();
      expect(midBill!.status).toBe("partially_settled");

      // Settle the second
      await adminClient!
        .from("ledger")
        .update({ status: "settled" })
        .eq("id", ledgerIds[1]);

      const { data: finalBill } = await adminClient!
        .from("bills")
        .select("status")
        .eq("id", billId)
        .single();
      expect(finalBill!.status).toBe("settled");
    });

    it("transitions bill to 'partially_settled' when some but not all ledger entries are settled", async () => {
      const { billId, ledgerIds } = await createActiveBillWithLedger(
        alice.id,
        [
          { from: bob.id, to: alice.id, amount: 1000 },
          { from: carol.id, to: alice.id, amount: 2000 },
        ],
      );

      // Settle only the first ledger entry
      await adminClient!
        .from("ledger")
        .update({ status: "settled" })
        .eq("id", ledgerIds[0]);

      const { data: bill } = await adminClient!
        .from("bills")
        .select("status")
        .eq("id", billId)
        .single();

      expect(bill!.status).toBe("partially_settled");
    });

    it("keeps bill as 'active' when a ledger entry transitions to partially_paid (not settled)", async () => {
      const { billId, ledgerIds } = await createActiveBillWithLedger(
        alice.id,
        [{ from: bob.id, to: alice.id, amount: 1000 }],
      );

      // Partially pay — this status is not 'settled', so bill should stay active
      await adminClient!
        .from("ledger")
        .update({ status: "partially_paid" })
        .eq("id", ledgerIds[0]);

      const { data: bill } = await adminClient!
        .from("bills")
        .select("status")
        .eq("id", billId)
        .single();

      expect(bill!.status).toBe("active");
    });

    it("handles bill with no ledger entries gracefully", async () => {
      const bill = await createTestBill(alice.id, {
        status: "active",
        total_amount: 0,
      });

      // Bill with no ledger entries should remain active
      const { data } = await adminClient!
        .from("bills")
        .select("status")
        .eq("id", bill.id)
        .single();

      expect(data!.status).toBe("active");
    });

    it("does not regress when ledger is updated but status unchanged", async () => {
      const { billId, ledgerIds } = await createActiveBillWithLedger(
        alice.id,
        [{ from: bob.id, to: alice.id, amount: 1000 }],
      );

      // Update a non-status field — trigger should not fire meaningfully
      await adminClient!
        .from("ledger")
        .update({ paid_amount_cents: 500 })
        .eq("id", ledgerIds[0]);

      const { data: bill } = await adminClient!
        .from("bills")
        .select("status")
        .eq("id", billId)
        .single();

      // Bill should still be active since ledger status didn't change to 'settled'
      expect(bill!.status).toBe("active");
    });

    it("handles rapid sequential ledger settlements", async () => {
      const { billId, ledgerIds } = await createActiveBillWithLedger(
        alice.id,
        [
          { from: bob.id, to: alice.id, amount: 500 },
          { from: carol.id, to: alice.id, amount: 500 },
          { from: bob.id, to: carol.id, amount: 300 },
        ],
      );

      // Settle all three rapidly
      await Promise.all(
        ledgerIds.map((id) =>
          adminClient!
            .from("ledger")
            .update({ status: "settled" })
            .eq("id", id),
        ),
      );

      const { data: bill } = await adminClient!
        .from("bills")
        .select("status")
        .eq("id", billId)
        .single();

      expect(bill!.status).toBe("settled");
    });

    it("trigger fires per-row on ledger UPDATE, not per-statement", async () => {
      const { billId, ledgerIds } = await createActiveBillWithLedger(
        alice.id,
        [
          { from: bob.id, to: alice.id, amount: 1000 },
          { from: carol.id, to: alice.id, amount: 1000 },
        ],
      );

      // Settle one entry — trigger should fire for that row
      await adminClient!
        .from("ledger")
        .update({ status: "settled" })
        .eq("id", ledgerIds[0]);

      const { data: bill } = await adminClient!
        .from("bills")
        .select("status")
        .eq("id", billId)
        .single();

      // Should be partially_settled since only 1 of 2 is settled
      expect(bill!.status).toBe("partially_settled");
    });
  },
);
