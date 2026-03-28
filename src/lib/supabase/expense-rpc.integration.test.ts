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
    amount: row.amount_cents * sign,
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
});
