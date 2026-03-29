import { describe, it, expect, beforeAll } from "vitest";
import { isIntegrationTestReady, adminClient } from "@/test/integration-setup";
import {
  createTestUsers,
  createTestGroupWithMembers,
  createAndActivateExpense,
  settleDebt,
  getBalanceBetween,
  authenticateAs,
  acceptGroupInvite,
  type TestUser,
} from "@/test/integration-helpers";


// ---------------------------------------------------------------------------
// Suite 2 — Expense lifecycle chains
//
// Tests the full draft → active → settled journey and edge cases around
// deleting, editing, and reactivating expenses.
// ---------------------------------------------------------------------------

describe.skipIf(!isIntegrationTestReady)("Expense lifecycle chains", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let groupId: string;

  beforeAll(async () => {
    [alice, bob, carol] = await createTestUsers(3);
    const group = await createTestGroupWithMembers(alice, [bob, carol]);
    groupId = group.id;
  });

  // -----------------------------------------------------------------------
  // 2.1 — Activate then attempt delete (should be no-op)
  // -----------------------------------------------------------------------
  describe("2.1 — Cannot delete an active expense", () => {
    it("delete silently fails for an active expense (status filter prevents match)", async () => {
      const expenseId = await createAndActivateExpense({
        creator: alice,
        groupId,
        shares: [
          { userId: alice.id, amount: 3000 },
          { userId: bob.id, amount: 3000 },
        ],
        payers: [{ userId: alice.id, amount: 6000 }],
        title: "2.1 active expense",
      });

      // Attempt to delete — the DELETE query filters on status='draft',
      // so it matches zero rows for an active expense. No error is returned.
      const aliceClient = authenticateAs(alice);
      const { error } = await aliceClient
        .from("expenses")
        .delete()
        .eq("id", expenseId)
        .eq("status", "draft");

      expect(error).toBeNull();

      // Expense still exists and is active
      const { data } = await adminClient!
        .from("expenses")
        .select("status")
        .eq("id", expenseId)
        .single();

      expect(data?.status).toBe("active");

      // Balance remains intact
      const balance = await getBalanceBetween(groupId, bob.id, alice.id);
      expect(balance).toBe(3000); // bob owes alice 3000
    });

    it("balance is not affected by failed delete attempt", async () => {
      // Create and activate two expenses
      await createAndActivateExpense({
        creator: alice,
        groupId,
        shares: [
          { userId: carol.id, amount: 5000 },
        ],
        payers: [{ userId: alice.id, amount: 5000 }],
        title: "2.1b first expense",
      });

      const secondId = await createAndActivateExpense({
        creator: alice,
        groupId,
        shares: [
          { userId: carol.id, amount: 2000 },
        ],
        payers: [{ userId: alice.id, amount: 2000 }],
        title: "2.1b second expense",
      });

      // Try to delete the second one (it's active, so no-op)
      const aliceClient = authenticateAs(alice);
      await aliceClient
        .from("expenses")
        .delete()
        .eq("id", secondId)
        .eq("status", "draft");

      // Carol's cumulative debt to Alice includes both expenses
      const balance = await getBalanceBetween(groupId, carol.id, alice.id);
      expect(balance).toBe(7000 + 3000); // 5000 + 2000 + 3000 from test above
      // (3000 from the 2.1 test with bob shares — carol's balance is 5000+2000 here)
    });
  });

  // -----------------------------------------------------------------------
  // 2.2 — Delete a draft then create & activate a replacement
  // -----------------------------------------------------------------------
  describe("2.2 — Delete draft and recreate", () => {
    let freshGroupId: string;

    beforeAll(async () => {
      const group = await createTestGroupWithMembers(alice, [bob]);
      freshGroupId = group.id;
    });

    it("deleting a draft has no effect on balances, replacement works normally", async () => {
      // Create a draft via admin (not activated)
      const { data: draft } = await adminClient!
        .from("expenses")
        .insert({
          group_id: freshGroupId,
          creator_id: alice.id,
          title: "Draft to delete",
          expense_type: "single_amount",
          total_amount: 10000,
          service_fee_percent: 0,
          fixed_fees: 0,
          status: "draft",
        })
        .select("id")
        .single();

      expect(draft).not.toBeNull();

      // Insert shares and payers for the draft
      await Promise.all([
        adminClient!.from("expense_shares").insert([
          { expense_id: draft!.id, user_id: alice.id, share_amount_cents: 5000 },
          { expense_id: draft!.id, user_id: bob.id, share_amount_cents: 5000 },
        ]),
        adminClient!.from("expense_payers").insert([
          { expense_id: draft!.id, user_id: alice.id, amount_cents: 10000 },
        ]),
      ]);

      // No balance exists yet
      expect(await getBalanceBetween(freshGroupId, bob.id, alice.id)).toBe(0);

      // Delete the draft
      const aliceClient = authenticateAs(alice);
      const { error: delError } = await aliceClient
        .from("expenses")
        .delete()
        .eq("id", draft!.id)
        .eq("status", "draft");

      expect(delError).toBeNull();

      // Still no balance
      expect(await getBalanceBetween(freshGroupId, bob.id, alice.id)).toBe(0);

      // Create and activate a replacement expense
      await createAndActivateExpense({
        creator: alice,
        groupId: freshGroupId,
        shares: [
          { userId: alice.id, amount: 4000 },
          { userId: bob.id, amount: 4000 },
        ],
        payers: [{ userId: alice.id, amount: 8000 }],
        title: "Replacement expense",
      });

      expect(await getBalanceBetween(freshGroupId, bob.id, alice.id)).toBe(4000);
    });
  });

  // -----------------------------------------------------------------------
  // 2.3 — Multiple sequential activations accumulate balances
  // -----------------------------------------------------------------------
  describe("2.3 — Sequential activations accumulate correctly", () => {
    let freshGroupId: string;

    beforeAll(async () => {
      const group = await createTestGroupWithMembers(alice, [bob, carol]);
      freshGroupId = group.id;
    });

    it("three expenses build up cumulative balances", async () => {
      // Expense 1: Alice pays 9000, split equally (3000 each)
      // Bob owes Alice 3000, Carol owes Alice 3000
      await createAndActivateExpense({
        creator: alice,
        groupId: freshGroupId,
        shares: [
          { userId: alice.id, amount: 3000 },
          { userId: bob.id, amount: 3000 },
          { userId: carol.id, amount: 3000 },
        ],
        payers: [{ userId: alice.id, amount: 9000 }],
        title: "Expense 1",
      });

      expect(await getBalanceBetween(freshGroupId, bob.id, alice.id)).toBe(3000);
      expect(await getBalanceBetween(freshGroupId, carol.id, alice.id)).toBe(3000);

      // Expense 2: Bob pays 6000, Alice and Carol split equally
      // Alice owes Bob 3000, Carol owes Bob 3000
      await createAndActivateExpense({
        creator: alice,
        groupId: freshGroupId,
        shares: [
          { userId: alice.id, amount: 3000 },
          { userId: carol.id, amount: 3000 },
        ],
        payers: [{ userId: bob.id, amount: 6000 }],
        title: "Expense 2",
      });

      // Net: Bob originally owed Alice 3000, now Alice owes Bob 3000 → net Bob→Alice = 0
      expect(await getBalanceBetween(freshGroupId, bob.id, alice.id)).toBe(0);
      // Carol owes Alice 3000 (from exp1) + Carol owes Bob 3000 (from exp2)
      expect(await getBalanceBetween(freshGroupId, carol.id, alice.id)).toBe(3000);
      expect(await getBalanceBetween(freshGroupId, carol.id, bob.id)).toBe(3000);

      // Expense 3: Carol pays 3000 for Alice only
      await createAndActivateExpense({
        creator: alice,
        groupId: freshGroupId,
        shares: [{ userId: alice.id, amount: 3000 }],
        payers: [{ userId: carol.id, amount: 3000 }],
        title: "Expense 3",
      });

      // Net Alice→Carol: Alice owed 3000 by Carol (exp1), now Alice owes Carol 3000 (exp3) → net 0
      expect(await getBalanceBetween(freshGroupId, carol.id, alice.id)).toBe(0);
      // Carol still owes Bob 3000
      expect(await getBalanceBetween(freshGroupId, carol.id, bob.id)).toBe(3000);
    });
  });

  // -----------------------------------------------------------------------
  // 2.4 — Edit a draft (update amounts) then activate
  // -----------------------------------------------------------------------
  describe("2.4 — Edit draft then activate", () => {
    let freshGroupId: string;

    beforeAll(async () => {
      const group = await createTestGroupWithMembers(alice, [bob]);
      freshGroupId = group.id;
    });

    it("editing a draft's amounts before activation uses the final values", async () => {
      // Create initial draft with 10000
      const { data: draft } = await adminClient!
        .from("expenses")
        .insert({
          group_id: freshGroupId,
          creator_id: alice.id,
          title: "Editable draft",
          expense_type: "single_amount",
          total_amount: 10000,
          service_fee_percent: 0,
          fixed_fees: 0,
          status: "draft",
        })
        .select("id")
        .single();

      await Promise.all([
        adminClient!.from("expense_shares").insert([
          { expense_id: draft!.id, user_id: alice.id, share_amount_cents: 5000 },
          { expense_id: draft!.id, user_id: bob.id, share_amount_cents: 5000 },
        ]),
        adminClient!.from("expense_payers").insert([
          { expense_id: draft!.id, user_id: alice.id, amount_cents: 10000 },
        ]),
      ]);

      // Edit: change total to 6000, update shares and payers
      await adminClient!
        .from("expenses")
        .update({ total_amount: 6000 })
        .eq("id", draft!.id);

      // Delete old child data and reinsert (mimicking saveExpenseDraft behavior)
      await Promise.all([
        adminClient!.from("expense_shares").delete().eq("expense_id", draft!.id),
        adminClient!.from("expense_payers").delete().eq("expense_id", draft!.id),
      ]);

      await Promise.all([
        adminClient!.from("expense_shares").insert([
          { expense_id: draft!.id, user_id: alice.id, share_amount_cents: 3000 },
          { expense_id: draft!.id, user_id: bob.id, share_amount_cents: 3000 },
        ]),
        adminClient!.from("expense_payers").insert([
          { expense_id: draft!.id, user_id: alice.id, amount_cents: 6000 },
        ]),
      ]);

      // Activate — should use the edited 6000 values
      const aliceClient = authenticateAs(alice);
      const { error } = await aliceClient.rpc("activate_expense", {
        p_expense_id: draft!.id,
      });

      expect(error).toBeNull();

      // Bob owes Alice 3000 (not 5000 from original draft)
      expect(await getBalanceBetween(freshGroupId, bob.id, alice.id)).toBe(3000);
    });
  });

  // -----------------------------------------------------------------------
  // 2.5 — Full lifecycle: create → activate → settle to zero
  // -----------------------------------------------------------------------
  describe("2.5 — Full expense lifecycle to zero balance", () => {
    let freshGroupId: string;

    beforeAll(async () => {
      const group = await createTestGroupWithMembers(alice, [bob, carol]);
      freshGroupId = group.id;
    });

    it("expense → activation → full settlement zeroes out all balances", async () => {
      // Alice pays 9000, split 3-ways
      await createAndActivateExpense({
        creator: alice,
        groupId: freshGroupId,
        shares: [
          { userId: alice.id, amount: 3000 },
          { userId: bob.id, amount: 3000 },
          { userId: carol.id, amount: 3000 },
        ],
        payers: [{ userId: alice.id, amount: 9000 }],
        title: "Full lifecycle expense",
      });

      expect(await getBalanceBetween(freshGroupId, bob.id, alice.id)).toBe(3000);
      expect(await getBalanceBetween(freshGroupId, carol.id, alice.id)).toBe(3000);

      // Bob settles with Alice
      await settleDebt({
        caller: bob,
        groupId: freshGroupId,
        fromUserId: bob.id,
        toUserId: alice.id,
        amountCents: 3000,
      });

      expect(await getBalanceBetween(freshGroupId, bob.id, alice.id)).toBe(0);
      expect(await getBalanceBetween(freshGroupId, carol.id, alice.id)).toBe(3000);

      // Carol settles with Alice
      await settleDebt({
        caller: carol,
        groupId: freshGroupId,
        fromUserId: carol.id,
        toUserId: alice.id,
        amountCents: 3000,
      });

      expect(await getBalanceBetween(freshGroupId, carol.id, alice.id)).toBe(0);
    });

    it("partial settlements then another expense accumulates correctly", async () => {
      // Setup: Bob owes Alice 4000
      await createAndActivateExpense({
        creator: alice,
        groupId: freshGroupId,
        shares: [{ userId: bob.id, amount: 4000 }],
        payers: [{ userId: alice.id, amount: 4000 }],
        title: "Before partial settle",
      });

      const bobOwes = await getBalanceBetween(freshGroupId, bob.id, alice.id);

      // Partial settlement: Bob pays 1500
      await settleDebt({
        caller: bob,
        groupId: freshGroupId,
        fromUserId: bob.id,
        toUserId: alice.id,
        amountCents: 1500,
      });

      expect(await getBalanceBetween(freshGroupId, bob.id, alice.id)).toBe(bobOwes - 1500);

      // Another expense: Bob pays 2000 for Alice
      await createAndActivateExpense({
        creator: alice,
        groupId: freshGroupId,
        shares: [{ userId: alice.id, amount: 2000 }],
        payers: [{ userId: bob.id, amount: 2000 }],
        title: "After partial settle",
      });

      // Net: (bobOwes - 1500) - 2000 (Alice now owes Bob)
      expect(await getBalanceBetween(freshGroupId, bob.id, alice.id)).toBe(bobOwes - 1500 - 2000);
    });
  });

  // -----------------------------------------------------------------------
  // 2.6 — Multiple expenses with multiple payers
  // -----------------------------------------------------------------------
  describe("2.6 — Multi-payer expenses chain correctly", () => {
    let freshGroupId: string;

    beforeAll(async () => {
      const group = await createTestGroupWithMembers(alice, [bob, carol]);
      freshGroupId = group.id;
    });

    it("two multi-payer expenses produce correct cumulative balances", async () => {
      // Expense 1: Total 6000
      //   Shares: Alice 2000, Bob 2000, Carol 2000
      //   Payers: Alice 4000, Bob 2000
      // Debts from activation:
      //   Bob consumed 2000: paid 2000 → net Bob contribution 0 from Alice's payer share
      //     Bob's share paid by Alice: round(2000 * 4000 / 6000) = 1333 → Bob owes Alice 1333
      //     Bob's share paid by Bob: round(2000 * 2000 / 6000) = 667 → self, no debt
      //   Carol consumed 2000:
      //     Carol's share paid by Alice: round(2000 * 4000 / 6000) = 1333 → Carol owes Alice 1333
      //     Carol's share paid by Bob: round(2000 * 2000 / 6000) = 667 → Carol owes Bob 667
      //   Alice consumed 2000:
      //     Alice's share paid by Bob: round(2000 * 2000 / 6000) = 667 → Alice owes Bob 667
      await createAndActivateExpense({
        creator: alice,
        groupId: freshGroupId,
        shares: [
          { userId: alice.id, amount: 2000 },
          { userId: bob.id, amount: 2000 },
          { userId: carol.id, amount: 2000 },
        ],
        payers: [
          { userId: alice.id, amount: 4000 },
          { userId: bob.id, amount: 2000 },
        ],
        title: "Multi-payer expense 1",
      });

      // Bob→Alice: 1333 - 667 = 666 (Bob owes Alice net)
      // Carol→Alice: 1333
      // Carol→Bob: 667
      expect(await getBalanceBetween(freshGroupId, bob.id, alice.id)).toBe(666);
      expect(await getBalanceBetween(freshGroupId, carol.id, alice.id)).toBe(1333);
      expect(await getBalanceBetween(freshGroupId, carol.id, bob.id)).toBe(667);

      // Expense 2: Total 3000
      //   Shares: Alice 1500, Carol 1500
      //   Payer: Carol 3000
      // Carol pays for Alice: round(1500 * 3000 / 3000) = 1500 → Alice owes Carol 1500
      await createAndActivateExpense({
        creator: alice,
        groupId: freshGroupId,
        shares: [
          { userId: alice.id, amount: 1500 },
          { userId: carol.id, amount: 1500 },
        ],
        payers: [{ userId: carol.id, amount: 3000 }],
        title: "Multi-payer expense 2",
      });

      // Carol→Alice: 1333 - 1500 = -167 (now Alice owes Carol 167)
      expect(await getBalanceBetween(freshGroupId, carol.id, alice.id)).toBe(1333 - 1500);
      // Carol→Bob unchanged
      expect(await getBalanceBetween(freshGroupId, carol.id, bob.id)).toBe(667);
      // Bob→Alice unchanged
      expect(await getBalanceBetween(freshGroupId, bob.id, alice.id)).toBe(666);
    });
  });

  // -----------------------------------------------------------------------
  // 2.7 — Delete some drafts, activate others
  // -----------------------------------------------------------------------
  describe("2.7 — Selective draft deletion among multiple drafts", () => {
    let freshGroupId: string;

    beforeAll(async () => {
      const group = await createTestGroupWithMembers(alice, [bob]);
      freshGroupId = group.id;
    });

    it("deleting one draft does not affect activation of another", async () => {
      // Create two drafts via admin
      const [{ data: draft1 }, { data: draft2 }] = await Promise.all([
        adminClient!
          .from("expenses")
          .insert({
            group_id: freshGroupId,
            creator_id: alice.id,
            title: "Draft to delete",
            expense_type: "single_amount",
            total_amount: 8000,
            service_fee_percent: 0,
            fixed_fees: 0,
            status: "draft",
          })
          .select("id")
          .single(),
        adminClient!
          .from("expenses")
          .insert({
            group_id: freshGroupId,
            creator_id: alice.id,
            title: "Draft to activate",
            expense_type: "single_amount",
            total_amount: 4000,
            service_fee_percent: 0,
            fixed_fees: 0,
            status: "draft",
          })
          .select("id")
          .single(),
      ]);

      // Set up child data for both
      await Promise.all([
        adminClient!.from("expense_shares").insert([
          { expense_id: draft1!.id, user_id: alice.id, share_amount_cents: 4000 },
          { expense_id: draft1!.id, user_id: bob.id, share_amount_cents: 4000 },
        ]),
        adminClient!.from("expense_payers").insert([
          { expense_id: draft1!.id, user_id: alice.id, amount_cents: 8000 },
        ]),
        adminClient!.from("expense_shares").insert([
          { expense_id: draft2!.id, user_id: alice.id, share_amount_cents: 2000 },
          { expense_id: draft2!.id, user_id: bob.id, share_amount_cents: 2000 },
        ]),
        adminClient!.from("expense_payers").insert([
          { expense_id: draft2!.id, user_id: alice.id, amount_cents: 4000 },
        ]),
      ]);

      // Delete draft1
      const aliceClient = authenticateAs(alice);
      await aliceClient
        .from("expenses")
        .delete()
        .eq("id", draft1!.id)
        .eq("status", "draft");

      // Verify draft1 is gone
      const { data: deleted } = await adminClient!
        .from("expenses")
        .select("id")
        .eq("id", draft1!.id)
        .maybeSingle();
      expect(deleted).toBeNull();

      // Activate draft2 — should work independently
      const { error } = await aliceClient.rpc("activate_expense", {
        p_expense_id: draft2!.id,
      });
      expect(error).toBeNull();

      // Balance reflects only draft2: Bob owes Alice 2000
      expect(await getBalanceBetween(freshGroupId, bob.id, alice.id)).toBe(2000);
    });
  });

  // -----------------------------------------------------------------------
  // 2.8 — Activation rejects re-activation of already-active expense
  // -----------------------------------------------------------------------
  describe("2.8 — Double activation is rejected", () => {
    it("second activation call returns invalid_status error", async () => {
      const freshGroup = await createTestGroupWithMembers(alice, [bob]);

      const expenseId = await createAndActivateExpense({
        creator: alice,
        groupId: freshGroup.id,
        shares: [
          { userId: alice.id, amount: 2000 },
          { userId: bob.id, amount: 2000 },
        ],
        payers: [{ userId: alice.id, amount: 4000 }],
        title: "Already active",
      });

      // Try to activate again
      const aliceClient = authenticateAs(alice);
      const { error } = await aliceClient.rpc("activate_expense", {
        p_expense_id: expenseId,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain("invalid_status");

      // Balance unchanged (still just the first activation)
      expect(await getBalanceBetween(freshGroup.id, bob.id, alice.id)).toBe(2000);
    });
  });

  // -----------------------------------------------------------------------
  // 2.9 — Settle more than owed, then new expense reverses direction
  // -----------------------------------------------------------------------
  describe("2.9 — Oversettlement followed by new expense", () => {
    it("oversettlement flips balance, subsequent expense adjusts it back", async () => {
      const freshGroup = await createTestGroupWithMembers(alice, [bob]);

      // Bob owes Alice 3000
      await createAndActivateExpense({
        creator: alice,
        groupId: freshGroup.id,
        shares: [{ userId: bob.id, amount: 3000 }],
        payers: [{ userId: alice.id, amount: 3000 }],
        title: "Initial debt",
      });

      expect(await getBalanceBetween(freshGroup.id, bob.id, alice.id)).toBe(3000);

      // Bob overpays: settles 5000 (2000 more than owed)
      await settleDebt({
        caller: bob,
        groupId: freshGroup.id,
        fromUserId: bob.id,
        toUserId: alice.id,
        amountCents: 5000,
      });

      // Now Alice owes Bob 2000 (balance flipped)
      expect(await getBalanceBetween(freshGroup.id, bob.id, alice.id)).toBe(-2000);

      // New expense: Alice pays 5000 for Bob
      await createAndActivateExpense({
        creator: alice,
        groupId: freshGroup.id,
        shares: [{ userId: bob.id, amount: 5000 }],
        payers: [{ userId: alice.id, amount: 5000 }],
        title: "Post-oversettlement expense",
      });

      // Net: -2000 + 5000 = 3000 (Bob owes Alice again)
      expect(await getBalanceBetween(freshGroup.id, bob.id, alice.id)).toBe(3000);
    });
  });

  // -----------------------------------------------------------------------
  // 2.10 — Interleaved expenses and settlements with three users
  // -----------------------------------------------------------------------
  describe("2.10 — Three-way interleaved expenses and settlements", () => {
    it("complex sequence of expenses and settlements produces correct final state", async () => {
      const freshGroup = await createTestGroupWithMembers(alice, [bob, carol]);
      const gid = freshGroup.id;

      // Step 1: Alice pays 9000, split 3-ways
      // Bob→Alice: 3000, Carol→Alice: 3000
      await createAndActivateExpense({
        creator: alice,
        groupId: gid,
        shares: [
          { userId: alice.id, amount: 3000 },
          { userId: bob.id, amount: 3000 },
          { userId: carol.id, amount: 3000 },
        ],
        payers: [{ userId: alice.id, amount: 9000 }],
        title: "Step 1",
      });

      // Step 2: Bob partially settles with Alice (pays 1000)
      await settleDebt({
        caller: bob,
        groupId: gid,
        fromUserId: bob.id,
        toUserId: alice.id,
        amountCents: 1000,
      });

      expect(await getBalanceBetween(gid, bob.id, alice.id)).toBe(2000);

      // Step 3: Bob pays 6000, split between Alice(3000) and Carol(3000)
      // Alice owes Bob 3000, Carol owes Bob 3000
      await createAndActivateExpense({
        creator: alice,
        groupId: gid,
        shares: [
          { userId: alice.id, amount: 3000 },
          { userId: carol.id, amount: 3000 },
        ],
        payers: [{ userId: bob.id, amount: 6000 }],
        title: "Step 3",
      });

      // Bob→Alice: 2000 - 3000 = -1000 (Alice owes Bob 1000)
      expect(await getBalanceBetween(gid, bob.id, alice.id)).toBe(-1000);
      // Carol→Alice: 3000 (unchanged from step 1)
      expect(await getBalanceBetween(gid, carol.id, alice.id)).toBe(3000);
      // Carol→Bob: 3000 (from step 3)
      expect(await getBalanceBetween(gid, carol.id, bob.id)).toBe(3000);

      // Step 4: Carol settles 2000 with Bob
      await settleDebt({
        caller: carol,
        groupId: gid,
        fromUserId: carol.id,
        toUserId: bob.id,
        amountCents: 2000,
      });

      expect(await getBalanceBetween(gid, carol.id, bob.id)).toBe(1000);

      // Step 5: Carol pays 4000, split: Alice 2000, Bob 2000
      await createAndActivateExpense({
        creator: alice,
        groupId: gid,
        shares: [
          { userId: alice.id, amount: 2000 },
          { userId: bob.id, amount: 2000 },
        ],
        payers: [{ userId: carol.id, amount: 4000 }],
        title: "Step 5",
      });

      // Final balances:
      // Bob→Alice: -1000 (from step 3)
      expect(await getBalanceBetween(gid, bob.id, alice.id)).toBe(-1000);
      // Carol→Alice: 3000 - 2000 = 1000
      expect(await getBalanceBetween(gid, carol.id, alice.id)).toBe(1000);
      // Carol→Bob: 1000 - 2000 = -1000 (Bob now owes Carol)
      expect(await getBalanceBetween(gid, carol.id, bob.id)).toBe(-1000);
    });
  });

  // -----------------------------------------------------------------------
  // 2.11 — Settle all debts then create new expense from scratch
  // -----------------------------------------------------------------------
  describe("2.11 — Fresh start after full settlement", () => {
    it("settling all debts to zero, then new expense starts clean accounting", async () => {
      const freshGroup = await createTestGroupWithMembers(alice, [bob]);
      const gid = freshGroup.id;

      // Create expense: Bob owes Alice 5000
      await createAndActivateExpense({
        creator: alice,
        groupId: gid,
        shares: [{ userId: bob.id, amount: 5000 }],
        payers: [{ userId: alice.id, amount: 5000 }],
        title: "Initial",
      });

      // Settle fully
      await settleDebt({
        caller: bob,
        groupId: gid,
        fromUserId: bob.id,
        toUserId: alice.id,
        amountCents: 5000,
      });

      expect(await getBalanceBetween(gid, bob.id, alice.id)).toBe(0);

      // New expense after full settlement
      await createAndActivateExpense({
        creator: alice,
        groupId: gid,
        shares: [{ userId: bob.id, amount: 2000 }],
        payers: [{ userId: alice.id, amount: 2000 }],
        title: "After settlement",
      });

      expect(await getBalanceBetween(gid, bob.id, alice.id)).toBe(2000);

      // Settle this new debt too
      await settleDebt({
        caller: bob,
        groupId: gid,
        fromUserId: bob.id,
        toUserId: alice.id,
        amountCents: 2000,
      });

      expect(await getBalanceBetween(gid, bob.id, alice.id)).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 2.12 — Adding a new participant mid-lifecycle
  // -----------------------------------------------------------------------
  describe("2.12 — New member joins group between expenses", () => {
    it("new member only appears in balances from expenses after they joined", async () => {
      // Start with just Alice and Bob
      const group = await createTestGroupWithMembers(alice, [bob]);
      const gid = group.id;

      // Expense 1: Alice pays 6000, Bob's share 3000
      await createAndActivateExpense({
        creator: alice,
        groupId: gid,
        shares: [
          { userId: alice.id, amount: 3000 },
          { userId: bob.id, amount: 3000 },
        ],
        payers: [{ userId: alice.id, amount: 6000 }],
        title: "Before Carol joins",
      });

      expect(await getBalanceBetween(gid, bob.id, alice.id)).toBe(3000);
      // Carol has no balance in this group yet
      expect(await getBalanceBetween(gid, carol.id, alice.id)).toBe(0);

      // Carol joins the group
      await adminClient!.from("group_members").insert({
        group_id: gid,
        user_id: carol.id,
        status: "invited",
        invited_by: alice.id,
      });
      await acceptGroupInvite(carol, gid);

      // Expense 2: Alice pays 9000, split 3 ways now including Carol
      await createAndActivateExpense({
        creator: alice,
        groupId: gid,
        shares: [
          { userId: alice.id, amount: 3000 },
          { userId: bob.id, amount: 3000 },
          { userId: carol.id, amount: 3000 },
        ],
        payers: [{ userId: alice.id, amount: 9000 }],
        title: "After Carol joins",
      });

      // Bob: 3000 + 3000 = 6000
      expect(await getBalanceBetween(gid, bob.id, alice.id)).toBe(6000);
      // Carol: 0 + 3000 = 3000 (only from expense 2)
      expect(await getBalanceBetween(gid, carol.id, alice.id)).toBe(3000);
      // No Bob-Carol balance (neither owed each other)
      expect(await getBalanceBetween(gid, carol.id, bob.id)).toBe(0);
    });
  });
});
