import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  adminClient,
  isIntegrationTestReady,
  registerTestUser,
} from "@/test/integration-setup";
import {
  createTestUsers,
  createTestGroupWithMembers,
  createAndActivateExpense,
  settleDebt,
  getBalanceBetween,
  authenticateAs,
  issueGuestClaimToken,
  deleteTestExpenses,
  type TestUser,
} from "@/test/integration-helpers";

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

/**
 * Seed a directed debt edge "fromUser owes toUser amountCents" by writing the
 * canonical (user_a < user_b) row directly. Used instead of expense activation
 * so these tests assert settlement-time normalization regardless of whether
 * activation has already normalized (which later PRs in the stack make true).
 */
async function seedBalance(
  groupId: string,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
): Promise<void> {
  const [userA, userB] =
    fromUserId < toUserId ? [fromUserId, toUserId] : [toUserId, fromUserId];
  const amount =
    fromUserId < toUserId ? amountCents : -amountCents;

  const { error } = await adminClient!.from("balances").upsert(
    {
      group_id: groupId,
      user_a: userA,
      user_b: userB,
      amount_cents: amount,
    },
    { onConflict: "group_id,user_a,user_b" },
  );
  if (error) throw new Error(`seedBalance failed: ${error.message}`);
}

/** Sum of every nonzero balance row touching userId in the group. */
async function netPosition(
  groupId: string,
  userId: string,
): Promise<number> {
  const { data, error } = await adminClient!
    .from("balances")
    .select("user_a, user_b, amount_cents")
    .eq("group_id", groupId)
    .neq("amount_cents", 0);
  if (error) throw new Error(`netPosition query failed: ${error.message}`);

  let net = 0;
  for (const row of data ?? []) {
    if (row.user_a === userId) net -= row.amount_cents;
    if (row.user_b === userId) net += row.amount_cents;
  }
  return net;
}

/** Count confirmed settlement rows for the group. */
async function countSettlements(groupId: string): Promise<number> {
  const { count, error } = await adminClient!
    .from("settlements")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId);
  if (error) throw new Error(`countSettlements failed: ${error.message}`);
  return count ?? 0;
}

async function hasOutstandingBalance(
  caller: TestUser,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const client = authenticateAs(caller);
  const { data, error } = await client.rpc("has_outstanding_balance", {
    p_group_id: groupId,
    p_user_id: userId,
  });
  if (error) throw new Error(`has_outstanding_balance failed: ${error.message}`);
  return Boolean(data);
}

