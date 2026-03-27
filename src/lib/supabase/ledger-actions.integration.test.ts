import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  authenticateAs,
  createTestBill,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import type { Database } from "@/types/database";

type LedgerRow = Database["public"]["Tables"]["ledger"]["Row"];

describe.skipIf(!isIntegrationTestReady)("Ledger and payments RLS", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let billId: string;
  let ledgerId: string;

  beforeEach(async () => {
    [alice, bob, carol] = await createTestUsers(3, { pixKeyType: "email" });

    const bill = await createTestBill(alice.id, {
      status: "active",
      total_amount: 3000,
    });
    billId = bill.id;

    await adminClient!.from("bill_participants").insert({
      bill_id: billId,
      user_id: bob.id,
    });

    const { data: ledger, error: ledgerError } = await adminClient!
      .from("ledger")
      .insert({
        bill_id: billId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 1500,
        status: "pending",
        entry_type: "debt",
      })
      .select()
      .single() as { data: LedgerRow | null; error: unknown };

    if (ledgerError || !ledger) {
      throw new Error(`Failed to create test ledger entry`);
    }
    ledgerId = ledger.id;
  });

  describe("Ledger SELECT", () => {
    it("debtor can read their ledger entry", async () => {
      const bobClient = authenticateAs(bob);
      const { data, error } = await bobClient
        .from("ledger")
        .select("*")
        .eq("id", ledgerId)
        .single() as { data: LedgerRow | null; error: unknown };

      expect(error).toBeNull();
      expect(data!.id).toBe(ledgerId);
    });

    it("creditor can read the ledger entry", async () => {
      const aliceClient = authenticateAs(alice);
      const { data, error } = await aliceClient
        .from("ledger")
        .select("*")
        .eq("id", ledgerId)
        .single() as { data: LedgerRow | null; error: unknown };

      expect(error).toBeNull();
      expect(data!.id).toBe(ledgerId);
    });

    it("non-participant cannot read the ledger entry", async () => {
      const carolClient = authenticateAs(carol);
      const { data, error } = await carolClient
        .from("ledger")
        .select("*")
        .eq("id", ledgerId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });
  });

  describe("Payments INSERT", () => {
    it("debtor can insert a payment", async () => {
      const bobClient = authenticateAs(bob);
      const { error } = await bobClient.from("payments").insert({
        ledger_id: ledgerId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 1500,
        status: "unconfirmed",
      });

      expect(error).toBeNull();
    });

    it("creditor can insert a payment", async () => {
      const aliceClient = authenticateAs(alice);
      const { error } = await aliceClient.from("payments").insert({
        ledger_id: ledgerId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 1500,
        status: "unconfirmed",
      });

      expect(error).toBeNull();
    });

    it("non-participant cannot insert a payment", async () => {
      const carolClient = authenticateAs(carol);
      const { error } = await carolClient.from("payments").insert({
        ledger_id: ledgerId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 1500,
        status: "unconfirmed",
      });

      expect(error).not.toBeNull();
    });
  });

  describe("Payment flow", () => {
    it("inserting full payment transitions ledger to settled", async () => {
      const bobClient = authenticateAs(bob);
      const { error } = await bobClient.from("payments").insert({
        ledger_id: ledgerId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 1500,
        status: "unconfirmed",
      });

      expect(error).toBeNull();

      const { data } = await adminClient!
        .from("ledger")
        .select("status, paid_amount_cents")
        .eq("id", ledgerId)
        .single();

      expect(data!.status).toBe("settled");
      expect(data!.paid_amount_cents).toBe(1500);
    });

    it("inserting partial payment transitions ledger to partially_paid", async () => {
      const bobClient = authenticateAs(bob);
      const { error } = await bobClient.from("payments").insert({
        ledger_id: ledgerId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 500,
        status: "unconfirmed",
      });

      expect(error).toBeNull();

      const { data } = await adminClient!
        .from("ledger")
        .select("status, paid_amount_cents")
        .eq("id", ledgerId)
        .single();

      expect(data!.status).toBe("partially_paid");
      expect(data!.paid_amount_cents).toBe(500);
    });
  });

  describe("Payments SELECT", () => {
    beforeEach(async () => {
      await adminClient!.from("payments").insert({
        ledger_id: ledgerId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 1500,
        status: "unconfirmed",
      });
    });

    it("debtor can read their payment", async () => {
      const bobClient = authenticateAs(bob);
      const { data, error } = await bobClient
        .from("payments")
        .select("*")
        .eq("ledger_id", ledgerId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("creditor can read the payment", async () => {
      const aliceClient = authenticateAs(alice);
      const { data, error } = await aliceClient
        .from("payments")
        .select("*")
        .eq("ledger_id", ledgerId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("non-participant cannot read the payment", async () => {
      const carolClient = authenticateAs(carol);
      const { data, error } = await carolClient
        .from("payments")
        .select("*")
        .eq("ledger_id", ledgerId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });
});
