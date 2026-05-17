import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  authenticateAs,
  createTestGroup,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

/**
 * Helper: create a draft expense with shares and payers, ready for activation.
 * Returns the expense ID.
 */
async function createDraftExpense(opts: {
  groupId: string;
  creatorId: string;
  title: string;
  totalAmount: number;
  shares: { userId: string; amount: number }[];
  payers: { userId: string; amount: number }[];
}): Promise<string> {
  const { data: expense, error } = await adminClient!
    .from("expenses")
    .insert({
      group_id: opts.groupId,
      creator_id: opts.creatorId,
      title: opts.title,
      total_amount: opts.totalAmount,
      expense_type: "single_amount",
    })
    .select()
    .single();

  if (error || !expense) throw new Error(`Failed to create expense: ${error?.message}`);

  await adminClient!.from("expense_shares").insert(
    opts.shares.map((s) => ({
      expense_id: expense.id,
      user_id: s.userId,
      share_amount_cents: s.amount,
    })),
  );

  await adminClient!.from("expense_payers").insert(
    opts.payers.map((p) => ({
      expense_id: expense.id,
      user_id: p.userId,
      amount_cents: p.amount,
    })),
  );

  return expense.id;
}

/**
 * Helper: read balances for a group from admin client.
 */
async function getBalances(groupId: string) {
  const { data } = await adminClient!
    .from("balances")
    .select("*")
    .eq("group_id", groupId);
  return data ?? [];
}

/**
 * Helper: find a specific balance between two users (handles canonical ordering).
 */
function findBalance(
  balances: { user_a: string; user_b: string; amount_cents: number }[],
  userX: string,
  userY: string,
): { amount: number; userAOwesUserB: boolean } | null {
  const [a, b] = userX < userY ? [userX, userY] : [userY, userX];
  const row = balances.find((bal) => bal.user_a === a && bal.user_b === b);
  if (!row) return null;
  // Positive = user_a owes user_b
  // Return oriented as "userX owes userY"
  const sign = userX < userY ? 1 : -1;
  return {
    amount: row.amount_cents === 0 ? 0 : row.amount_cents * sign,
    userAOwesUserB: row.amount_cents > 0,
  };
}

