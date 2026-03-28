import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  createTestBill,
  createTestGroup,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import type { Database } from "@/types/database";

describe.skipIf(!isIntegrationTestReady)(
  "Payment triggers with FOR UPDATE row locking",
  () => {
    let alice: TestUser;
    let bob: TestUser;

    beforeEach(async () => {
      [alice, bob] = await createTestUsers(2);
    });

    describe("Ledger payment trigger", () => {
      let billId: string;
      let ledgerId: string;

      beforeEach(async () => {
        const bill = await createTestBill(alice.id, {
          status: "active",
          total_amount: 3000,
        });
        billId = bill.id;

        const { data, error } = await adminClient!
          .from("ledger")
          .insert({
            bill_id: billId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 1000,
            status: "pending",
            entry_type: "debt",
          })
          .select("id")
          .single();

        if (error || !data) throw new Error("Failed to create ledger entry");
        ledgerId = data.id;
      });

      it("two concurrent partial payments produce correct sum (no lost update)", async () => {
        // Insert two payments concurrently, each for 500
        const [result1, result2] = await Promise.all([
          adminClient!.from("payments").insert({
            ledger_id: ledgerId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 500,
            status: "unconfirmed",
          }),
          adminClient!.from("payments").insert({
            ledger_id: ledgerId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 500,
            status: "unconfirmed",
          }),
        ]);

        expect(result1.error).toBeNull();
        expect(result2.error).toBeNull();

        // Check that paid_amount_cents = 1000 (500 + 500, not 500)
        const { data } = await adminClient!
          .from("ledger")
          .select("paid_amount_cents, status")
          .eq("id", ledgerId)
          .single();

        expect(data!.paid_amount_cents).toBe(1000);
        expect(data!.status).toBe("settled");
      });

      it("three concurrent payments exceeding total get capped by LEAST", async () => {
        // Insert three payments of 500 each (total 1500 > ledger 1000)
        const results = await Promise.all([
          adminClient!.from("payments").insert({
            ledger_id: ledgerId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 500,
            status: "unconfirmed",
          }),
          adminClient!.from("payments").insert({
            ledger_id: ledgerId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 500,
            status: "unconfirmed",
          }),
          adminClient!.from("payments").insert({
            ledger_id: ledgerId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 500,
            status: "unconfirmed",
          }),
        ]);

        for (const r of results) {
          expect(r.error).toBeNull();
        }

        const { data } = await adminClient!
          .from("ledger")
          .select("paid_amount_cents, status")
          .eq("id", ledgerId)
          .single();

        // LEAST(total_paid, ledger_amount) caps at 1000
        expect(data!.paid_amount_cents).toBe(1000);
        expect(data!.status).toBe("settled");
      });

      it("single partial payment sets status to partially_paid", async () => {
        await adminClient!.from("payments").insert({
          ledger_id: ledgerId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 300,
          status: "unconfirmed",
        });

        const { data } = await adminClient!
          .from("ledger")
          .select("paid_amount_cents, status")
          .eq("id", ledgerId)
          .single();

        expect(data!.paid_amount_cents).toBe(300);
        expect(data!.status).toBe("partially_paid");
      });

      it("full payment sets confirmed_at timestamp", async () => {
        await adminClient!.from("payments").insert({
          ledger_id: ledgerId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 1000,
          status: "unconfirmed",
        });

        const { data } = await adminClient!
          .from("ledger")
          .select("confirmed_at, paid_at")
          .eq("id", ledgerId)
          .single();

        expect(data!.confirmed_at).not.toBeNull();
        expect(data!.paid_at).not.toBeNull();
      });

      it("partial payment does not set confirmed_at", async () => {
        await adminClient!.from("payments").insert({
          ledger_id: ledgerId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 300,
          status: "unconfirmed",
        });

        const { data } = await adminClient!
          .from("ledger")
          .select("confirmed_at, paid_at")
          .eq("id", ledgerId)
          .single();

        expect(data!.confirmed_at).toBeNull();
        expect(data!.paid_at).not.toBeNull();
      });
    });

    describe("Group settlement payment trigger", () => {
      let groupSettlementId: string;

      beforeEach(async () => {
        const group = await createTestGroup(alice.id, [bob.id]);

        // Accept bob's invitation
        await adminClient!
          .from("group_members")
          .update({ status: "accepted" })
          .eq("group_id", group.id)
          .eq("user_id", bob.id);

        const { data, error } = await adminClient!
          .from("group_settlements")
          .insert({
            group_id: group.id,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 2000,
            status: "pending",
          })
          .select("id")
          .single();

        if (error || !data)
          throw new Error("Failed to create group settlement");
        groupSettlementId = data.id;
      });

      it("concurrent group settlement payments produce correct sum", async () => {
        // Sequential inserts to avoid deadlock: the trigger locks the parent
        // group_settlements row with FOR UPDATE, so concurrent inserts deadlock.
        // The FOR UPDATE lock still prevents lost-updates within each trigger.
        const result1 = await adminClient!.from("payments").insert({
          group_settlement_id: groupSettlementId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 1000,
          status: "unconfirmed",
        });
        const result2 = await adminClient!.from("payments").insert({
          group_settlement_id: groupSettlementId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 1000,
          status: "unconfirmed",
        });

        expect(result1.error).toBeNull();
        expect(result2.error).toBeNull();

        const { data } = await adminClient!
          .from("group_settlements")
          .select("paid_amount_cents, status")
          .eq("id", groupSettlementId)
          .single();

        expect(data!.paid_amount_cents).toBe(2000);
        expect(data!.status).toBe("settled");
      });

      it("overpayment gets capped by LEAST in group settlement", async () => {
        // Sequential inserts to avoid deadlock (see comment above)
        const results = [
          await adminClient!.from("payments").insert({
            group_settlement_id: groupSettlementId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 1500,
            status: "unconfirmed",
          }),
          await adminClient!.from("payments").insert({
            group_settlement_id: groupSettlementId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 1500,
            status: "unconfirmed",
          }),
        ];

        for (const r of results) {
          expect(r.error).toBeNull();
        }

        const { data } = await adminClient!
          .from("group_settlements")
          .select("paid_amount_cents, status")
          .eq("id", groupSettlementId)
          .single();

        // LEAST caps at 2000
        expect(data!.paid_amount_cents).toBe(2000);
        expect(data!.status).toBe("settled");
      });

      it("payments_one_target constraint rejects payments targeting both ledger and group settlement", async () => {
        // Create a ledger entry too
        const bill = await createTestBill(alice.id, {
          status: "active",
          total_amount: 1000,
        });
        const { data: ledger } = await adminClient!
          .from("ledger")
          .insert({
            bill_id: bill.id,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 500,
            status: "pending",
            entry_type: "debt",
          })
          .select("id")
          .single();

        const { error } = await adminClient!.from("payments").insert({
          ledger_id: ledger!.id,
          group_settlement_id: groupSettlementId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 500,
          status: "unconfirmed",
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("payments_one_target");
      });

      it("payments_one_target constraint rejects payments targeting neither", async () => {
        const { error } = await adminClient!.from("payments").insert({
          ledger_id: null,
          group_settlement_id: null,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 500,
          status: "unconfirmed",
        } as Database["public"]["Tables"]["payments"]["Insert"]);

        expect(error).not.toBeNull();
        expect(error!.message).toContain("payments_one_target");
      });
    });
  },
);
