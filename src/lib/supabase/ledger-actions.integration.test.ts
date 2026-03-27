/**
 * Integration tests for ledger table RLS policies.
 *
 * Tests verify that:
 * 1. Payers (from_user_id) can mark debts as paid_unconfirmed
 * 2. Receivers (to_user_id) can confirm payments as settled
 * 3. Non-participants cannot read or update ledger entries
 * 4. Payers cannot directly settle (must go through receiver confirmation)
 *
 * Run with: npm run test:integration
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  authenticateAs,
  createTestBill,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

// Skip all tests if integration environment is not ready
describe.skipIf(!isIntegrationTestReady)("Ledger RLS Policies", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let billId: string;
  let ledgerId: string;

  beforeEach(async () => {
    // Create three test users in parallel
    [alice, bob, carol] = await createTestUsers(3, {
      pixKeyType: "email",
    });

    // Create a bill with Alice as creator
    const bill = await createTestBill(alice.id, {
      status: "active",
      total_amount: 3000, // 30.00 BRL
    });
    billId = bill.id;

    // Add Bob as a participant (he owes Alice)
    await adminClient!.from("bill_participants").insert({
      bill_id: billId,
      user_id: bob.id,
    });

    // Create a ledger entry: Bob owes Alice 1500 centavos
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
      .single();

    if (ledgerError || !ledger) {
      throw new Error(`Failed to create test ledger entry: ${ledgerError?.message}`);
    }
    ledgerId = ledger.id;
  });

  describe("SELECT policy: Participants can read ledger entries", () => {
    it("payer (from_user_id) can read the ledger entry", async () => {
      const bobClient = authenticateAs(bob);

      const { data, error } = await bobClient
        .from("ledger")
        .select("*")
        .eq("id", ledgerId)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.id).toBe(ledgerId);
    });

    it("receiver (to_user_id) can read the ledger entry", async () => {
      const aliceClient = authenticateAs(alice);

      const { data, error } = await aliceClient
        .from("ledger")
        .select("*")
        .eq("id", ledgerId)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.id).toBe(ledgerId);
    });

    it("non-participant cannot read the ledger entry", async () => {
      const carolClient = authenticateAs(carol);

      const { data, error } = await carolClient
        .from("ledger")
        .select("*")
        .eq("id", ledgerId)
        .maybeSingle();

      // RLS should block access - no error, but no data either
      expect(error).toBeNull();
      expect(data).toBeNull();
    });
  });

  describe("UPDATE policy: Payers can mark themselves as paid", () => {
    it("payer can update status to paid_unconfirmed", async () => {
      const bobClient = authenticateAs(bob);

      const { error } = await bobClient
        .from("ledger")
        .update({
          status: "paid_unconfirmed",
          paid_at: new Date().toISOString(),
        })
        .eq("id", ledgerId);

      expect(error).toBeNull();

      // Verify the update succeeded
      const { data } = await adminClient!
        .from("ledger")
        .select("status")
        .eq("id", ledgerId)
        .single();
      expect(data!.status).toBe("paid_unconfirmed");
    });

    it("payer cannot directly settle (must go through receiver)", async () => {
      const bobClient = authenticateAs(bob);

      // Bob tries to mark as settled directly - should fail
      const { error } = await bobClient
        .from("ledger")
        .update({
          status: "settled",
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", ledgerId);

      // RLS policy only allows status = 'paid_unconfirmed' for payers
      expect(error).toBeDefined();
      expect(error!.code).toBe("PGRST301"); // RLS policy violation
    });

    it("non-participant cannot update to paid_unconfirmed", async () => {
      const carolClient = authenticateAs(carol);

      const { error } = await carolClient
        .from("ledger")
        .update({
          status: "paid_unconfirmed",
        })
        .eq("id", ledgerId);

      // RLS should block this - non-participant cannot update
      expect(error).toBeDefined();
      expect(error!.code).toBe("PGRST301");
    });

    it("receiver cannot mark as paid_unconfirmed (only payer can)", async () => {
      const aliceClient = authenticateAs(alice);

      const { error } = await aliceClient
        .from("ledger")
        .update({
          status: "paid_unconfirmed",
        })
        .eq("id", ledgerId);

      expect(error).toBeDefined();
      expect(error!.code).toBe("PGRST301");
    });
  });

  describe("UPDATE policy: Receivers can confirm payment", () => {
    // For these tests, we need the ledger to be in paid_unconfirmed state first
    beforeEach(async () => {
      // Mark as paid_unconfirmed using admin client
      await adminClient!
        .from("ledger")
        .update({ status: "paid_unconfirmed", paid_at: new Date().toISOString() })
        .eq("id", ledgerId);
    });

    it("receiver can update status to settled", async () => {
      const aliceClient = authenticateAs(alice);

      const { error } = await aliceClient
        .from("ledger")
        .update({
          status: "settled",
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", ledgerId);

      expect(error).toBeNull();

      // Verify the update succeeded
      const { data } = await adminClient!
        .from("ledger")
        .select("status")
        .eq("id", ledgerId)
        .single();
      expect(data!.status).toBe("settled");
    });

    it("payer cannot confirm settlement (only receiver can)", async () => {
      const bobClient = authenticateAs(bob);

      const { error } = await bobClient
        .from("ledger")
        .update({
          status: "settled",
        })
        .eq("id", ledgerId);

      // Bob is the payer (from_user_id), not the receiver
      // The "Receivers can confirm payment" policy requires to_user_id = auth.uid()
      expect(error).toBeDefined();
      expect(error!.code).toBe("PGRST301");
    });

    it("non-participant cannot confirm settlement", async () => {
      const carolClient = authenticateAs(carol);

      const { error } = await carolClient
        .from("ledger")
        .update({
          status: "settled",
        })
        .eq("id", ledgerId);

      expect(error).toBeDefined();
      expect(error!.code).toBe("PGRST301");
    });
  });

  describe("Full payment flow", () => {
    it("allows complete payment flow: pending -> paid_unconfirmed -> settled", async () => {
      const bobClient = authenticateAs(bob);
      const aliceClient = authenticateAs(alice);

      // Step 1: Bob marks as paid_unconfirmed
      const { error: step1Error } = await bobClient
        .from("ledger")
        .update({
          status: "paid_unconfirmed",
          paid_at: new Date().toISOString(),
        })
        .eq("id", ledgerId);

      expect(step1Error).toBeNull();

      // Step 2: Alice confirms the payment
      const { error: step2Error } = await aliceClient
        .from("ledger")
        .update({
          status: "settled",
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", ledgerId);

      expect(step2Error).toBeNull();

      // Verify final state
      const { data } = await adminClient!
        .from("ledger")
        .select("status, paid_at, confirmed_at")
        .eq("id", ledgerId)
        .single();

      expect(data!.status).toBe("settled");
      expect(data!.paid_at).not.toBeNull();
      expect(data!.confirmed_at).not.toBeNull();
    });
  });
});