describe.skipIf(!canRun)("minimize_group_balances on settlement (#592)", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser;
  let groupId: string;
  let pg: Client;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();
  });

  afterAll(async () => {
    if (pg) {
      await pg.query(
        "select financial_internal.set_financial_maintenance(false)",
      );
      await pg.end();
    }
  });

  afterEach(async () => {
    await pg.query(
      "select financial_internal.set_financial_maintenance(false)",
    );
  });

  beforeEach(async () => {
    [alice, bob, carol, dave] = await createTestUsers(4);
    const group = await createTestGroupWithMembers(alice, [bob, carol, dave]);
    groupId = group.id;
  });

  // -------------------------------------------------------------------
  // Chain collapse on settlement
  // -------------------------------------------------------------------
  it("settling a simplified edge consumes the underlying chain", async () => {
    await seedBalance(groupId, alice.id, bob.id, 10000);
    await seedBalance(groupId, bob.id, carol.id, 10000);

    await settleDebt({
      caller: alice,
      groupId,
      fromUserId: alice.id,
      toUserId: carol.id,
      amountCents: 10000,
    });

    expect(await getBalanceBetween(groupId, alice.id, bob.id)).toBe(0);
    expect(await getBalanceBetween(groupId, bob.id, carol.id)).toBe(0);
    expect(await getBalanceBetween(groupId, alice.id, carol.id)).toBe(0);
    expect(await countSettlements(groupId)).toBe(1);
    expect(await hasOutstandingBalance(alice, groupId, alice.id)).toBe(false);
    expect(await hasOutstandingBalance(alice, groupId, bob.id)).toBe(false);
    expect(await hasOutstandingBalance(alice, groupId, carol.id)).toBe(false);
  });

  // -------------------------------------------------------------------
  // Partial settlement re-pairs into the single remaining net edge
  // -------------------------------------------------------------------
  it("partial simplified settlement preserves the exact remaining net", async () => {
    await seedBalance(groupId, alice.id, bob.id, 10000);
    await seedBalance(groupId, bob.id, carol.id, 10000);

    await settleDebt({
      caller: alice,
      groupId,
      fromUserId: alice.id,
      toUserId: carol.id,
      amountCents: 4000,
    });

    expect(await getBalanceBetween(groupId, alice.id, carol.id)).toBe(6000);
    expect(await getBalanceBetween(groupId, alice.id, bob.id)).toBe(0);
    expect(await getBalanceBetween(groupId, bob.id, carol.id)).toBe(0);
    expect(await countSettlements(groupId)).toBe(1);
  });

  // -------------------------------------------------------------------
  // Direct pair unchanged (today's over-payment semantics preserved)
  // -------------------------------------------------------------------
  it("direct-pair partial and over-payment keep today's semantics", async () => {
    await seedBalance(groupId, alice.id, bob.id, 10000);

    // Partial: 10000 -> 6000
    await settleDebt({
      caller: alice,
      groupId,
      fromUserId: alice.id,
      toUserId: bob.id,
      amountCents: 4000,
    });
    expect(await getBalanceBetween(groupId, alice.id, bob.id)).toBe(6000);

    // Over-payment: 6000 - 10000 = -4000 -> B owes A 4000
    await settleDebt({
      caller: alice,
      groupId,
      fromUserId: alice.id,
      toUserId: bob.id,
      amountCents: 10000,
    });
    expect(await getBalanceBetween(groupId, alice.id, bob.id)).toBe(-4000);
  });

  // -------------------------------------------------------------------
  // Re-pairing after settlement keeps every net position
  // -------------------------------------------------------------------
  it("re-pairs debtors to creditors while preserving nets", async () => {
    // Two debtors (alice, bob) both owe carol.
    await seedBalance(groupId, alice.id, carol.id, 10000);
    await seedBalance(groupId, bob.id, carol.id, 10000);

    // Alice over-pays carol by 5000, taking carol's net from +20000 to +5000.
    await settleDebt({
      caller: alice,
      groupId,
      fromUserId: alice.id,
      toUserId: carol.id,
      amountCents: 15000,
    });

    // Nets: alice +5000 (creditor), bob -10000 (debtor), carol +5000 (creditor).
    // Minimized pairing: bob owes carol 5000 and bob owes alice 5000.
    expect(await netPosition(groupId, alice.id)).toBe(5000);
    expect(await netPosition(groupId, bob.id)).toBe(-10000);
    expect(await netPosition(groupId, carol.id)).toBe(5000);
    expect(await getBalanceBetween(groupId, bob.id, alice.id)).toBe(5000);
    expect(await getBalanceBetween(groupId, bob.id, carol.id)).toBe(5000);
  });

  // -------------------------------------------------------------------
  // Idempotence
  // -------------------------------------------------------------------
  it("minimize_group_balances is idempotent", async () => {
    await seedBalance(groupId, alice.id, bob.id, 7000);
    await seedBalance(groupId, bob.id, carol.id, 4000);
    await seedBalance(groupId, carol.id, alice.id, 2000);

    await pg.query("begin");
    await pg.query("select public.minimize_group_balances($1::uuid)", [
      groupId,
    ]);
    await pg.query("commit");

    const first = await adminClient!
      .from("balances")
      .select("user_a, user_b, amount_cents")
      .eq("group_id", groupId)
      .order("user_a")
      .order("user_b");

    await pg.query("begin");
    await pg.query("select public.minimize_group_balances($1::uuid)", [
      groupId,
    ]);
    await pg.query("commit");

    const second = await adminClient!
      .from("balances")
      .select("user_a, user_b, amount_cents")
      .eq("group_id", groupId)
      .order("user_a")
      .order("user_b");

    expect(second.data).toEqual(first.data);
  });

  // -------------------------------------------------------------------
  // Exit after full settlement
  // -------------------------------------------------------------------
  it("a settled intermediary can leave the group", async () => {
    await seedBalance(groupId, alice.id, bob.id, 10000);
    await seedBalance(groupId, bob.id, carol.id, 10000);

    await settleDebt({
      caller: alice,
      groupId,
      fromUserId: alice.id,
      toUserId: carol.id,
      amountCents: 10000,
    });

    const bobClient = authenticateAs(bob);
    const { error } = await bobClient.rpc("leave_group", { p_group_id: groupId });
    expect(error).toBeNull();
  });

  // -------------------------------------------------------------------
  // Replay does not re-mutate balances
  // -------------------------------------------------------------------
  it("replay returns was_replay=true and mutates balances once", async () => {
    await seedBalance(groupId, alice.id, bob.id, 5000);

    const operationId = globalThis.crypto.randomUUID();
    const input = {
      p_allocations: [
        {
          group_id: groupId,
          from_user_id: alice.id,
          to_user_id: bob.id,
          amount_cents: 3000,
        },
      ],
      p_operation_id: operationId,
    };

    const aliceClient = authenticateAs(alice);
    const first = await aliceClient.rpc("record_settlements", input);
    expect(first.error).toBeNull();
    expect(first.data![0].was_replay).toBe(false);

    const afterFirst = await getBalanceBetween(groupId, alice.id, bob.id);
    expect(afterFirst).toBe(2000);

    const replay = await aliceClient.rpc("record_settlements", input);
    expect(replay.data![0].was_replay).toBe(true);

    const afterReplay = await getBalanceBetween(groupId, alice.id, bob.id);
    expect(afterReplay).toBe(2000);
  });

  // -------------------------------------------------------------------
  // Maintenance gate
  // -------------------------------------------------------------------
  it("rejects with PST09 while financial maintenance is active", async () => {
    await seedBalance(groupId, alice.id, bob.id, 5000);

    await pg.query(
      "select financial_internal.set_financial_maintenance(true)",
    );

    const aliceClient = authenticateAs(alice);
    const { error } = await aliceClient.rpc("record_settlements", {
      p_allocations: [
        {
          group_id: groupId,
          from_user_id: alice.id,
          to_user_id: bob.id,
          amount_cents: 2000,
        },
      ],
      p_operation_id: globalThis.crypto.randomUUID(),
    });

    expect(error).toBeTruthy();
    expect(error!.code).toBe("PST09");
  });
});

