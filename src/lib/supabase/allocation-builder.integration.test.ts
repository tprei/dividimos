import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { createTestGroup, createTestUser, authenticateAs } from "@/test/integration-helpers";

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

type Edge = { allocation_index: number; debtor_index: number; creditor_index: number; amount_cents: number };

describe.skipIf(!canRun)("build_expense_allocation_plan_edges (#468)", () => {
  let pg: Client;
  let expenseId: string;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();
    const creator = await createTestUser();
    const group = await createTestGroup(creator.id);
    // Create via save_expense_draft_graph (guard rejects raw INSERT).
    const client = authenticateAs(creator);
    const { data, error } = await client.rpc("save_expense_draft_graph", {
      p_expense: { group_id: group.id, title: "builder-468", merchant_name: null,
        expense_type: "single_amount", total_amount: 0, service_fee_basis_points: 0, fixed_fees: 0 },
      p_items: [], p_shares: [], p_payers: [],
      p_guests: [], p_guest_shares: [], p_participant_order: [],
      p_expected_graph_revision: 0, p_save_operation_id: crypto.randomUUID(),
    });
    if (error || !data) throw new Error("Failed to create fixture: " + error?.message);
    expenseId = (data as { id: string }).id;
  });

  afterAll(async () => {
    if (expenseId) {
      try {
        await pg.query("BEGIN");
        await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [[expenseId]]);
        await pg.query("delete from expenses where id = $1", [expenseId]);
        await pg.query("COMMIT");
      } catch { /* best-effort */ }
    }
    if (pg) await pg.end();
  });

  /**
   * Seeds allocation entities and calls build_expense_allocation_plan_edges
   * within a single transaction that ROLLBACKs. This avoids the guard's
   * DEFERRABLE finalizer (validate_graph_mode rejects drafts with
   * allocation entities) while still exercising the function under test.
   */
  async function seedAndEdges(
    rows: Array<{ pi: number; share: number; paid: number }>,
  ): Promise<Edge[]> {
    await pg.query("BEGIN");
    try {
      await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [[expenseId]]);
      await pg.query("delete from expense_allocation_entities where expense_id = $1", [expenseId]);
      const values: string[] = [];
      const params: unknown[] = [expenseId];
      rows.forEach((r, i) => {
        params.push(r.pi, crypto.randomUUID(), r.share, r.paid, r.share - r.paid);
        const base = 2 + i * 5;
        values.push(`($1, $${base}, 'user', $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      });
      await pg.query(
        `insert into expense_allocation_entities
           (expense_id, participant_index, entity_kind, user_id, share_amount_cents, payer_amount_cents, net_amount_cents)
         values ${values.join(",")}`,
        params,
      );
      const { rows: edgeRows } = await pg.query<Edge>(
        "select * from build_expense_allocation_plan_edges($1) order by allocation_index",
        [expenseId],
      );
      return edgeRows;
    } finally {
      await pg.query("ROLLBACK").catch(() => {});
    }
  }

  it("produces exact incidence [0,-3,+3] for shares [1,1,4] payers [1,4,1]", async () => {
    const result = await seedAndEdges([
      { pi: 1, share: 1, paid: 1 },
      { pi: 2, share: 1, paid: 4 },
      { pi: 3, share: 4, paid: 1 },
    ]);
    expect(result).toEqual([
      { allocation_index: 1, debtor_index: 3, creditor_index: 2, amount_cents: 3 },
    ]);
  });

  it("matches multiple debtors/creditors with exact incidence and the sparse bound", async () => {
    const result = await seedAndEdges([
      { pi: 1, share: 5, paid: 0 },
      { pi: 2, share: 3, paid: 0 },
      { pi: 3, share: 0, paid: 4 },
      { pi: 4, share: 0, paid: 4 },
    ]);
    const total = result.reduce((s, e) => s + e.amount_cents, 0);
    expect(total).toBe(8);
    const inc: Record<number, number> = {};
    for (const e of result) {
      inc[e.debtor_index] = (inc[e.debtor_index] ?? 0) - e.amount_cents;
      inc[e.creditor_index] = (inc[e.creditor_index] ?? 0) + e.amount_cents;
    }
    expect(inc[1]).toBe(-5);
    expect(inc[2]).toBe(-3);
    expect(inc[3]).toBe(4);
    expect(inc[4]).toBe(4);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("emits no edges when every net is zero", async () => {
    const result = await seedAndEdges([
      { pi: 1, share: 5, paid: 5 },
      { pi: 2, share: 3, paid: 3 },
    ]);
    expect(result).toEqual([]);
  });

  it("emits a single edge for one debtor/one creditor", async () => {
    const result = await seedAndEdges([
      { pi: 1, share: 7, paid: 0 },
      { pi: 2, share: 0, paid: 7 },
    ]);
    expect(result).toEqual([
      { allocation_index: 1, debtor_index: 1, creditor_index: 2, amount_cents: 7 },
    ]);
  });
});
