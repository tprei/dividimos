import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  createTestUsers,
  createTestGroupWithMembers,
  createAndActivateExpense,
  settleDebt,
  getBalanceBetween,
  authenticateAs,
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