describe.skipIf(!canRun)(
  "minimize_group_balances on expense activation (#592)",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;
    let groupId: string;

    beforeEach(async () => {
      [alice, bob, carol] = await createTestUsers(3);
      const group = await createTestGroupWithMembers(alice, [bob, carol]);
      groupId = group.id;
    });

    // -----------------------------------------------------------------
    // Chain collapse at activation (the reported bug dies here)
    // -----------------------------------------------------------------
    it("two chained activations collapse to a single net edge", async () => {
      // Expense 1: Bob pays, Alice consumes -> Alice owes Bob.
      await createAndActivateExpense({
        creator: alice,
        groupId,
        shares: [{ userId: alice.id, amount: 10000 }],
        payers: [{ userId: bob.id, amount: 10000 }],
      });
      // Expense 2: Carol pays, Bob consumes -> Bob owes Carol.
      await createAndActivateExpense({
        creator: bob,
        groupId,
        shares: [{ userId: bob.id, amount: 10000 }],
        payers: [{ userId: carol.id, amount: 10000 }],
      });

      expect(await getBalanceBetween(groupId, alice.id, bob.id)).toBe(0);
      expect(await getBalanceBetween(groupId, bob.id, carol.id)).toBe(0);
      expect(await getBalanceBetween(groupId, alice.id, carol.id)).toBe(10000);
      expect(await netPosition(groupId, alice.id)).toBe(-10000);
      expect(await netPosition(groupId, bob.id)).toBe(0);
      expect(await netPosition(groupId, carol.id)).toBe(10000);
    });

    // -----------------------------------------------------------------
    // Single-payer star graph is already minimal (no re-pairing)
    // -----------------------------------------------------------------
    it("single-payer star graph keeps its pairwise rows unchanged", async () => {
      await createAndActivateExpense({
        creator: alice,
        groupId,
        shares: [
          { userId: alice.id, amount: 2000 },
          { userId: bob.id, amount: 2000 },
          { userId: carol.id, amount: 2000 },
        ],
        payers: [{ userId: alice.id, amount: 6000 }],
      });

      // Bob and Carol each owe Alice 2000; Alice's own consumption nets out.
      expect(await getBalanceBetween(groupId, bob.id, alice.id)).toBe(2000);
      expect(await getBalanceBetween(groupId, carol.id, alice.id)).toBe(2000);
    });

    // -----------------------------------------------------------------
    // Rotating-payer cycle zeroes every net and unblocks exit
    // -----------------------------------------------------------------
    it("a three-expense rotating-payer cycle collapses to zero", async () => {
      await createAndActivateExpense({
        creator: bob,
        groupId,
        shares: [{ userId: bob.id, amount: 10000 }],
        payers: [{ userId: alice.id, amount: 10000 }],
      });
      await createAndActivateExpense({
        creator: carol,
        groupId,
        shares: [{ userId: carol.id, amount: 10000 }],
        payers: [{ userId: bob.id, amount: 10000 }],
      });
      await createAndActivateExpense({
        creator: alice,
        groupId,
        shares: [{ userId: alice.id, amount: 10000 }],
        payers: [{ userId: carol.id, amount: 10000 }],
      });

      expect(await netPosition(groupId, alice.id)).toBe(0);
      expect(await netPosition(groupId, bob.id)).toBe(0);
      expect(await netPosition(groupId, carol.id)).toBe(0);
      expect(await getBalanceBetween(groupId, alice.id, bob.id)).toBe(0);
      expect(await getBalanceBetween(groupId, bob.id, carol.id)).toBe(0);
      expect(await getBalanceBetween(groupId, alice.id, carol.id)).toBe(0);

      const bobClient = authenticateAs(bob);
      const { error } = await bobClient.rpc("leave_group", {
        p_group_id: groupId,
      });
      expect(error).toBeNull();
    });
  },
);

