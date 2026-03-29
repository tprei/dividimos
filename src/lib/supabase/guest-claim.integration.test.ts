import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  createTestUser,
  authenticateAs,
  createTestGroup,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

/**
 * Helper: create a draft expense with shares, payers, and guest(s).
 */
async function createDraftExpenseWithGuests(opts: {
  groupId: string;
  creatorId: string;
  title: string;
  totalAmount: number;
  shares: { userId: string; amount: number }[];
  payers: { userId: string; amount: number }[];
  guests: { displayName: string; amount: number }[];
}): Promise<{ expenseId: string; guestTokens: string[] }> {
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

  if (opts.shares.length > 0) {
    await adminClient!.from("expense_shares").insert(
      opts.shares.map((s) => ({
        expense_id: expense.id,
        user_id: s.userId,
        share_amount_cents: s.amount,
      })),
    );
  }

  await adminClient!.from("expense_payers").insert(
    opts.payers.map((p) => ({
      expense_id: expense.id,
      user_id: p.userId,
      amount_cents: p.amount,
    })),
  );

  if (opts.guests.length > 0) {
    await adminClient!.from("expense_guests").insert(
      opts.guests.map((g) => ({
        expense_id: expense.id,
        display_name: g.displayName,
        share_amount_cents: g.amount,
      })),
    );
  }

  // Fetch guest tokens
  const { data: guests } = await adminClient!
    .from("expense_guests")
    .select("claim_token")
    .eq("expense_id", expense.id)
    .order("display_name");

  return {
    expenseId: expense.id,
    guestTokens: (guests ?? []).map((g) => g.claim_token),
  };
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
): number | null {
  const [a, b] = userX < userY ? [userX, userY] : [userY, userX];
  const row = balances.find((bal) => bal.user_a === a && bal.user_b === b);
  if (!row) return null;
  const sign = userX < userY ? 1 : -1;
  return row.amount_cents * sign;
}

// ============================================================
// expense_guests table RLS tests
// ============================================================

describe.skipIf(!isIntegrationTestReady)("expense_guests RLS", () => {
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

  it("creator can insert and read guests", async () => {
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Guest test",
        total_amount: 6000,
      })
      .select()
      .single();

    const aliceClient = authenticateAs(alice);
    const { error: insertError } = await aliceClient
      .from("expense_guests")
      .insert({
        expense_id: expense!.id,
        display_name: "Guest Dave",
        share_amount_cents: 2000,
      });

    expect(insertError).toBeNull();

    const { data: guests, error: selectError } = await aliceClient
      .from("expense_guests")
      .select("*")
      .eq("expense_id", expense!.id);

    expect(selectError).toBeNull();
    expect(guests).toHaveLength(1);
    expect(guests![0].display_name).toBe("Guest Dave");
    expect(guests![0].claim_token).toBeTruthy();
  });

  it("group member can read but not insert guests", async () => {
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Guest test",
        total_amount: 6000,
      })
      .select()
      .single();

    // Alice inserts a guest via admin
    await adminClient!.from("expense_guests").insert({
      expense_id: expense!.id,
      display_name: "Guest Dave",
      share_amount_cents: 2000,
    });

    const bobClient = authenticateAs(bob);

    // Bob can read
    const { data: guests } = await bobClient
      .from("expense_guests")
      .select("*")
      .eq("expense_id", expense!.id);

    expect(guests).toHaveLength(1);

    // Bob cannot insert
    const { error: insertError } = await bobClient
      .from("expense_guests")
      .insert({
        expense_id: expense!.id,
        display_name: "Guest Eve",
        share_amount_cents: 1000,
      });

    expect(insertError).not.toBeNull();
  });

  it("non-group-member cannot read guests", async () => {
    const outsider = await createTestUser();

    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Guest test",
        total_amount: 6000,
      })
      .select()
      .single();

    await adminClient!.from("expense_guests").insert({
      expense_id: expense!.id,
      display_name: "Guest Dave",
      share_amount_cents: 2000,
    });

    const outsiderClient = authenticateAs(outsider);
    const { data: guests } = await outsiderClient
      .from("expense_guests")
      .select("*")
      .eq("expense_id", expense!.id);

    expect(guests).toHaveLength(0);
  });
});

// ============================================================
// activate_expense with guests
// ============================================================

