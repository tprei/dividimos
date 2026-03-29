import { describe, it, expect, beforeAll } from "vitest";
import { isIntegrationTestReady, adminClient } from "./integration-setup";
import {
  createTestUsers,
  createAndActivateExpense,
  settleDebt,
  getBalanceBetween,
  createTestGroupWithMembers,
  authenticateAs,
  type TestUser,
} from "./integration-helpers";

// ============================================================
// Suite 6: Edge cases and rounding
// ============================================================

describe.skipIf(!isIntegrationTestReady)("Edge cases & rounding", () => {
  // 6.1 — Rounding asymmetry with multiple payers
  // Three-way split of 100 cents: each share = 33, 33, 34
  // Two payers: Alice 60, Bob 40. Carol consumed 34.
  // Carol→Alice: ROUND(34 * 60 / 100) = ROUND(20.4) = 20
  // Carol→Bob:   ROUND(34 * 40 / 100) = ROUND(13.6) = 14
  // Bob→Alice:   ROUND(33 * 60 / 100) = ROUND(19.8) = 20
  // Alice→Bob:   ROUND(33 * 40 / 100) = ROUND(13.2) = 13
  // Net Alice↔Bob: Bob owes Alice 20 - 13 = 7
  // Net Alice↔Carol: Carol owes Alice 20
  // Net Bob↔Carol: Carol owes Bob 14
  it("6.1: rounding with multiple payers produces correct per-pair balances", async () => {
    const [alice, bob, carol] = await createTestUsers(3);
    const group = await createTestGroupWithMembers(alice, [bob, carol]);

    await createAndActivateExpense({
      creator: alice,
      groupId: group.id,
      shares: [
        { userId: alice.id, amount: 33 },
        { userId: bob.id, amount: 33 },
        { userId: carol.id, amount: 34 },
      ],
      payers: [
        { userId: alice.id, amount: 60 },
        { userId: bob.id, amount: 40 },
      ],
    });

    // Bob owes Alice net = ROUND(33*60/100) - ROUND(33*40/100) = 20 - 13 = 7
    const bobOwesAlice = await getBalanceBetween(group.id, bob.id, alice.id);
    expect(bobOwesAlice).toBe(7);

    // Carol owes Alice = ROUND(34*60/100) = 20
    const carolOwesAlice = await getBalanceBetween(
      group.id,
      carol.id,
      alice.id,
    );
    expect(carolOwesAlice).toBe(20);

    // Carol owes Bob = ROUND(34*40/100) = 14
    const carolOwesBob = await getBalanceBetween(group.id, carol.id, bob.id);
    expect(carolOwesBob).toBe(14);
  });

  // 6.2 — Minimum amount: 1 cent expense
  it("6.2: 1-cent expense with single payer and single consumer", async () => {
    const [alice, bob] = await createTestUsers(2);
    const group = await createTestGroupWithMembers(alice, [bob]);

    await createAndActivateExpense({
      creator: alice,
      groupId: group.id,
      shares: [{ userId: bob.id, amount: 1 }],
      payers: [{ userId: alice.id, amount: 1 }],
    });

    const balance = await getBalanceBetween(group.id, bob.id, alice.id);
    expect(balance).toBe(1);
  });

  // 6.3 — Large amount (R$100,000.00 = 10,000,000 centavos)
  it("6.3: large amount split correctly", async () => {
    const [alice, bob] = await createTestUsers(2);
    const group = await createTestGroupWithMembers(alice, [bob]);

    const total = 10_000_000;
    await createAndActivateExpense({
      creator: alice,
      groupId: group.id,
      shares: [
        { userId: alice.id, amount: total / 2 },
        { userId: bob.id, amount: total / 2 },
      ],
      payers: [{ userId: alice.id, amount: total }],
    });

    const balance = await getBalanceBetween(group.id, bob.id, alice.id);
    expect(balance).toBe(total / 2);
  });

  // 6.4 — Self-payer-consumer: one person pays and consumes everything
  it("6.4: expense where sole payer = sole consumer creates no balance", async () => {
    const [alice, bob] = await createTestUsers(2);
    const group = await createTestGroupWithMembers(alice, [bob]);

    await createAndActivateExpense({
      creator: alice,
      groupId: group.id,
      shares: [{ userId: alice.id, amount: 5000 }],
      payers: [{ userId: alice.id, amount: 5000 }],
    });

    const balance = await getBalanceBetween(group.id, alice.id, bob.id);
    expect(balance).toBe(0);
  });

  // 6.5 — Prime number amount with unequal split
  // 9973 cents split: Alice 4987, Bob 4986. Carol pays all 9973.
  it("6.5: prime number total with unequal shares", async () => {
    const [alice, bob, carol] = await createTestUsers(3);
    const group = await createTestGroupWithMembers(alice, [bob, carol]);

    await createAndActivateExpense({
      creator: carol,
      groupId: group.id,
      shares: [
        { userId: alice.id, amount: 4987 },
        { userId: bob.id, amount: 4986 },
      ],
      payers: [{ userId: carol.id, amount: 9973 }],
    });

    // Alice owes Carol exactly 4987 (ROUND(4987 * 9973 / 9973) = 4987)
    const aliceOwesCarol = await getBalanceBetween(
      group.id,
      alice.id,
      carol.id,
    );
    expect(aliceOwesCarol).toBe(4987);

    const bobOwesCarol = await getBalanceBetween(group.id, bob.id, carol.id);
    expect(bobOwesCarol).toBe(4986);
  });

  // 6.6 — Multiple expenses accumulate balances
  it("6.6: multiple expenses accumulate on the same balance row", async () => {
    const [alice, bob] = await createTestUsers(2);
    const group = await createTestGroupWithMembers(alice, [bob]);

    // Expense 1: Alice pays 6000, split equally → Bob owes Alice 3000
    await createAndActivateExpense({
      creator: alice,
      groupId: group.id,
      shares: [
        { userId: alice.id, amount: 3000 },
        { userId: bob.id, amount: 3000 },
      ],
      payers: [{ userId: alice.id, amount: 6000 }],
    });

    // Expense 2: Bob pays 4000, split equally → Alice owes Bob 2000
    await createAndActivateExpense({
      creator: bob,
      groupId: group.id,
      shares: [
        { userId: alice.id, amount: 2000 },
        { userId: bob.id, amount: 2000 },
      ],
      payers: [{ userId: bob.id, amount: 4000 }],
    });

    // Net: Bob owes Alice 3000 - 2000 = 1000
    const balance = await getBalanceBetween(group.id, bob.id, alice.id);
    expect(balance).toBe(1000);
  });

  // 6.7 — Rounding: three-way even split of 100 cents (33 + 33 + 34)
  // Verifies rounding per pair when total doesn't divide evenly
  it("6.7: three-way split where shares don't divide evenly", async () => {
    const [alice, bob, carol] = await createTestUsers(3);
    const group = await createTestGroupWithMembers(alice, [bob, carol]);

    // Alice pays 100, shares: alice=33, bob=33, carol=34
    await createAndActivateExpense({
      creator: alice,
      groupId: group.id,
      shares: [
        { userId: alice.id, amount: 33 },
        { userId: bob.id, amount: 33 },
        { userId: carol.id, amount: 34 },
      ],
      payers: [{ userId: alice.id, amount: 100 }],
    });

    // Bob owes Alice: ROUND(33 * 100 / 100) = 33
    const bobOwesAlice = await getBalanceBetween(group.id, bob.id, alice.id);
    expect(bobOwesAlice).toBe(33);

    // Carol owes Alice: ROUND(34 * 100 / 100) = 34
    const carolOwesAlice = await getBalanceBetween(
      group.id,
      carol.id,
      alice.id,
    );
    expect(carolOwesAlice).toBe(34);
  });

  // 6.8 — Rounding asymmetry: 3 cents split among 3 consumers, 2 payers
  // shares: A=1, B=1, C=1; payers: A=2, B=1. Total=3
  // B→A: ROUND(1*2/3) = ROUND(0.667) = 1
  // C→A: ROUND(1*2/3) = ROUND(0.667) = 1
  // A→B: ROUND(1*1/3) = ROUND(0.333) = 0
  // C→B: ROUND(1*1/3) = ROUND(0.333) = 0
  // Net A↔B: B owes A 1, A owes B 0 → B owes A 1
  // Net A↔C: C owes A 1
  // Net B↔C: C owes B 0
  it("6.8: tiny amounts with rounding to zero on some pairs", async () => {
    const [alice, bob, carol] = await createTestUsers(3);
    const group = await createTestGroupWithMembers(alice, [bob, carol]);

    await createAndActivateExpense({
      creator: alice,
      groupId: group.id,
      shares: [
        { userId: alice.id, amount: 1 },
        { userId: bob.id, amount: 1 },
        { userId: carol.id, amount: 1 },
      ],
      payers: [
        { userId: alice.id, amount: 2 },
        { userId: bob.id, amount: 1 },
      ],
    });

    // B owes A: ROUND(1*2/3)=1, A owes B: ROUND(1*1/3)=0. Net = 1
    const bobOwesAlice = await getBalanceBetween(group.id, bob.id, alice.id);
    expect(bobOwesAlice).toBe(1);

    // C owes A: ROUND(1*2/3)=1
    const carolOwesAlice = await getBalanceBetween(
      group.id,
      carol.id,
      alice.id,
    );
    expect(carolOwesAlice).toBe(1);

    // C owes B: ROUND(1*1/3)=0. No balance row created (HAVING != 0).
    const carolOwesBob = await getBalanceBetween(group.id, carol.id, bob.id);
    expect(carolOwesBob).toBe(0);
  });
});

