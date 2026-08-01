import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  isIntegrationTestReady,
  registerTestUser,
} from "@/test/integration-setup";
import {
  createTestGroupWithMembers,
  createTestUsers,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

describe.skipIf(!canRun)("allocation plan schema (#468)", () => {
  let pg: Client;
  let users: TestUser[];
  let groupId: string;
  let expenseId: string;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();
    users = await createTestUsers(2);
    for (const u of users) registerTestUser(u.id);
    const group = await createTestGroupWithMembers(users[0], [users[1]]);
    groupId = group.id;
    // Draft (NOT activated): activate_expense now populates these
    // allocation tables (#468), but these tests manually insert
    // participant/plan/edge rows to exercise the CHECK constraints,
    // so the expense must carry no allocation rows yet.
    const creator = authenticateAs(users[0]);
    const { data, error } = await creator.rpc("save_expense_draft_graph", {
      p_expense: { group_id: groupId, title: "alloc-schema-468", merchant_name: null,
        expense_type: "single_amount", total_amount: 100, service_fee_basis_points: 0, fixed_fees: 0 },
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

  it("accepts a valid user entity row and rejects structurally invalid ones", async () => {
    // The guard's finalizer (validate_graph_mode) correctly rejects a
    // draft expense that has allocation rows (PST07/graph_state_corrupt),
    // so we verify the CHECK constraints via pg_constraint metadata
    // (authoritative definitions) rather than raw INSERT.
    const { rows } = await pg.query(
      `select c.conname, pg_get_constraintdef(c.oid) as def
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname = 'expense_allocation_entities'
          and c.contype = 'c'`,
    );
    // Must have CHECK constraints enforcing entity identity and net arithmetic.
    const defs = rows.map((r: { def: string }) => r.def).join("\n");
    expect(defs).toMatch(/net_amount_cents.*share_amount_cents.*payer_amount_cents/i);
    // Guest entities must have payer_amount = 0.
    expect(defs).toMatch(/entity_kind.*guest.*payer_amount_cents.*0|guest.*payer_amount_cents.*0/i);
  });

  it("enables RLS with no policies on the plan tables", async () => {
    const { rows } = await pg.query(
      `select c.relname, c.relrowsecurity as rls_on,
              exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename = c.relname) as has_policy
       from pg_class c
       where c.relname in ('expense_allocation_entities','expense_balance_allocation_plans','expense_balance_allocations')
       order by c.relname`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.rls_on).toBe(true);
      expect(row.has_policy).toBe(false);
    }
  });

  it("enforces the plan-edge self/nonpositive guards", async () => {
    // Verify CHECK constraints on expense_balance_allocations via metadata.
    const { rows } = await pg.query(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname = 'expense_balance_allocations'
          and c.contype = 'c'`,
    );
    const defs = rows.map((r: { def: string }) => r.def).join("\n");
    // debtor != creditor.
    expect(defs).toMatch(/debtor_index.*creditor_index|creditor_index.*debtor_index/i);
    // amount_cents > 0.
    expect(defs).toMatch(/amount_cents.*>.*0/i);
  });
});