describe.skipIf(!isIntegrationTestReady)("activate_expense with guests", () => {
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

  it("activates an expense that includes guest shares in validation", async () => {
    // Total 9000: Alice=3000, Bob=3000, Guest=3000
    const { expenseId } = await createDraftExpenseWithGuests({
      groupId,
      creatorId: alice.id,
      title: "Dinner with guest",
      totalAmount: 9000,
      shares: [
        { userId: alice.id, amount: 3000 },
        { userId: bob.id, amount: 3000 },
      ],
      payers: [{ userId: alice.id, amount: 9000 }],
      guests: [{ displayName: "Guest Dave", amount: 3000 }],
    });

    const aliceClient = authenticateAs(alice);
    const { error } = await aliceClient.rpc("activate_expense", {
      p_expense_id: expenseId,
    });

    expect(error).toBeNull();

    // Verify expense is active
    const { data: expense } = await adminClient!
      .from("expenses")
      .select("status")
      .eq("id", expenseId)
      .single();
    expect(expense!.status).toBe("active");

    // Only registered participants get balances at activation
    const balances = await getBalances(groupId);
    const bobToAlice = findBalance(balances, bob.id, alice.id);
    expect(bobToAlice).toBe(3000); // Bob owes Alice 3000
    // No balance for guest yet (they haven't claimed)
    expect(balances).toHaveLength(1);
  });

  it("rejects activation when shares + guests don't sum to total", async () => {
    // Total 9000 but only 6000 accounted for
    const { expenseId } = await createDraftExpenseWithGuests({
      groupId,
      creatorId: alice.id,
      title: "Bad total",
      totalAmount: 9000,
      shares: [
        { userId: alice.id, amount: 3000 },
        { userId: bob.id, amount: 3000 },
      ],
      payers: [{ userId: alice.id, amount: 9000 }],
      guests: [], // Missing 3000
    });

    const aliceClient = authenticateAs(alice);
    const { error } = await aliceClient.rpc("activate_expense", {
      p_expense_id: expenseId,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("shares_mismatch");
  });
});

// ============================================================
// claim_guest_spot RPC
// ============================================================

describe.skipIf(!isIntegrationTestReady)("claim_guest_spot RPC", () => {
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

  it("claims a guest spot on a draft expense", async () => {
    const newUser = await createTestUser();

    const { expenseId, guestTokens } = await createDraftExpenseWithGuests({
      groupId,
      creatorId: alice.id,
      title: "Draft with guest",
      totalAmount: 6000,
      shares: [
        { userId: alice.id, amount: 3000 },
      ],
      payers: [{ userId: alice.id, amount: 6000 }],
      guests: [{ displayName: "New Person", amount: 3000 }],
    });

    const newUserClient = authenticateAs(newUser);
    const { data, error } = await newUserClient.rpc("claim_guest_spot", {
      p_claim_token: guestTokens[0],
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      expense_id: expenseId,
      share_amount_cents: 3000,
      already_claimed: false,
    });

    // Verify guest row is updated
    const { data: guest } = await adminClient!
      .from("expense_guests")
      .select("claimed_by, claimed_at")
      .eq("expense_id", expenseId)
      .single();

    expect(guest!.claimed_by).toBe(newUser.id);
    expect(guest!.claimed_at).not.toBeNull();

    // Verify expense_share was created
    const { data: shares } = await adminClient!
      .from("expense_shares")
      .select("user_id, share_amount_cents")
      .eq("expense_id", expenseId)
      .eq("user_id", newUser.id);

    expect(shares).toHaveLength(1);
    expect(shares![0].share_amount_cents).toBe(3000);

    // Verify user was added to group
    const { data: membership } = await adminClient!
      .from("group_members")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", newUser.id)
      .single();

    expect(membership!.status).toBe("accepted");
  });

  it("claims a guest spot on an active expense and updates balances", async () => {
    const newUser = await createTestUser();

    // Total 9000: Alice=3000, Bob=3000, Guest=3000. Alice pays all.
    const { expenseId, guestTokens } = await createDraftExpenseWithGuests({
      groupId,
      creatorId: alice.id,
      title: "Active with guest",
      totalAmount: 9000,
      shares: [
        { userId: alice.id, amount: 3000 },
        { userId: bob.id, amount: 3000 },
      ],
      payers: [{ userId: alice.id, amount: 9000 }],
      guests: [{ displayName: "New Person", amount: 3000 }],
    });

    // Activate the expense
    const aliceClient = authenticateAs(alice);
    const { error: activateError } = await aliceClient.rpc("activate_expense", {
      p_expense_id: expenseId,
    });
    expect(activateError).toBeNull();

    // Before claim: only Bob owes Alice 3000
    let balances = await getBalances(groupId);
    expect(balances).toHaveLength(1);
    expect(findBalance(balances, bob.id, alice.id)).toBe(3000);

    // New user claims the guest spot
    const newUserClient = authenticateAs(newUser);
    const { data, error } = await newUserClient.rpc("claim_guest_spot", {
      p_claim_token: guestTokens[0],
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      expense_id: expenseId,
      share_amount_cents: 3000,
      already_claimed: false,
    });

    // After claim: Bob owes Alice 3000, NewUser owes Alice 3000
    balances = await getBalances(groupId);
    expect(findBalance(balances, bob.id, alice.id)).toBe(3000);
    expect(findBalance(balances, newUser.id, alice.id)).toBe(3000);
  });

  it("computes correct balance deltas with multiple payers", async () => {
    const newUser = await createTestUser();

    // Total 10000: Alice=3000, Guest=7000
    // Alice pays 6000, Bob pays 4000
    const { expenseId, guestTokens } = await createDraftExpenseWithGuests({
      groupId,
      creatorId: alice.id,
      title: "Multi-payer guest",
      totalAmount: 10000,
      shares: [
        { userId: alice.id, amount: 3000 },
      ],
      payers: [
        { userId: alice.id, amount: 6000 },
        { userId: bob.id, amount: 4000 },
      ],
      guests: [{ displayName: "Big Spender", amount: 7000 }],
    });

    const aliceClient = authenticateAs(alice);
    await aliceClient.rpc("activate_expense", { p_expense_id: expenseId });

    // Before claim, Alice's share vs payers:
    // Alice consumed 3000, paid 6000 → net credit 3000
    // Alice consumed 3000 from Alice's 6000: ROUND(3000*6000/10000)=1800 (self-pay, no balance)
    // Alice consumed 3000 from Bob's 4000: ROUND(3000*4000/10000)=1200 → Alice owes Bob 1200
    let balances = await getBalances(groupId);
    expect(findBalance(balances, alice.id, bob.id)).toBe(1200);

    // Claim as new user
    const newUserClient = authenticateAs(newUser);
    await newUserClient.rpc("claim_guest_spot", {
      p_claim_token: guestTokens[0],
    });

    // After claim, newUser consumed 7000:
    // vs Alice (paid 6000): ROUND(7000*6000/10000) = 4200 → newUser owes Alice 4200
    // vs Bob (paid 4000):   ROUND(7000*4000/10000) = 2800 → newUser owes Bob 2800
    balances = await getBalances(groupId);
    expect(findBalance(balances, newUser.id, alice.id)).toBe(4200);
    expect(findBalance(balances, newUser.id, bob.id)).toBe(2800);
    // Alice still owes Bob 1200
    expect(findBalance(balances, alice.id, bob.id)).toBe(1200);
  });

  it("rejects claiming with invalid token", async () => {
    const newUser = await createTestUser();
    const newUserClient = authenticateAs(newUser);

    const { error } = await newUserClient.rpc("claim_guest_spot", {
      p_claim_token: "nonexistent_token_abc123",
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("INVALID_TOKEN");
  });

  it("rejects double-claim by different user", async () => {
    const [claimUser1, claimUser2] = await createTestUsers(2);

    const { guestTokens } = await createDraftExpenseWithGuests({
      groupId,
      creatorId: alice.id,
      title: "Double claim test",
      totalAmount: 6000,
      shares: [
        { userId: alice.id, amount: 3000 },
      ],
      payers: [{ userId: alice.id, amount: 6000 }],
      guests: [{ displayName: "Guest", amount: 3000 }],
    });

    // First claim succeeds
    const client1 = authenticateAs(claimUser1);
    const { error: err1 } = await client1.rpc("claim_guest_spot", {
      p_claim_token: guestTokens[0],
    });
    expect(err1).toBeNull();

    // Second claim by different user fails
    const client2 = authenticateAs(claimUser2);
    const { error: err2 } = await client2.rpc("claim_guest_spot", {
      p_claim_token: guestTokens[0],
    });
    expect(err2).not.toBeNull();
    expect(err2!.message).toContain("ALREADY_CLAIMED");
  });

  it("allows idempotent re-claim by same user", async () => {
    const newUser = await createTestUser();

    const { expenseId, guestTokens } = await createDraftExpenseWithGuests({
      groupId,
      creatorId: alice.id,
      title: "Idempotent claim",
      totalAmount: 6000,
      shares: [
        { userId: alice.id, amount: 3000 },
      ],
      payers: [{ userId: alice.id, amount: 6000 }],
      guests: [{ displayName: "Guest", amount: 3000 }],
    });

    const newUserClient = authenticateAs(newUser);

    // First claim
    const { error: err1 } = await newUserClient.rpc("claim_guest_spot", {
      p_claim_token: guestTokens[0],
    });
    expect(err1).toBeNull();

    // Re-claim by same user should succeed (idempotent)
    const { data, error: err2 } = await newUserClient.rpc("claim_guest_spot", {
      p_claim_token: guestTokens[0],
    });
    expect(err2).toBeNull();
    expect(data).toMatchObject({
      expense_id: expenseId,
      already_claimed: true,
    });
  });

  it("rejects claim if user already has a share in the expense", async () => {
    // Bob is already a registered participant
    const { guestTokens } = await createDraftExpenseWithGuests({
      groupId,
      creatorId: alice.id,
      title: "Existing participant",
      totalAmount: 6000,
      shares: [
        { userId: alice.id, amount: 2000 },
        { userId: bob.id, amount: 2000 },
      ],
      payers: [{ userId: alice.id, amount: 6000 }],
      guests: [{ displayName: "Extra spot", amount: 2000 }],
    });

    // Bob tries to claim the guest spot — should fail
    const bobClient = authenticateAs(bob);
    const { error } = await bobClient.rpc("claim_guest_spot", {
      p_claim_token: guestTokens[0],
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("ALREADY_PARTICIPANT");
  });

  it("concurrent claims — only one succeeds", async () => {
    const [claimUser1, claimUser2] = await createTestUsers(2);

    const { guestTokens } = await createDraftExpenseWithGuests({
      groupId,
      creatorId: alice.id,
      title: "Race condition claim",
      totalAmount: 6000,
      shares: [
        { userId: alice.id, amount: 3000 },
      ],
      payers: [{ userId: alice.id, amount: 6000 }],
      guests: [{ displayName: "Guest", amount: 3000 }],
    });

    const client1 = authenticateAs(claimUser1);
    const client2 = authenticateAs(claimUser2);

    const results = await Promise.allSettled([
      client1.rpc("claim_guest_spot", { p_claim_token: guestTokens[0] }),
      client2.rpc("claim_guest_spot", { p_claim_token: guestTokens[0] }),
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
  });

  it("claiming adds user to group with accepted status", async () => {
    // Create a user who is NOT in the group
    const outsider = await createTestUser();

    const { guestTokens } = await createDraftExpenseWithGuests({
      groupId,
      creatorId: alice.id,
      title: "Group join via claim",
      totalAmount: 6000,
      shares: [
        { userId: alice.id, amount: 3000 },
      ],
      payers: [{ userId: alice.id, amount: 6000 }],
      guests: [{ displayName: "Outsider", amount: 3000 }],
    });

    const outsiderClient = authenticateAs(outsider);
    const { error } = await outsiderClient.rpc("claim_guest_spot", {
      p_claim_token: guestTokens[0],
    });
    expect(error).toBeNull();

    // Verify group membership
    const { data: membership } = await adminClient!
      .from("group_members")
      .select("status, accepted_at")
      .eq("group_id", groupId)
      .eq("user_id", outsider.id)
      .single();

    expect(membership).not.toBeNull();
    expect(membership!.status).toBe("accepted");
    expect(membership!.accepted_at).not.toBeNull();
  });

  it("claiming upgrades invited member to accepted", async () => {
    // Create a user who is invited but not yet accepted
    const invitedUser = await createTestUser();

    await adminClient!.from("group_members").insert({
      group_id: groupId,
      user_id: invitedUser.id,
      status: "invited",
      invited_by: alice.id,
    });

    const { guestTokens } = await createDraftExpenseWithGuests({
      groupId,
      creatorId: alice.id,
      title: "Invited user claim",
      totalAmount: 6000,
      shares: [
        { userId: alice.id, amount: 3000 },
      ],
      payers: [{ userId: alice.id, amount: 6000 }],
      guests: [{ displayName: "Invited Person", amount: 3000 }],
    });

    const invitedClient = authenticateAs(invitedUser);
    const { error } = await invitedClient.rpc("claim_guest_spot", {
      p_claim_token: guestTokens[0],
    });
    expect(error).toBeNull();

    // Verify upgraded to accepted
    const { data: membership } = await adminClient!
      .from("group_members")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", invitedUser.id)
      .single();

    expect(membership!.status).toBe("accepted");
  });
});
