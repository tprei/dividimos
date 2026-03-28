import { describe, it, expect, beforeAll } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
} from "./integration-setup";
import {
  createTestUser,
  createTestGroup,
  authenticateAs,
  type TestUser,
} from "./integration-helpers";
/**
 * Integration tests for expense-related RLS policies.
 *
 * Setup: 4 users, 1 group.
 * - alice: group creator (accepted member)
 * - bob: accepted group member
 * - carol: invited-but-not-accepted group member
 * - dave: completely outside the group
 *
 * alice creates an expense, expense_items, expense_shares, expense_payers.
 * adminClient seeds a balance row and a settlement row.
 */

describe.skipIf(!isIntegrationTestReady)("Expense RLS policies", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser;
  let groupId: string;
  let expenseId: string;

  beforeAll(async () => {
    // Create test users
    [alice, bob, carol, dave] = await Promise.all([
      createTestUser({ name: "Alice RLS" }),
      createTestUser({ name: "Bob RLS" }),
      createTestUser({ name: "Carol RLS" }),
      createTestUser({ name: "Dave RLS" }),
    ]);

    // Create group with alice as creator, bob and carol as members
    const group = await createTestGroup(alice.id, [bob.id, carol.id]);
    groupId = group.id;

    // Accept bob's invitation (carol stays invited)
    await adminClient!
      .from("group_members")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .eq("user_id", bob.id);

    // Alice creates an expense via her authenticated client
    const aliceClient = authenticateAs(alice);
    const { data: expense, error: expError } = await aliceClient
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Test Dinner",
        expense_type: "itemized",
        total_amount: 10000,
      })
      .select()
      .single();

    expect(expError).toBeNull();
    expenseId = expense!.id;

    // Add expense item
    const { error: itemError } = await aliceClient
      .from("expense_items")
      .insert({
        expense_id: expenseId,
        description: "Pizza",
        quantity: 1,
        unit_price_cents: 5000,
        total_price_cents: 5000,
      })
      .select()
      .single();

    expect(itemError).toBeNull();

    // Add expense shares
    const { error: sharesError } = await aliceClient
      .from("expense_shares")
      .insert([
        { expense_id: expenseId, user_id: alice.id, share_amount_cents: 5000 },
        { expense_id: expenseId, user_id: bob.id, share_amount_cents: 5000 },
      ]);
    expect(sharesError).toBeNull();

    // Add expense payer
    const { error: payerError } = await aliceClient
      .from("expense_payers")
      .insert({ expense_id: expenseId, user_id: alice.id, amount_cents: 10000 });
    expect(payerError).toBeNull();

    // Seed a balance row (admin — balances have no INSERT policy for users)
    const [userA, userB] = alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];
    await adminClient!.from("balances").insert({
      group_id: groupId,
      user_a: userA,
      user_b: userB,
      amount_cents: 5000,
    });

    // Seed a settlement row via admin (from bob to alice)
    await adminClient!.from("settlements").insert({
      group_id: groupId,
      from_user_id: bob.id,
      to_user_id: alice.id,
      amount_cents: 5000,
    });
  });

  // ──────────────────────────────────────────────
  // EXPENSES: SELECT
  // ──────────────────────────────────────────────

  describe("expenses SELECT", () => {
    it("accepted member (creator) can see group expenses", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("expenses")
        .select("id")
        .eq("id", expenseId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("accepted member (non-creator) can see group expenses", async () => {
      const client = authenticateAs(bob);
      const { data, error } = await client
        .from("expenses")
        .select("id")
        .eq("id", expenseId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("invited-but-not-accepted member cannot see group expenses", async () => {
      const client = authenticateAs(carol);
      const { data, error } = await client
        .from("expenses")
        .select("id")
        .eq("id", expenseId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("non-member cannot see group expenses", async () => {
      const client = authenticateAs(dave);
      const { data, error } = await client
        .from("expenses")
        .select("id")
        .eq("id", expenseId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────
  // EXPENSES: INSERT / UPDATE / DELETE
  // ──────────────────────────────────────────────

  describe("expenses INSERT", () => {
    it("accepted member can create expense in their group", async () => {
      const client = authenticateAs(bob);
      const { data, error } = await client
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: bob.id,
          title: "Bob Expense",
          total_amount: 2000,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.title).toBe("Bob Expense");

      // Cleanup
      await adminClient!.from("expenses").delete().eq("id", data!.id);
    });

    it("invited member cannot create expense", async () => {
      const client = authenticateAs(carol);
      const { error } = await client
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: carol.id,
          title: "Carol Expense",
          total_amount: 1000,
        });

      expect(error).not.toBeNull();
    });

    it("non-member cannot create expense in group", async () => {
      const client = authenticateAs(dave);
      const { error } = await client
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: dave.id,
          title: "Dave Expense",
          total_amount: 1000,
        });

      expect(error).not.toBeNull();
    });

    it("cannot create expense impersonating another user", async () => {
      const client = authenticateAs(bob);
      const { error } = await client
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id, // impersonation attempt
          title: "Impersonation Expense",
          total_amount: 1000,
        });

      expect(error).not.toBeNull();
    });
  });

  describe("expenses UPDATE", () => {
    it("creator can update their expense", async () => {
      const client = authenticateAs(alice);
      const { error } = await client
        .from("expenses")
        .update({ title: "Updated Dinner" })
        .eq("id", expenseId);

      expect(error).toBeNull();

      // Restore
      await client
        .from("expenses")
        .update({ title: "Test Dinner" })
        .eq("id", expenseId);
    });

    it("non-creator accepted member cannot update expense", async () => {
      const client = authenticateAs(bob);
      const { data, error } = await client
        .from("expenses")
        .update({ title: "Hacked Title" })
        .eq("id", expenseId)
        .select();

      // Either error or empty result (no rows matched the USING clause)
      expect(error === null ? data : []).toHaveLength(0);
    });
  });

  describe("expenses DELETE", () => {
    it("non-creator cannot delete expense", async () => {
      const client = authenticateAs(bob);
      const { data } = await client
        .from("expenses")
        .delete()
        .eq("id", expenseId)
        .select();

      // No rows deleted
      expect(data).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────
  // EXPENSE_ITEMS: SELECT
  // ──────────────────────────────────────────────

  describe("expense_items SELECT", () => {
    it("accepted member can see expense items", async () => {
      const client = authenticateAs(bob);
      const { data, error } = await client
        .from("expense_items")
        .select("id")
        .eq("expense_id", expenseId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("invited member cannot see expense items", async () => {
      const client = authenticateAs(carol);
      const { data, error } = await client
        .from("expense_items")
        .select("id")
        .eq("expense_id", expenseId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("non-member cannot see expense items", async () => {
      const client = authenticateAs(dave);
      const { data, error } = await client
        .from("expense_items")
        .select("id")
        .eq("expense_id", expenseId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────
  // EXPENSE_SHARES: SELECT + INSERT
  // ──────────────────────────────────────────────

  describe("expense_shares SELECT", () => {
    it("accepted member can see shares", async () => {
      const client = authenticateAs(bob);
      const { data, error } = await client
        .from("expense_shares")
        .select("user_id")
        .eq("expense_id", expenseId);

      expect(error).toBeNull();
      expect(data).toHaveLength(2);
    });

    it("invited member cannot see shares", async () => {
      const client = authenticateAs(carol);
      const { data, error } = await client
        .from("expense_shares")
        .select("user_id")
        .eq("expense_id", expenseId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  describe("expense_shares INSERT", () => {
    it("non-creator cannot insert shares", async () => {
      const client = authenticateAs(bob);
      const { error } = await client
        .from("expense_shares")
        .insert({
          expense_id: expenseId,
          user_id: bob.id,
          share_amount_cents: 9999,
        });

      // Either RLS violation or conflict (bob share already exists)
      expect(error).not.toBeNull();
    });
  });

  // ──────────────────────────────────────────────
  // EXPENSE_PAYERS: SELECT
  // ──────────────────────────────────────────────

  describe("expense_payers SELECT", () => {
    it("accepted member can see payers", async () => {
      const client = authenticateAs(bob);
      const { data, error } = await client
        .from("expense_payers")
        .select("user_id")
        .eq("expense_id", expenseId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("invited member cannot see payers", async () => {
      const client = authenticateAs(carol);
      const { data, error } = await client
        .from("expense_payers")
        .select("user_id")
        .eq("expense_id", expenseId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────
  // BALANCES: SELECT (no INSERT/UPDATE for users)
  // ──────────────────────────────────────────────

  describe("balances SELECT", () => {
    it("accepted member can see balances", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("balances")
        .select("*")
        .eq("group_id", groupId);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("invited member cannot see balances", async () => {
      const client = authenticateAs(carol);
      const { data, error } = await client
        .from("balances")
        .select("*")
        .eq("group_id", groupId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("non-member cannot see balances", async () => {
      const client = authenticateAs(dave);
      const { data, error } = await client
        .from("balances")
        .select("*")
        .eq("group_id", groupId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("user cannot insert balances directly", async () => {
      const client = authenticateAs(alice);
      const { error } = await client.from("balances").insert({
        group_id: groupId,
        user_a: alice.id < dave.id ? alice.id : dave.id,
        user_b: alice.id < dave.id ? dave.id : alice.id,
        amount_cents: 9999,
      });

      expect(error).not.toBeNull();
    });
  });

  // ──────────────────────────────────────────────
  // SETTLEMENTS: SELECT + INSERT
  // ──────────────────────────────────────────────

  describe("settlements SELECT", () => {
    it("accepted member can see settlements", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("settlements")
        .select("*")
        .eq("group_id", groupId);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("invited member cannot see settlements", async () => {
      const client = authenticateAs(carol);
      const { data, error } = await client
        .from("settlements")
        .select("*")
        .eq("group_id", groupId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  describe("settlements INSERT", () => {
    it("accepted member can create settlement as from_user", async () => {
      const client = authenticateAs(bob);
      const { data, error } = await client
        .from("settlements")
        .insert({
          group_id: groupId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 1000,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.from_user_id).toBe(bob.id);

      // Cleanup
      await adminClient!.from("settlements").delete().eq("id", data!.id);
    });

    it("cannot create settlement impersonating from_user", async () => {
      const client = authenticateAs(bob);
      const { error } = await client
        .from("settlements")
        .insert({
          group_id: groupId,
          from_user_id: alice.id, // impersonation
          to_user_id: bob.id,
          amount_cents: 1000,
        });

      expect(error).not.toBeNull();
    });

    it("invited member cannot create settlement", async () => {
      const client = authenticateAs(carol);
      const { error } = await client
        .from("settlements")
        .insert({
          group_id: groupId,
          from_user_id: carol.id,
          to_user_id: alice.id,
          amount_cents: 1000,
        });

      expect(error).not.toBeNull();
    });

    it("non-member cannot create settlement", async () => {
      const client = authenticateAs(dave);
      const { error } = await client
        .from("settlements")
        .insert({
          group_id: groupId,
          from_user_id: dave.id,
          to_user_id: alice.id,
          amount_cents: 1000,
        });

      expect(error).not.toBeNull();
    });
  });
});