/**
 * Build an active expense whose guest owes `debtCents` to the creator, and
 * return the claim token a registered user can redeem. Mirrors the fixture in
 * claim-guest-spot-dm.integration.test.ts but for a regular multi-member group.
 */
async function buildGuestClaimFixture(
  creator: TestUser,
  groupId: string,
  debtCents: number,
): Promise<{ expenseId: string; guestId: string; claimToken: string }> {
  const creatorClient = authenticateAs(creator);
  const { data: saveResult, error: saveError } = await creatorClient.rpc(
    "save_expense_draft_graph",
    {
      p_expense: {
        group_id: groupId,
        title: "minimize-on-claim fixture",
        merchant_name: null,
        expense_type: "single_amount",
        total_amount: debtCents,
        service_fee_basis_points: 0,
        fixed_fees: 0,
      },
      p_items: [],
      p_shares: [{ user_id: creator.id, share_amount_cents: 0 }],
      p_payers: [{ user_id: creator.id, amount_cents: debtCents }],
      p_guests: [{ local_id: "g1", display_name: "Future claimant" }],
      p_guest_shares: [{ local_id: "g1", share_amount_cents: debtCents }],
      p_participant_order: [],
      p_expected_graph_revision: 0,
      p_save_operation_id: globalThis.crypto.randomUUID(),
    },
  );
  if (saveError || !saveResult) {
    throw new Error(`create guest expense: ${saveError?.message}`);
  }
  const saved = saveResult as { id: string; graph_revision: number };

  const { data: guest, error: guestError } = await adminClient!
    .from("expense_guests")
    .select("id")
    .eq("expense_id", saved.id)
    .single();
  if (guestError || !guest) {
    throw new Error(`load guest: ${guestError?.message}`);
  }

  const { error: rpcError } = await creatorClient.rpc("activate_saved_expense", {
    p_expense_id: saved.id,
    p_expected_graph_revision: saved.graph_revision,
  });
  if (rpcError) throw new Error(`activate: ${rpcError.message}`);

  const claimToken = await issueGuestClaimToken(creator, guest.id);
  return { expenseId: saved.id, guestId: guest.id, claimToken };
}

