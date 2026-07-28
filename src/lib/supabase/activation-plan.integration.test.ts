import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  adminClient,
  isIntegrationTestReady,
  registerTestUser,
} from "@/test/integration-setup";
import {
  createTestGroupWithMembers,
  createTestUsers,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";

// Issue #468 activation rewrite: the persisted allocation plan must
// produce EXACT integer per-user incidence. The canonical regression
// is shares [1,1,4] / payers [1,4,1] (total 6): the old per-pair
// ROUND() + residual-reassignment body produced incidence [+1,-5,+4];
// the new body must produce [0,-3,+3] with a single edge.

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

type EntityRow = {
  participant_index: number;
  entity_kind: "user" | "guest";
  user_id: string | null;
  guest_id: string | null;
  share_amount_cents: number;
  payer_amount_cents: number;
  net_amount_cents: number;
};

type EdgeRow = {
  allocation_index: number;
  debtor_index: number;
  creditor_index: number;
  amount_cents: number;
  applied_to_user_id: string | null;
};

describe.skipIf(!canRun)("activate_expense allocation plan (#468)", () => {
  let pg: Client;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let groupId: string;
  let expenseId: string;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();
  });

  afterAll(async () => {
    if (expenseId && adminClient) {
      // Cascades to entities, plan, edges, shares, payers.
      await adminClient.from("expenses").delete().eq("id", expenseId);
    }
    if (pg) await pg.end();
  });

  async function activateFixture(): Promise<void> {
    [alice, bob, carol] = await createTestUsers(3);
    for (const u of [alice, bob, carol]) registerTestUser(u.id);

    const group = await createTestGroupWithMembers(alice, [bob, carol]);
    groupId = group.id;

    // Draft expense with exact integer shares [1,1,4] and payers [1,4,1].
    const { data: expense, error: expError } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "#468 fixture [1,1,4]/[1,4,1]",
        expense_type: "single_amount",
        total_amount: 6,
        service_fee_percent: 0,
        fixed_fees: 0,
        status: "draft",
      })
      .select("id")
      .single();
    if (expError || !expense) throw new Error(`create expense: ${expError?.message}`);
    expenseId = expense.id;

    const sharesRes = await adminClient!.from("expense_shares").insert([
      { expense_id: expenseId, user_id: alice.id, share_amount_cents: 1 },
      { expense_id: expenseId, user_id: bob.id, share_amount_cents: 1 },
      { expense_id: expenseId, user_id: carol.id, share_amount_cents: 4 },
    ]);
    if (sharesRes.error) throw new Error(`shares: ${sharesRes.error.message}`);

    const payersRes = await adminClient!.from("expense_payers").insert([
      { expense_id: expenseId, user_id: alice.id, amount_cents: 1 },
      { expense_id: expenseId, user_id: bob.id, amount_cents: 4 },
      { expense_id: expenseId, user_id: carol.id, amount_cents: 1 },
    ]);
    if (payersRes.error) throw new Error(`payers: ${payersRes.error.message}`);

    const creatorClient = authenticateAs(alice);
    const { error: rpcError } = await creatorClient.rpc("activate_expense", {
      p_expense_id: expenseId,
    });
    if (rpcError) throw new Error(`activate: ${rpcError.message}`);
  }

  it("produces exact incidence [0,-3,+3] for shares [1,1,4] / payers [1,4,1]", async () => {
    await activateFixture();

    // Per-user net incidence from balances rows:
    //   incidence_X = sum(amount where user_a=X) - sum(amount where user_b=X)
    // Positive = X is a net debtor; negative = X is a net creditor.
    // This must equal (share - paid) for every user exactly.
    const { rows: balRows } = await pg.query<{
      user_a: string;
      user_b: string;
      amount_cents: number;
    }>(
      "select user_a, user_b, amount_cents from balances where group_id = $1",
      [groupId],
    );
    const incidence: Record<string, number> = {
      [alice.id]: 0,
      [bob.id]: 0,
      [carol.id]: 0,
    };
    for (const r of balRows) {
      if (r.user_a in incidence) incidence[r.user_a] += r.amount_cents;
      if (r.user_b in incidence) incidence[r.user_b] -= r.amount_cents;
    }

    // [1,1,4]/[1,4,1] → alice net 1-1=0, bob net 1-4=-3, carol net 4-1=+3.
    expect(incidence[alice.id]).toBe(0);
    expect(incidence[bob.id]).toBe(-3);
    expect(incidence[carol.id]).toBe(3);

    // Cross-check via the signed balance helper convention.
    const balCarolBob = await signedNet(carol.id, bob.id);
    // carol (net +3) owes bob (net -3) exactly 3: +amount = carol owes bob.
    expect(balCarolBob).toBe(3);
    // alice touches no balance row (net 0).
    expect(await signedNet(alice.id, bob.id)).toBe(0);
    expect(await signedNet(alice.id, carol.id)).toBe(0);
  });

  it("persists exactly one edge with carol(debtor)->bob(creditor), amount 3", async () => {
    const { rows: edges } = await pg.query<EdgeRow>(
      `select allocation_index, debtor_index, creditor_index, amount_cents,
              applied_to_user_id
         from expense_balance_allocations
        where expense_id = $1
        order by allocation_index`,
      [expenseId],
    );
    expect(edges).toHaveLength(1);

    const { rows: entities } = await pg.query<EntityRow>(
      `select participant_index, entity_kind, user_id, guest_id,
              share_amount_cents, payer_amount_cents, net_amount_cents
         from expense_allocation_entities
        where expense_id = $1
        order by participant_index`,
      [expenseId],
    );

    // carol is the only debtor (net +3); bob the only creditor (net -3).
    const carolEntity = entities.find((e) => e.user_id === carol.id)!;
    const bobEntity = entities.find((e) => e.user_id === bob.id)!;
    expect(carolEntity).toBeDefined();
    expect(bobEntity).toBeDefined();
    expect(carolEntity.net_amount_cents).toBe(3);
    expect(bobEntity.net_amount_cents).toBe(-3);

    expect(edges[0].debtor_index).toBe(carolEntity.participant_index);
    expect(edges[0].creditor_index).toBe(bobEntity.participant_index);
    expect(edges[0].amount_cents).toBe(3);
    expect(edges[0].allocation_index).toBe(1);
    // User-debtor edge is applied at activation.
    expect(edges[0].applied_to_user_id).toBe(carol.id);
  });

  it("writes the immutable plan header with the correct counts", async () => {
    const { rows: plans } = await pg.query<{
      algorithm_version: number;
      total_cents: number;
      entity_count: number;
      edge_count: number;
      source_digest: string;
    }>(
      `select algorithm_version, total_cents, entity_count, edge_count,
              source_digest
         from expense_balance_allocation_plans
        where expense_id = $1`,
      [expenseId],
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].algorithm_version).toBe(1);
    expect(plans[0].total_cents).toBe(6);
    expect(plans[0].entity_count).toBe(3);
    expect(plans[0].edge_count).toBe(1);
    expect(plans[0].source_digest).toMatch(/^[0-9a-f]{32}$/);
  });

  it("rejects re-activation with invalid_status (and leaves the plan intact)", async () => {
    const creatorClient = authenticateAs(alice);
    const { error } = await creatorClient.rpc("activate_expense", {
      p_expense_id: expenseId,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("invalid_status");

    // Plan header must still be exactly one (no duplicate / corruption).
    const { rows } = await pg.query(
      "select count(*)::int as n from expense_balance_allocation_plans where expense_id = $1",
      [expenseId],
    );
    expect(rows[0].n).toBe(1);

    // Per-user incidence unchanged.
    const balCarolBob = await signedNet(carol.id, bob.id);
    expect(balCarolBob).toBe(3);
  });

  // signedNet(x, y) = +amount means x owes y; -amount means y owes x.
  async function signedNet(userX: string, userY: string): Promise<number> {
    const [a, b] = userX < userY ? [userX, userY] : [userY, userX];
    const { rows } = await pg.query<{ amount_cents: number }>(
      "select amount_cents from balances where group_id=$1 and user_a=$2 and user_b=$3",
      [groupId, a, b],
    );
    if (rows.length === 0) return 0;
    return (userX < userY ? rows[0].amount_cents : -rows[0].amount_cents) || 0;
  }
});
