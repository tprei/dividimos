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

/**
 * Issue #477: creates a draft expense through save_expense_draft_graph --
 * the only path allowed to insert a new expenses row. Returns id +
 * graph_revision so callers can attempt activation (which may then reject
 * for the mismatch this test is asserting).
 */
async function saveDraft(
  creator: TestUser,
  groupId: string,
  fields: {
    title: string;
    totalAmount: number;
    shares: { userId: string; amount: number }[];
    payers: { userId: string; amount: number }[];
  },
): Promise<{ id: string; graphRevision: number }> {
  const client = authenticateAs(creator);
  const { data, error } = await client.rpc("save_expense_draft_graph", {
    p_expense: {
      group_id: groupId,
      title: fields.title,
      merchant_name: null,
      expense_type: "single_amount",
      total_amount: fields.totalAmount,
      service_fee_basis_points: 0,
      fixed_fees: 0,
    },
    p_items: [],
    p_shares: fields.shares.map((s) => ({ user_id: s.userId, share_amount_cents: s.amount })),
    p_payers: fields.payers.map((p) => ({ user_id: p.userId, amount_cents: p.amount })),
    p_guests: [],
    p_guest_shares: [],
    p_participant_order: [],
    p_expected_graph_revision: 0,
    p_save_operation_id: crypto.randomUUID(),
  });
  if (error || !data) {
    throw new Error(`Failed to save draft: ${error?.message}`);
  }
  const result = data as { id: string; graph_revision: number };
  return { id: result.id, graphRevision: result.graph_revision };
}
// ============================================================
// Suite 6: Edge cases and rounding
// ============================================================

describe.skipIf(!isIntegrationTestReady)("Edge cases & rounding", () => {
  // 6.1 — Multiple payers, exact integer allocation (#468)
  // Three-way split of 100 cents: shares = 33, 33, 34
  // Two payers: Alice 60, Bob 40.
  // Per-user net = share − paid:
  //   Alice = 33 − 60 = −27 (creditor)
  //   Bob   = 33 − 40 = −7  (creditor)
  //   Carol = 34 − 0  = +34 (debtor)
  // Carol's 34 debt covers both creditors: Carol→Alice 27, Carol→Bob 7.
  // No Alice↔Bob edge. (The old per-pair ROUND() body produced
  // Bob→Alice 7, Carol→Alice 20, Carol→Bob 14 — the buggy residual.)
  it("6.1: multiple payers produce exact per-user incidence", async () => {
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

    // No Alice↔Bob edge (both are creditors).
    const bobOwesAlice = await getBalanceBetween(group.id, bob.id, alice.id);
    expect(bobOwesAlice).toBe(0);

    // Carol owes Alice 27.
    const carolOwesAlice = await getBalanceBetween(
      group.id,
      carol.id,
      alice.id,
    );
    expect(carolOwesAlice).toBe(27);

    // Carol owes Bob 7.
    const carolOwesBob = await getBalanceBetween(group.id, carol.id, bob.id);
    expect(carolOwesBob).toBe(7);
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

  // 6.8 — Rounding: 3 cents split among 3 consumers, 2 payers
  // shares: A=1, B=1, C=1; payers: A=2, B=1. Total=3
  // New algorithm aggregates exact NUMERIC per canonical pair, then ROUNDs once:
  //   Pair(A,B) exact = ±(1*1/3 - 1*2/3) = ±(-1/3) → ROUND(±0.333) = 0 → no debt
  //   Pair(A,C) exact = -(1*2/3) = -2/3 → ROUND(-0.667) = -1 → C owes A 1
  //   Pair(B,C) exact = -(1*1/3) = -1/3 → ROUND(-0.333) = 0 → no debt
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

    // activate_expense rounds exact-numeric per-pair sum then reconciles residual onto first pair.
    // Pair(alice,bob) exact = (1*2/3) - (1*1/3) signed = ±1/3 → ROUND(±0.333) = 0. Net = 0.
    const bobOwesAlice = await getBalanceBetween(group.id, bob.id, alice.id);
    expect(bobOwesAlice).toBe(0);

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
  it("7.2: creditor can also call record_settlements", async () => {
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
    // Draft via save_expense_draft_graph (#477 guard rejects direct table
    // writes). Shares sum to 9000 (under-allocated), total is 10000 -- an
    // incomplete draft, which the save RPC accepts; activation must reject.
    const draft = await saveDraft(alice, groupId, {
      title: "Mismatched Shares",
      totalAmount: 10000,
      shares: [
        { userId: alice.id, amount: 4000 },
        { userId: bob.id, amount: 5000 },
      ],
      payers: [{ userId: alice.id, amount: 10000 }],
    });

    const aliceClient = authenticateAs(alice);
    const { error } = await aliceClient.rpc("activate_saved_expense", {
      p_expense_id: draft.id,
      p_expected_graph_revision: draft.graphRevision,
    });

    expect(error).not.toBeNull();
  });

  // 8.2 — Cannot activate with payers that don't sum to total
  it("8.2: activation fails when payers don't match total_amount", async () => {
    // Payers sum to 8000, not 10000. Under-allocated draft (save accepts);
    // activation must reject.
    const draft = await saveDraft(alice, groupId, {
      title: "Mismatched Payers",
      totalAmount: 10000,
      shares: [
        { userId: alice.id, amount: 5000 },
        { userId: bob.id, amount: 5000 },
      ],
      payers: [{ userId: alice.id, amount: 8000 }],
    });

    const aliceClient = authenticateAs(alice);
    const { error } = await aliceClient.rpc("activate_saved_expense", {
      p_expense_id: draft.id,
      p_expected_graph_revision: draft.graphRevision,
    });

    expect(error).not.toBeNull();
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

    // Try to activate again -- activate_saved_expense's CAS rejects a
    // non-draft status with PST08/stale_graph_revision regardless of which
    // graph_revision is passed.
    const { data: current } = await adminClient!
      .from("expenses")
      .select("graph_revision")
      .eq("id", expenseId)
      .single();
    const aliceClient = authenticateAs(alice);
    const { error } = await aliceClient.rpc("activate_saved_expense", {
      p_expense_id: expenseId,
      p_expected_graph_revision: current!.graph_revision,
    });

    expect(error).not.toBeNull();
  });
});