describe.skipIf(!canRun)(
  "minimize_group_balances on guest claim and confirm (#592)",
  () => {
    let pg: Client;

    beforeAll(async () => {
      pg = new Client(databaseUrl!);
      await pg.connect();
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    // -----------------------------------------------------------------
    // claim_guest_spot re-pairs the graph after applying the guest debt
    // -----------------------------------------------------------------
    it("guest claim minimizes the resulting graph", async () => {
      const [creator, member, claimer] = await createTestUsers(3);
      registerTestUser(creator.id);
      registerTestUser(member.id);
      registerTestUser(claimer.id);
      const group = await createTestGroupWithMembers(creator, [member]);
      const groupId = group.id;

      // Pre-seed creator owes member 5000.
      await seedBalance(groupId, creator.id, member.id, 5000);

      // Guest expense: guest owes creator 2000.
      const fixture = await buildGuestClaimFixture(creator, groupId, 2000);

      // Claimer (a registered non-member) redeems the guest spot, taking on
      // the guest's 2000 debt to the creator.
      const claimerClient = authenticateAs(claimer);
      const { error } = await claimerClient.rpc("claim_guest_spot", {
        p_claim_token: fixture.claimToken,
      });
      expect(error).toBeNull();

      // Nets: creator -5000 + 2000 = -3000, member +5000, claimer -2000.
      // Minimized pairing: creator -> member 3000, claimer -> member 2000.
      expect(await netPosition(groupId, creator.id)).toBe(-3000);
      expect(await netPosition(groupId, member.id)).toBe(5000);
      expect(await netPosition(groupId, claimer.id)).toBe(-2000);
      expect(await getBalanceBetween(groupId, creator.id, member.id)).toBe(3000);
      expect(await getBalanceBetween(groupId, claimer.id, member.id)).toBe(2000);
      expect(await getBalanceBetween(groupId, claimer.id, creator.id)).toBe(0);

      await deleteTestExpenses(pg, [fixture.expenseId]);
    });

    // -----------------------------------------------------------------
    // confirm_settlement re-pairs the graph after applying the delta
    // -----------------------------------------------------------------
    it("settlement confirmation minimizes the resulting graph", async () => {
      const [alice, bob, carol] = await createTestUsers(3);
      const group = await createTestGroupWithMembers(alice, [bob, carol]);
      const groupId = group.id;

      // Seed a chain: alice owes bob 5000, bob owes carol 5000.
      await seedBalance(groupId, alice.id, bob.id, 5000);
      await seedBalance(groupId, bob.id, carol.id, 5000);

      // Seed a pending settlement: alice pays bob 2000 (reduces her debt).
      const { data: settlement } = await adminClient!
        .from("settlements")
        .insert({
          group_id: groupId,
          from_user_id: alice.id,
          to_user_id: bob.id,
          amount_cents: 2000,
        })
        .select()
        .single();

      // Bob confirms.
      const bobClient = authenticateAs(bob);
      const { error } = await bobClient.rpc("confirm_settlement", {
        p_settlement_id: settlement!.id,
      });
      expect(error).toBeNull();

      // The pair delta reduces alice->bob by 2000 (5000 -> 3000), then
      // minimize re-pairs the chain: nets alice -3000, bob -2000,
      // carol +5000 -> alice->carol 3000, bob->carol 2000.
      expect(await netPosition(groupId, alice.id)).toBe(-3000);
      expect(await netPosition(groupId, bob.id)).toBe(-2000);
      expect(await netPosition(groupId, carol.id)).toBe(5000);
      expect(await getBalanceBetween(groupId, alice.id, carol.id)).toBe(3000);
      expect(await getBalanceBetween(groupId, bob.id, carol.id)).toBe(2000);
      expect(await getBalanceBetween(groupId, alice.id, bob.id)).toBe(0);
    });
  },
);
