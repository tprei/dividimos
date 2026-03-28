import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  authenticateAs,
  createTestBill,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import type { Database } from "@/types/database";

type BillRow = Database["public"]["Tables"]["bills"]["Row"];
type BillItemRow = Database["public"]["Tables"]["bill_items"]["Row"];

describe.skipIf(!isIntegrationTestReady)("Bill CRUD + RLS", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeEach(async () => {
    [alice, bob, carol] = await createTestUsers(3);
  });

  describe("Bills SELECT", () => {
    it("creator can read their own bill", async () => {
      const bill = await createTestBill(alice.id);
      const aliceClient = authenticateAs(alice);

      const result = await aliceClient
        .from("bills")
        .select("*")
        .eq("id", bill.id)
        .single();

      expect(result.error).toBeNull();
      expect((result.data as BillRow).id).toBe(bill.id);
    });

    it("participant can read the bill", async () => {
      const bill = await createTestBill(alice.id);
      await adminClient!.from("bill_participants").insert({
        bill_id: bill.id,
        user_id: bob.id,
        invited_by: alice.id,
      });

      const bobClient = authenticateAs(bob);
      const result2 = await bobClient
        .from("bills")
        .select("*")
        .eq("id", bill.id)
        .single();

      expect(result2.error).toBeNull();
      expect((result2.data as BillRow).id).toBe(bill.id);
    });

    it("non-participant cannot read the bill", async () => {
      const bill = await createTestBill(alice.id);
      const carolClient = authenticateAs(carol);

      const { data, error } = await carolClient
        .from("bills")
        .select("*")
        .eq("id", bill.id)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });
  });

  describe("Bills INSERT", () => {
    it("authenticated user can create a bill with their own creator_id", async () => {
      const aliceClient = authenticateAs(alice);

      const result = await aliceClient
        .from("bills")
        .insert({
          creator_id: alice.id,
          title: "My new bill",
          status: "draft",
          total_amount: 0,
          total_amount_input: 0,
        })
        .select()
        .single();

      expect(result.error).toBeNull();
      expect((result.data as BillRow).creator_id).toBe(alice.id);
    });

    it("user cannot create a bill with another user as creator_id", async () => {
      const aliceClient = authenticateAs(alice);

      const { error } = await aliceClient.from("bills").insert({
        creator_id: bob.id,
        title: "Spoofed bill",
        status: "draft",
        total_amount: 0,
        total_amount_input: 0,
      });

      expect(error).not.toBeNull();
    });
  });

  describe("Bills UPDATE", () => {
    it("creator can update their own bill", async () => {
      const bill = await createTestBill(alice.id);
      const aliceClient = authenticateAs(alice);

      const { error } = await aliceClient
        .from("bills")
        .update({ title: "Updated title" })
        .eq("id", bill.id);

      expect(error).toBeNull();
    });

    it("participant can update bill status", async () => {
      const bill = await createTestBill(alice.id, { status: "draft" });
      await adminClient!.from("bill_participants").insert({
        bill_id: bill.id,
        user_id: bob.id,
        invited_by: alice.id,
      });

      const bobClient = authenticateAs(bob);
      const { error } = await bobClient
        .from("bills")
        .update({ status: "active" })
        .eq("id", bill.id);

      // participants_update_bill_status allows this
      expect(error).toBeNull();
    });

    it("non-participant cannot update the bill", async () => {
      const bill = await createTestBill(alice.id);
      const carolClient = authenticateAs(carol);

      const { error } = await carolClient
        .from("bills")
        .update({ title: "Hacked" })
        .eq("id", bill.id);

      expect(error).not.toBeNull();
    });
  });

  describe("Bills DELETE", () => {
    it("creator can delete their own draft bill", async () => {
      const bill = await createTestBill(alice.id, { status: "draft" });
      const aliceClient = authenticateAs(alice);

      const { error } = await aliceClient
        .from("bills")
        .delete()
        .eq("id", bill.id);

      expect(error).toBeNull();
    });

    it("creator cannot delete an active bill", async () => {
      const bill = await createTestBill(alice.id, { status: "active" });
      const aliceClient = authenticateAs(alice);

      const { error } = await aliceClient
        .from("bills")
        .delete()
        .eq("id", bill.id);

      expect(error).not.toBeNull();
    });

    it("creator cannot delete a settled bill", async () => {
      const bill = await createTestBill(alice.id, { status: "settled" });
      const aliceClient = authenticateAs(alice);

      const { error } = await aliceClient
        .from("bills")
        .delete()
        .eq("id", bill.id);

      expect(error).not.toBeNull();
    });

    it("non-creator cannot delete even a draft bill", async () => {
      const bill = await createTestBill(alice.id, { status: "draft" });
      const bobClient = authenticateAs(bob);

      const { error } = await bobClient
        .from("bills")
        .delete()
        .eq("id", bill.id);

      expect(error).not.toBeNull();
    });
  });

  describe("Bill items RLS", () => {
    let billId: string;
    let itemId: string;

    beforeEach(async () => {
      const bill = await createTestBill(alice.id);
      billId = bill.id;

      const { data: itemData } = await adminClient!
        .from("bill_items")
        .insert({
          bill_id: billId,
          description: "Test item",
          unit_price_cents: 1000,
          total_price_cents: 1000,
        })
        .select()
        .single();

      itemId = (itemData as BillItemRow).id;
    });

    it("creator can read items", async () => {
      const aliceClient = authenticateAs(alice);
      const { data, error } = await aliceClient
        .from("bill_items")
        .select("*")
        .eq("bill_id", billId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("participant can read items", async () => {
      await adminClient!.from("bill_participants").insert({
        bill_id: billId,
        user_id: bob.id,
        invited_by: alice.id,
      });

      const bobClient = authenticateAs(bob);
      const { data, error } = await bobClient
        .from("bill_items")
        .select("*")
        .eq("bill_id", billId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("non-participant cannot read items", async () => {
      const carolClient = authenticateAs(carol);
      const { data, error } = await carolClient
        .from("bill_items")
        .select("*")
        .eq("bill_id", billId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("creator can insert items", async () => {
      const aliceClient = authenticateAs(alice);
      const { error } = await aliceClient.from("bill_items").insert({
        bill_id: billId,
        description: "Another item",
        unit_price_cents: 500,
        total_price_cents: 500,
      });

      expect(error).toBeNull();
    });

    it("participant cannot insert items", async () => {
      await adminClient!.from("bill_participants").insert({
        bill_id: billId,
        user_id: bob.id,
        invited_by: alice.id,
      });

      const bobClient = authenticateAs(bob);
      const { error } = await bobClient.from("bill_items").insert({
        bill_id: billId,
        description: "Unauthorized item",
        unit_price_cents: 500,
        total_price_cents: 500,
      });

      expect(error).not.toBeNull();
    });
  });

  describe("Ledger INSERT by creator", () => {
    it("creator can insert ledger entries for their bill", async () => {
      const bill = await createTestBill(alice.id, { status: "active" });
      const aliceClient = authenticateAs(alice);

      const { error } = await aliceClient.from("ledger").insert({
        bill_id: bill.id,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 1000,
        status: "pending",
        entry_type: "debt",
      });

      expect(error).toBeNull();
    });

    it("non-creator cannot insert ledger entries", async () => {
      const bill = await createTestBill(alice.id, { status: "active" });
      const bobClient = authenticateAs(bob);

      const { error } = await bobClient.from("ledger").insert({
        bill_id: bill.id,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 1000,
        status: "pending",
        entry_type: "debt",
      });

      expect(error).not.toBeNull();
    });
  });
});