// ============================================================
// Suite 7: Settlement interactions
// ============================================================

describe.skipIf(!isIntegrationTestReady)("Settlement interactions", () => {
  // 7.1 — Multiple partial settlements on the same pair
  it("7.1: multiple partial settlements reduce balance correctly", async () => {
    const [alice, bob] = await createTestUsers(2);
    const group = await createTestGroupWithMembers(alice, [bob]);

    // Bob owes Alice 9000
    await createAndActivateExpense({
      creator: alice,
      groupId: group.id,
      shares: [{ userId: bob.id, amount: 9000 }],
      payers: [{ userId: alice.id, amount: 9000 }],
    });

    // First partial settlement: 3000
    await settleDebt({
      caller: bob,
      groupId: group.id,
      fromUserId: bob.id,
      toUserId: alice.id,
      amountCents: 3000,
    });

    const after1 = await getBalanceBetween(group.id, bob.id, alice.id);
    expect(after1).toBe(6000);

    // Second partial settlement: 4000
    await settleDebt({
      caller: bob,
      groupId: group.id,
      fromUserId: bob.id,
      toUserId: alice.id,
      amountCents: 4000,
    });

    const after2 = await getBalanceBetween(group.id, bob.id, alice.id);
    expect(after2).toBe(2000);

    // Final settlement: 2000
    await settleDebt({
      caller: bob,
      groupId: group.id,
      fromUserId: bob.id,
      toUserId: alice.id,
      amountCents: 2000,
    });

    const after3 = await getBalanceBetween(group.id, bob.id, alice.id);
    expect(after3).toBe(0);
  });

  // 7.2 — Settlement called by creditor (the to_user)
  it("7.2: creditor can also call record_and_settle", async () => {
    const [alice, bob] = await createTestUsers(2);
    const group = await createTestGroupWithMembers(alice, [bob]);

    // Bob owes Alice 5000
    await createAndActivateExpense({
      creator: alice,
      groupId: group.id,
      shares: [{ userId: bob.id, amount: 5000 }],
      payers: [{ userId: alice.id, amount: 5000 }],
    });

    // Alice (creditor) records the settlement
    await settleDebt({
      caller: alice,
      groupId: group.id,
      fromUserId: bob.id,
      toUserId: alice.id,
      amountCents: 5000,
    });

    const balance = await getBalanceBetween(group.id, bob.id, alice.id);
    expect(balance).toBe(0);
  });

  // 7.3 — Settlement overshooting: paying more than the current balance
  // This is allowed — the balance goes negative (creditor now owes debtor)
  it("7.3: settlement that overshoots balance flips the debt direction", async () => {
    const [alice, bob] = await createTestUsers(2);
    const group = await createTestGroupWithMembers(alice, [bob]);

    // Bob owes Alice 3000
    await createAndActivateExpense({
      creator: alice,
      groupId: group.id,
      shares: [{ userId: bob.id, amount: 3000 }],
      payers: [{ userId: alice.id, amount: 3000 }],
    });

    // Bob pays 5000 — 2000 more than owed
    await settleDebt({
      caller: bob,
      groupId: group.id,
      fromUserId: bob.id,
      toUserId: alice.id,
      amountCents: 5000,
    });

    // Balance flips: Alice now owes Bob 2000
    const bobPerspective = await getBalanceBetween(group.id, bob.id, alice.id);
    expect(bobPerspective).toBe(-2000);

    const alicePerspective = await getBalanceBetween(
      group.id,
      alice.id,
      bob.id,
    );
    expect(alicePerspective).toBe(2000);
  });
});