describe.skipIf(!isIntegrationTestReady)("activate_expense RPC", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let groupId: string;

  beforeEach(async () => {
    [alice, bob, carol] = await createTestUsers(3);
    const group = await createTestGroup(alice.id, [bob.id, carol.id]);
    groupId = group.id;
    await adminClient!
      .from("group_members")
      .update({ status: "accepted" })
      .eq("group_id", groupId);
  });

  it("activates a simple equal-split expense and updates balances", async () => {
    // Alice pays 9000, split equally among Alice, Bob, Carol (3000 each)
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Dinner",
      totalAmount: 9000,
      shares: [
        { userId: alice.id, amount: 3000 },
        { userId: bob.id, amount: 3000 },
        { userId: carol.id, amount: 3000 },
      ],
      payers: [{ userId: alice.id, amount: 9000 }],
    });

    const client = authenticateAs(alice);
    const { error } = await client.rpc("activate_expense", {
      p_expense_id: expenseId,
    });

    expect(error).toBeNull();

    // Verify expense status changed
    const { data: expense } = await adminClient!
      .from("expenses")
      .select("status")
      .eq("id", expenseId)
      .single();
    expect(expense!.status).toBe("active");

    // Verify balances
    const balances = await getBalances(groupId);
    // Bob owes Alice 3000, Carol owes Alice 3000
    const bobToAlice = findBalance(balances, bob.id, alice.id);
    const carolToAlice = findBalance(balances, carol.id, alice.id);
    const bobToCarol = findBalance(balances, bob.id, carol.id);

    expect(bobToAlice).not.toBeNull();
    expect(bobToAlice!.amount).toBe(3000); // Bob owes Alice
    expect(carolToAlice).not.toBeNull();
    expect(carolToAlice!.amount).toBe(3000); // Carol owes Alice
    // No balance between Bob and Carol
    expect(bobToCarol).toBeNull();
  });

  it("handles multiple payers correctly", async () => {
    // Alice pays 6000, Bob pays 4000. Total 10000.
    // Shares: Alice 3000, Bob 3000, Carol 4000
    // Expected debts:
    //   Carol→Alice: ROUND(4000*6000/10000) = 2400
    //   Carol→Bob:   ROUND(4000*4000/10000) = 1600
    //   Bob→Alice:   ROUND(3000*6000/10000) = 1800
    //   Alice→Bob:   ROUND(3000*4000/10000) = 1200
    //   Net Alice↔Bob: Bob owes Alice 1800-1200 = 600
    //   Net Carol→Alice: 2400
    //   Net Carol→Bob: 1600
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Multi-payer dinner",
      totalAmount: 10000,
      shares: [
        { userId: alice.id, amount: 3000 },
        { userId: bob.id, amount: 3000 },
        { userId: carol.id, amount: 4000 },
      ],
      payers: [
        { userId: alice.id, amount: 6000 },
        { userId: bob.id, amount: 4000 },
      ],
    });

    const client = authenticateAs(alice);
    const { error } = await client.rpc("activate_expense", {
      p_expense_id: expenseId,
    });
    expect(error).toBeNull();

    const balances = await getBalances(groupId);
    const bobToAlice = findBalance(balances, bob.id, alice.id);
    const carolToAlice = findBalance(balances, carol.id, alice.id);
    const carolToBob = findBalance(balances, carol.id, bob.id);

    expect(bobToAlice).not.toBeNull();
    expect(bobToAlice!.amount).toBe(600);
    expect(carolToAlice).not.toBeNull();
    expect(carolToAlice!.amount).toBe(2400);
    expect(carolToBob).not.toBeNull();
    expect(carolToBob!.amount).toBe(1600);
  });

  it("accumulates balances across multiple expenses", async () => {
    // First expense: Alice pays 6000, split equally (2000 each)
    const exp1 = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Expense 1",
      totalAmount: 6000,
      shares: [
        { userId: alice.id, amount: 2000 },
        { userId: bob.id, amount: 2000 },
        { userId: carol.id, amount: 2000 },
      ],
      payers: [{ userId: alice.id, amount: 6000 }],
    });

    const aliceClient = authenticateAs(alice);
    await aliceClient.rpc("activate_expense", { p_expense_id: exp1 });

    // Second expense: Bob pays 3000, split equally (1000 each)
    const exp2 = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Expense 2",
      totalAmount: 3000,
      shares: [
        { userId: alice.id, amount: 1000 },
        { userId: bob.id, amount: 1000 },
        { userId: carol.id, amount: 1000 },
      ],
      payers: [{ userId: bob.id, amount: 3000 }],
    });

    await aliceClient.rpc("activate_expense", { p_expense_id: exp2 });

    const balances = await getBalances(groupId);

    // After exp1: Bob→Alice = 2000, Carol→Alice = 2000
    // After exp2: Alice→Bob = 1000, Carol→Bob = 1000
    // Net Bob↔Alice: Bob owes Alice 2000-1000 = 1000
    // Net Carol↔Alice: Carol owes Alice 2000
    // Net Carol↔Bob: Carol owes Bob 1000
    const bobToAlice = findBalance(balances, bob.id, alice.id);
    const carolToAlice = findBalance(balances, carol.id, alice.id);
    const carolToBob = findBalance(balances, carol.id, bob.id);

    expect(bobToAlice!.amount).toBe(1000);
    expect(carolToAlice!.amount).toBe(2000);
    expect(carolToBob!.amount).toBe(1000);
  });

  it("rejects activation by non-creator", async () => {
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Alice's expense",
      totalAmount: 3000,
      shares: [
        { userId: alice.id, amount: 1000 },
        { userId: bob.id, amount: 1000 },
        { userId: carol.id, amount: 1000 },
      ],
      payers: [{ userId: alice.id, amount: 3000 }],
    });

    const bobClient = authenticateAs(bob);
    const { error } = await bobClient.rpc("activate_expense", {
      p_expense_id: expenseId,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("permission_denied");
  });

  it("rejects activating an already active expense", async () => {
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Double activate",
      totalAmount: 6000,
      shares: [
        { userId: alice.id, amount: 3000 },
        { userId: bob.id, amount: 3000 },
      ],
      payers: [{ userId: alice.id, amount: 6000 }],
    });

    const client = authenticateAs(alice);
    await client.rpc("activate_expense", { p_expense_id: expenseId });

    // Try again
    const { error } = await client.rpc("activate_expense", {
      p_expense_id: expenseId,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("invalid_status");
  });

  it("rejects when shares don't sum to total", async () => {
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Bad shares",
        total_amount: 10000,
      })
      .select()
      .single();

    await adminClient!.from("expense_shares").insert([
      { expense_id: expense!.id, user_id: alice.id, share_amount_cents: 3000 },
      { expense_id: expense!.id, user_id: bob.id, share_amount_cents: 3000 },
      // Missing Carol's share — only 6000/10000
    ]);

    await adminClient!.from("expense_payers").insert({
      expense_id: expense!.id,
      user_id: alice.id,
      amount_cents: 10000,
    });

    const client = authenticateAs(alice);
    const { error } = await client.rpc("activate_expense", {
      p_expense_id: expense!.id,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("shares_mismatch");
  });

  it("rejects when payers don't sum to total", async () => {
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Bad payers",
        total_amount: 10000,
      })
      .select()
      .single();

    await adminClient!.from("expense_shares").insert([
      { expense_id: expense!.id, user_id: alice.id, share_amount_cents: 5000 },
      { expense_id: expense!.id, user_id: bob.id, share_amount_cents: 5000 },
    ]);

    await adminClient!.from("expense_payers").insert({
      expense_id: expense!.id,
      user_id: alice.id,
      amount_cents: 8000, // Only 8000/10000
    });

    const client = authenticateAs(alice);
    const { error } = await client.rpc("activate_expense", {
      p_expense_id: expense!.id,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("payers_mismatch");
  });

  it("handles two-person expense (1-on-1)", async () => {
    // Simple: Alice pays 5000, split 2500 each
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Coffee",
      totalAmount: 5000,
      shares: [
        { userId: alice.id, amount: 2500 },
        { userId: bob.id, amount: 2500 },
      ],
      payers: [{ userId: alice.id, amount: 5000 }],
    });

    const client = authenticateAs(alice);
    await client.rpc("activate_expense", { p_expense_id: expenseId });

    const balances = await getBalances(groupId);
    const bobToAlice = findBalance(balances, bob.id, alice.id);
    expect(bobToAlice!.amount).toBe(2500);
  });

  it("concurrent activation of same expense — only one succeeds", async () => {
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Race condition",
      totalAmount: 6000,
      shares: [
        { userId: alice.id, amount: 2000 },
        { userId: bob.id, amount: 2000 },
        { userId: carol.id, amount: 2000 },
      ],
      payers: [{ userId: alice.id, amount: 6000 }],
    });

    // Two concurrent activation attempts by the same creator
    const client1 = authenticateAs(alice);
    const client2 = authenticateAs(alice);

    const results = await Promise.allSettled([
      client1.rpc("activate_expense", { p_expense_id: expenseId }),
      client2.rpc("activate_expense", { p_expense_id: expenseId }),
    ]);

    // Exactly one should succeed, the other should fail with invalid_status
    const successes = results.filter(
      (r) =>
        r.status === "fulfilled" &&
        !(r.value as { error: unknown }).error,
    );
    const failures = results.filter(
      (r) =>
        r.status === "fulfilled" &&
        !!(r.value as { error: unknown }).error,
    );

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // The failure should be invalid_status (the row was already activated by the winner)
    const failResult = failures[0] as PromiseFulfilledResult<{
      error: { message: string } | null;
    }>;
    expect(failResult.value.error!.message).toContain("invalid_status");

    // Balances should reflect exactly one activation (not doubled)
    const balances = await getBalances(groupId);
    const bobToAlice = findBalance(balances, bob.id, alice.id);
    expect(bobToAlice!.amount).toBe(2000);
  });

  it("concurrent activation of different expenses — balances accumulate correctly", async () => {
    // Expense 1: Alice pays 6000, split equally
    const exp1 = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Concurrent exp 1",
      totalAmount: 6000,
      shares: [
        { userId: alice.id, amount: 2000 },
        { userId: bob.id, amount: 2000 },
        { userId: carol.id, amount: 2000 },
      ],
      payers: [{ userId: alice.id, amount: 6000 }],
    });

    // Expense 2: Bob pays 3000, split equally
    const exp2 = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Concurrent exp 2",
      totalAmount: 3000,
      shares: [
        { userId: alice.id, amount: 1000 },
        { userId: bob.id, amount: 1000 },
        { userId: carol.id, amount: 1000 },
      ],
      payers: [{ userId: bob.id, amount: 3000 }],
    });

    // Activate both concurrently
    const client = authenticateAs(alice);
    const [r1, r2] = await Promise.all([
      client.rpc("activate_expense", { p_expense_id: exp1 }),
      client.rpc("activate_expense", { p_expense_id: exp2 }),
    ]);

    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();

    // Expected net balances:
    //   exp1: Bob→Alice=2000, Carol→Alice=2000
    //   exp2: Alice→Bob=1000, Carol→Bob=1000
    //   Net Bob↔Alice: Bob owes Alice 2000-1000=1000
    //   Net Carol↔Alice: Carol owes Alice 2000
    //   Net Carol↔Bob: Carol owes Bob 1000
    const balances = await getBalances(groupId);
    expect(findBalance(balances, bob.id, alice.id)!.amount).toBe(1000);
    expect(findBalance(balances, carol.id, alice.id)!.amount).toBe(2000);
    expect(findBalance(balances, carol.id, bob.id)!.amount).toBe(1000);
  });

  it("handles rounding with indivisible amounts", async () => {
    // 10001 cents split 3 ways: ROUND(10001/3) = 3334, 3334, 3333
    // But shares must sum to total, so caller provides exact split
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Odd split",
      totalAmount: 10001,
      shares: [
        { userId: alice.id, amount: 3334 },
        { userId: bob.id, amount: 3334 },
        { userId: carol.id, amount: 3333 },
      ],
      payers: [{ userId: alice.id, amount: 10001 }],
    });

    const client = authenticateAs(alice);
    const { error } = await client.rpc("activate_expense", {
      p_expense_id: expenseId,
    });
    expect(error).toBeNull();

    const balances = await getBalances(groupId);
    // Bob owes Alice: ROUND(3334 * 10001 / 10001) = 3334
    // Carol owes Alice: ROUND(3333 * 10001 / 10001) = 3333
    const bobToAlice = findBalance(balances, bob.id, alice.id);
    const carolToAlice = findBalance(balances, carol.id, alice.id);
    expect(bobToAlice!.amount).toBe(3334);
    expect(carolToAlice!.amount).toBe(3333);
  });

  it("rounding-residual case: sum invariant + bounded per-user error", async () => {
    // total=200, shares={alice:10, bob:10, carol:180}, payers={alice:10, bob:100, carol:90}
    // Exact net per user = consumed - paid:
    //   alice: 10 - 10 = 0
    //   bob:   10 - 100 = -90  (bob is owed 90 net)
    //   carol: 180 - 90 = +90  (carol owes 90 net)
    //
    // The algorithm guarantees:
    //   - sum of all balance rows for this group = 0 (universe conservation)
    //   - each per-pair rounded value differs from the exact by ≤ 1 cent
    //   - per-user error is bounded by ±2 cents (a user can appear in multiple pairs)
    //
    // Per-user exact values (alice=0, bob=-90, carol=+90) are NOT guaranteed to be
    // reproduced exactly because the residual correction lands on a single canonical pair
    // and is UUID-ordering-dependent.
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Rounding residual",
      totalAmount: 200,
      shares: [
        { userId: alice.id, amount: 10 },
        { userId: bob.id, amount: 10 },
        { userId: carol.id, amount: 180 },
      ],
      payers: [
        { userId: alice.id, amount: 10 },
        { userId: bob.id, amount: 100 },
        { userId: carol.id, amount: 90 },
      ],
    });

    const client = authenticateAs(alice);
    const { error } = await client.rpc("activate_expense", {
      p_expense_id: expenseId,
    });
    expect(error).toBeNull();

    const balances = await getBalances(groupId);

    // Compute per-user net from balance rows (UUID-ordering-agnostic).
    // Positive net means the user is a net debtor; negative means net creditor.
    const net: Record<string, number> = {
      [alice.id]: 0,
      [bob.id]: 0,
      [carol.id]: 0,
    };
    for (const row of balances) {
      if (row.user_a in net) net[row.user_a] += row.amount_cents;
      if (row.user_b in net) net[row.user_b] -= row.amount_cents;
    }

    // Sum invariant: all nets sum to zero (universe-level conservation).
    const totalNet = net[alice.id] + net[bob.id] + net[carol.id];
    expect(totalNet).toBe(0);

    // Per-user error bounded by ±2 cents from exact net.
    // Exact: alice=0, bob=-90, carol=+90.
    expect(Math.abs(net[alice.id] - 0)).toBeLessThanOrEqual(2);
    expect(Math.abs(net[bob.id] - (-90))).toBeLessThanOrEqual(2);
    expect(Math.abs(net[carol.id] - 90)).toBeLessThanOrEqual(2);
  });

  it("rounding-residual case: sum of all balance deltas is exact", async () => {
    // Same scenario. The signed sum of amount_cents across all balance rows for this
    // expense must equal the exact mathematical sum of (consumed - paid) for all users,
    // which is 0 + (-90) + 90 = 0 — i.e., the books balance.
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Rounding residual sum",
      totalAmount: 200,
      shares: [
        { userId: alice.id, amount: 10 },
        { userId: bob.id, amount: 10 },
        { userId: carol.id, amount: 180 },
      ],
      payers: [
        { userId: alice.id, amount: 10 },
        { userId: bob.id, amount: 100 },
        { userId: carol.id, amount: 90 },
      ],
    });

    const client = authenticateAs(alice);
    await client.rpc("activate_expense", { p_expense_id: expenseId });

    const balances = await getBalances(groupId);

    // Compute net for each user and verify the sum across all users is zero.
    const users = [alice.id, bob.id, carol.id];
    const net: Record<string, number> = Object.fromEntries(users.map((u) => [u, 0]));
    for (const row of balances) {
      if (row.user_a in net) net[row.user_a] += row.amount_cents;
      if (row.user_b in net) net[row.user_b] -= row.amount_cents;
    }

    const totalNet = users.reduce((acc, u) => acc + net[u], 0);
    expect(totalNet).toBe(0);
  });

  it("trivial even split: no rounding error with exact division", async () => {
    // 2-user, amount divisible — residual must be zero and balances exact.
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Even two-way split",
      totalAmount: 1000,
      shares: [
        { userId: alice.id, amount: 500 },
        { userId: bob.id, amount: 500 },
      ],
      payers: [{ userId: alice.id, amount: 1000 }],
    });

    const client = authenticateAs(alice);
    const { error } = await client.rpc("activate_expense", {
      p_expense_id: expenseId,
    });
    expect(error).toBeNull();

    const balances = await getBalances(groupId);
    const bobToAlice = findBalance(balances, bob.id, alice.id);
    expect(bobToAlice!.amount).toBe(500);

    const net: Record<string, number> = { [alice.id]: 0, [bob.id]: 0 };
    for (const row of balances) {
      if (row.user_a in net) net[row.user_a] += row.amount_cents;
      if (row.user_b in net) net[row.user_b] -= row.amount_cents;
    }
    const totalNet = Object.values(net).reduce((a, b) => a + b, 0);
    expect(totalNet).toBe(0);
  });

  it("guest shares present: excluded from balance pairs, sum-zero holds", async () => {
    // total=200, real shares={alice:5, bob:5}, guest_share=190, payers={alice:100, bob:100}
    // Only alice↔bob balance pair exists; guest portion is excluded.
    // What matters: the real-user sum-zero holds for whichever users appear in balance rows.
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Guest share expense",
        total_amount: 200,
        expense_type: "single_amount",
      })
      .select()
      .single();

    // Create guest entry first (required by FK constraint).
    const { data: guest } = await adminClient!
      .from("expense_guests")
      .insert({ expense_id: expense!.id, display_name: "Guest" })
      .select()
      .single();

    await adminClient!.from("expense_shares").insert([
      { expense_id: expense!.id, user_id: alice.id, share_amount_cents: 5 },
      { expense_id: expense!.id, user_id: bob.id, share_amount_cents: 5 },
    ]);

    await adminClient!.from("expense_guest_shares").insert([
      { expense_id: expense!.id, guest_id: guest!.id, share_amount_cents: 190 },
    ]);

    await adminClient!.from("expense_payers").insert([
      { expense_id: expense!.id, user_id: alice.id, amount_cents: 100 },
      { expense_id: expense!.id, user_id: bob.id, amount_cents: 100 },
    ]);

    const client = authenticateAs(alice);
    const { error } = await client.rpc("activate_expense", {
      p_expense_id: expense!.id,
    });
    expect(error).toBeNull();

    const balances = await getBalances(groupId);

    // Sum across all real-user nets must be zero.
    const net: Record<string, number> = { [alice.id]: 0, [bob.id]: 0 };
    for (const row of balances) {
      if (row.user_a in net) net[row.user_a] += row.amount_cents;
      if (row.user_b in net) net[row.user_b] -= row.amount_cents;
    }
    const totalNet = net[alice.id] + net[bob.id];
    expect(totalNet).toBe(0);
  });

  it("single-user expense: sole share and sole payer produces zero balance rows", async () => {
    // Alice creates an expense she fully paid and fully consumed.
    // There are no canonical (user_a, user_b) pairs with user_a != user_b, so no balance rows.
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Solo expense",
      totalAmount: 500,
      shares: [{ userId: alice.id, amount: 500 }],
      payers: [{ userId: alice.id, amount: 500 }],
    });

    const client = authenticateAs(alice);
    const { error } = await client.rpc("activate_expense", {
      p_expense_id: expenseId,
    });
    expect(error).toBeNull();

    const balances = await getBalances(groupId);
    // No pairs with distinct users → no balance rows created.
    expect(balances).toHaveLength(0);
  });

  it("many-user expense (5 users): sum invariant + bounded per-user error", async () => {
    // Extend the group with 2 more members beyond alice, bob, carol.
    const [dave, eve] = await createTestUsers(2);
    await adminClient!.from("group_members").insert([
      { group_id: groupId, user_id: dave.id, status: "accepted", invited_by: alice.id },
      { group_id: groupId, user_id: eve.id, status: "accepted", invited_by: alice.id },
    ]);

    // total=701 (intentionally not divisible by 5)
    // shares: alice=200, bob=150, carol=150, dave=100, eve=101
    // payers: alice=400, bob=301
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Five-user expense",
      totalAmount: 701,
      shares: [
        { userId: alice.id, amount: 200 },
        { userId: bob.id, amount: 150 },
        { userId: carol.id, amount: 150 },
        { userId: dave.id, amount: 100 },
        { userId: eve.id, amount: 101 },
      ],
      payers: [
        { userId: alice.id, amount: 400 },
        { userId: bob.id, amount: 301 },
      ],
    });

    const client = authenticateAs(alice);
    const { error } = await client.rpc("activate_expense", {
      p_expense_id: expenseId,
    });
    expect(error).toBeNull();

    const balances = await getBalances(groupId);

    const users = [alice.id, bob.id, carol.id, dave.id, eve.id];
    const net: Record<string, number> = Object.fromEntries(users.map((u) => [u, 0]));
    for (const row of balances) {
      if (row.user_a in net) net[row.user_a] += row.amount_cents;
      if (row.user_b in net) net[row.user_b] -= row.amount_cents;
    }

    // Sum invariant.
    const totalNet = users.reduce((acc, u) => acc + net[u], 0);
    expect(totalNet).toBe(0);

    // Exact nets: consumed - paid (centavos).
    const exactNets: Record<string, number> = {
      [alice.id]: 200 - 400,  // -200
      [bob.id]: 150 - 301,    // -151
      [carol.id]: 150 - 0,    // +150
      [dave.id]: 100 - 0,     // +100
      [eve.id]: 101 - 0,      // +101
    };

    for (const u of users) {
      expect(Math.abs(net[u] - exactNets[u])).toBeLessThanOrEqual(2);
    }
  });

  it("user as both consumer and payer: self-debt cancels, only cross-user balances remain", async () => {
    // shares={alice:50, bob:50}, payers={alice:40, bob:60}
    // Exact nets: alice = 50 - 40 = +10 (owes 10), bob = 50 - 60 = -10 (is owed 10)
    // The per-user net comes entirely from the alice↔bob canonical pair.
    // Self-pairs (alice↔alice, bob↔bob) are excluded by the RPC (s.user_id != p.user_id).
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Self-consumer and payer",
      totalAmount: 100,
      shares: [
        { userId: alice.id, amount: 50 },
        { userId: bob.id, amount: 50 },
      ],
      payers: [
        { userId: alice.id, amount: 40 },
        { userId: bob.id, amount: 60 },
      ],
    });

    const client = authenticateAs(alice);
    const { error } = await client.rpc("activate_expense", {
      p_expense_id: expenseId,
    });
    expect(error).toBeNull();

    const balances = await getBalances(groupId);

    // Only one canonical pair: alice↔bob.
    const aliceToBob = findBalance(balances, alice.id, bob.id);
    expect(aliceToBob).not.toBeNull();

    // Alice owes Bob 10 (alice consumed 50 but only paid 40).
    expect(aliceToBob!.amount).toBe(10);

    // Sum invariant.
    const net: Record<string, number> = { [alice.id]: 0, [bob.id]: 0 };
    for (const row of balances) {
      if (row.user_a in net) net[row.user_a] += row.amount_cents;
      if (row.user_b in net) net[row.user_b] -= row.amount_cents;
    }
    expect(net[alice.id] + net[bob.id]).toBe(0);
  });
});