// ============================================================
// Suite 8: Draft management / activation validation
// ============================================================

describe.skipIf(!isIntegrationTestReady)("Draft management & validation", () => {
  let alice: TestUser;
  let bob: TestUser;
  let groupId: string;

  beforeAll(async () => {
    [alice, bob] = await createTestUsers(2);
    const group = await createTestGroupWithMembers(alice, [bob]);
    groupId = group.id;
  });

  // 8.1 — Cannot activate with shares that don't sum to total
  it("8.1: activation fails when shares don't match total_amount", async () => {
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Mismatched Shares",
        expense_type: "single_amount",
        total_amount: 10000,
        status: "draft",
      })
      .select("id")
      .single();

    // Insert shares that sum to 9000, not 10000
    await adminClient!.from("expense_shares").insert([
      { expense_id: expense!.id, user_id: alice.id, share_amount_cents: 4000 },
      { expense_id: expense!.id, user_id: bob.id, share_amount_cents: 5000 },
    ]);

    await adminClient!.from("expense_payers").insert({
      expense_id: expense!.id,
      user_id: alice.id,
      amount_cents: 10000,
    });

    const aliceClient = authenticateAs(alice);
    const { error } = await aliceClient.rpc("activate_expense", {
      p_expense_id: expense!.id,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("shares_mismatch");

    // Cleanup
    await adminClient!.from("expenses").delete().eq("id", expense!.id);
  });

  // 8.2 — Cannot activate with payers that don't sum to total
  it("8.2: activation fails when payers don't match total_amount", async () => {
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Mismatched Payers",
        expense_type: "single_amount",
        total_amount: 10000,
        status: "draft",
      })
      .select("id")
      .single();

    await adminClient!.from("expense_shares").insert([
      { expense_id: expense!.id, user_id: alice.id, share_amount_cents: 5000 },
      { expense_id: expense!.id, user_id: bob.id, share_amount_cents: 5000 },
    ]);

    // Payers sum to 8000, not 10000
    await adminClient!.from("expense_payers").insert({
      expense_id: expense!.id,
      user_id: alice.id,
      amount_cents: 8000,
    });

    const aliceClient = authenticateAs(alice);
    const { error } = await aliceClient.rpc("activate_expense", {
      p_expense_id: expense!.id,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("payers_mismatch");

    // Cleanup
    await adminClient!.from("expenses").delete().eq("id", expense!.id);
  });

  // 8.3 — Cannot activate an already-active expense
  it("8.3: activation fails on an already-active expense", async () => {
    // Create and activate normally
    const expenseId = await createAndActivateExpense({
      creator: alice,
      groupId,
      shares: [
        { userId: alice.id, amount: 2500 },
        { userId: bob.id, amount: 2500 },
      ],
      payers: [{ userId: alice.id, amount: 5000 }],
    });

    // Try to activate again
    const aliceClient = authenticateAs(alice);
    const { error } = await aliceClient.rpc("activate_expense", {
      p_expense_id: expenseId,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("invalid_status");
  });
});