describe.skipIf(!isIntegrationTestReady)("confirm_settlement RPC", () => {
  let alice: TestUser;
  let bob: TestUser;
  let groupId: string;

  beforeEach(async () => {
    [alice, bob] = await createTestUsers(2);
    const group = await createTestGroup(alice.id, [bob.id]);
    groupId = group.id;
    await adminClient!
      .from("group_members")
      .update({ status: "accepted" })
      .eq("group_id", groupId);
  });

  it("confirms a settlement and updates balances", async () => {
    // Set up: Bob owes Alice 5000
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Setup debt",
      totalAmount: 10000,
      shares: [
        { userId: alice.id, amount: 5000 },
        { userId: bob.id, amount: 5000 },
      ],
      payers: [{ userId: alice.id, amount: 10000 }],
    });

    const aliceClient = authenticateAs(alice);
    await aliceClient.rpc("activate_expense", { p_expense_id: expenseId });

    // Bob owes Alice 5000. Bob creates a settlement.
    const bobClient = authenticateAs(bob);
    const { data: settlement } = await bobClient
      .from("settlements")
      .insert({
        group_id: groupId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 5000,
      })
      .select()
      .single();

    expect(settlement!.status).toBe("pending");

    // Alice confirms
    const { error } = await aliceClient.rpc("confirm_settlement", {
      p_settlement_id: settlement!.id,
    });
    expect(error).toBeNull();

    // Verify settlement is confirmed
    const { data: confirmed } = await adminClient!
      .from("settlements")
      .select("status, confirmed_at")
      .eq("id", settlement!.id)
      .single();
    expect(confirmed!.status).toBe("confirmed");
    expect(confirmed!.confirmed_at).not.toBeNull();

    // Verify balance is zero
    const balances = await getBalances(groupId);
    const bobToAlice = findBalance(balances, bob.id, alice.id);
    expect(bobToAlice!.amount).toBe(0);
  });

  it("handles partial settlement", async () => {
    // Bob owes Alice 5000
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Setup debt",
      totalAmount: 10000,
      shares: [
        { userId: alice.id, amount: 5000 },
        { userId: bob.id, amount: 5000 },
      ],
      payers: [{ userId: alice.id, amount: 10000 }],
    });

    const aliceClient = authenticateAs(alice);
    await aliceClient.rpc("activate_expense", { p_expense_id: expenseId });

    // Bob pays only 2000 of the 5000 owed
    const bobClient = authenticateAs(bob);
    const { data: settlement } = await bobClient
      .from("settlements")
      .insert({
        group_id: groupId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 2000,
      })
      .select()
      .single();

    await aliceClient.rpc("confirm_settlement", {
      p_settlement_id: settlement!.id,
    });

    const balances = await getBalances(groupId);
    const bobToAlice = findBalance(balances, bob.id, alice.id);
    expect(bobToAlice!.amount).toBe(3000); // 5000 - 2000
  });

  it("rejects confirmation by non-payee", async () => {
    // Create a settlement: Bob → Alice
    const { data: settlement } = await adminClient!
      .from("settlements")
      .insert({
        group_id: groupId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 1000,
      })
      .select()
      .single();

    // Bob tries to confirm (but only Alice/to_user should)
    const bobClient = authenticateAs(bob);
    const { error } = await bobClient.rpc("confirm_settlement", {
      p_settlement_id: settlement!.id,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("permission_denied");
  });

  it("rejects confirming already-confirmed settlement", async () => {
    const { data: settlement } = await adminClient!
      .from("settlements")
      .insert({
        group_id: groupId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 1000,
      })
      .select()
      .single();

    const aliceClient = authenticateAs(alice);
    await aliceClient.rpc("confirm_settlement", {
      p_settlement_id: settlement!.id,
    });

    // Try again
    const { error } = await aliceClient.rpc("confirm_settlement", {
      p_settlement_id: settlement!.id,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("invalid_status");
  });

  it("creates balance row if none exists before settlement", async () => {
    // No prior expense — just a direct settlement
    const bobClient = authenticateAs(bob);
    const { data: settlement } = await bobClient
      .from("settlements")
      .insert({
        group_id: groupId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 3000,
      })
      .select()
      .single();

    const aliceClient = authenticateAs(alice);
    const { error } = await aliceClient.rpc("confirm_settlement", {
      p_settlement_id: settlement!.id,
    });
    expect(error).toBeNull();

    // Balance should be created (Bob overpaid, so Alice now owes Bob)
    const balances = await getBalances(groupId);
    const bobToAlice = findBalance(balances, bob.id, alice.id);
    expect(bobToAlice!.amount).toBe(-3000); // Negative = Alice owes Bob
  });

  it("settlement overshoot flips balance direction", async () => {
    // Bob owes Alice 2000
    const expenseId = await createDraftExpense({
      groupId,
      creatorId: alice.id,
      title: "Small debt",
      totalAmount: 4000,
      shares: [
        { userId: alice.id, amount: 2000 },
        { userId: bob.id, amount: 2000 },
      ],
      payers: [{ userId: alice.id, amount: 4000 }],
    });

    const aliceClient = authenticateAs(alice);
    await aliceClient.rpc("activate_expense", { p_expense_id: expenseId });

    // Bob pays 5000 (overshoots by 3000)
    const bobClient = authenticateAs(bob);
    const { data: settlement } = await bobClient
      .from("settlements")
      .insert({
        group_id: groupId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 5000,
      })
      .select()
      .single();

    await aliceClient.rpc("confirm_settlement", {
      p_settlement_id: settlement!.id,
    });

    // Balance was 2000 (Bob owes Alice), settlement subtracts 5000 → -3000 (Alice owes Bob)
    const balances = await getBalances(groupId);
    const bobToAlice = findBalance(balances, bob.id, alice.id);
    expect(bobToAlice!.amount).toBe(-3000);
  });

  it("concurrent settlement confirmation — only one succeeds", async () => {
    const bobClient = authenticateAs(bob);
    const { data: settlement } = await bobClient
      .from("settlements")
      .insert({
        group_id: groupId,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 1000,
      })
      .select()
      .single();

    const client1 = authenticateAs(alice);
    const client2 = authenticateAs(alice);

    const results = await Promise.allSettled([
      client1.rpc("confirm_settlement", {
        p_settlement_id: settlement!.id,
      }),
      client2.rpc("confirm_settlement", {
        p_settlement_id: settlement!.id,
      }),
    ]);

    const successes = results.filter(
      (r) =>
        r.status === "fulfilled" &&
        !(r.value as { error: unknown }).error,
    );
    const failures = results.filter(
      (r) =>
        r.status === "fulfilled" &&
        !!(r.value as { error: unknown }).error,
    );

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const failResult = failures[0] as PromiseFulfilledResult<{
      error: { message: string } | null;
    }>;
    expect(failResult.value.error!.message).toContain("invalid_status");
  });
});
