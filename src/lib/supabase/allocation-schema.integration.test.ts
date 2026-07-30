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
    // Valid user entity: share 50, paid 0, net 50.
    await expect(
      pg.query(
        "INSERT INTO expense_allocation_entities (expense_id, participant_index, entity_kind, user_id, share_amount_cents, payer_amount_cents, net_amount_cents) VALUES ($1, 1, 'user', $2, 50, 0, 50)",
        [expenseId, users[0].id],
      ),
    ).resolves.toBeDefined();

    // Both ids null rejected.
    await expect(
      pg.query(
        "INSERT INTO expense_allocation_entities (expense_id, participant_index, entity_kind, share_amount_cents, payer_amount_cents, net_amount_cents) VALUES ($1, 2, 'user', 0, 0, 0)",
        [expenseId],
      ),
    ).rejects.toThrow();

    // Guest with payer_amount > 0 rejected (guests never pay).
    await expect(
      pg.query(
        "INSERT INTO expense_allocation_entities (expense_id, participant_index, entity_kind, guest_id, share_amount_cents, payer_amount_cents, net_amount_cents) VALUES ($1, 3, 'guest', gen_random_uuid(), 10, 1, 9)",
        [expenseId],
      ),
    ).rejects.toThrow();

    // net != share - payer rejected.
    await expect(
      pg.query(
        "INSERT INTO expense_allocation_entities (expense_id, participant_index, entity_kind, user_id, share_amount_cents, payer_amount_cents, net_amount_cents) VALUES ($1, 4, 'user', $2, 30, 10, 25)",
        [expenseId, users[1].id],
      ),
    ).rejects.toThrow();

    // Duplicate participant_index rejected by PK.
    await expect(
      pg.query(
        "INSERT INTO expense_allocation_entities (expense_id, participant_index, entity_kind, user_id, share_amount_cents, payer_amount_cents, net_amount_cents) VALUES ($1, 1, 'user', $2, 1, 0, 1)",
        [expenseId, users[1].id],
      ),
    ).rejects.toThrow();
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
    await pg.query(
      "INSERT INTO expense_balance_allocation_plans (expense_id, algorithm_version, total_cents, entity_count, edge_count, source_digest) VALUES ($1, 1, 100, 2, 0, 'test')",
      [expenseId],
    );
    // debtor == creditor rejected.
    await expect(
      pg.query(
        "INSERT INTO expense_balance_allocations (expense_id, allocation_index, debtor_index, creditor_index, amount_cents) VALUES ($1, 1, 1, 1, 5)",
        [expenseId],
      ),
    ).rejects.toThrow();
    // nonpositive amount rejected.
    await expect(
      pg.query(
        "INSERT INTO expense_balance_allocations (expense_id, allocation_index, debtor_index, creditor_index, amount_cents) VALUES ($1, 2, 1, 2, 0)",
        [expenseId],
      ),
    ).rejects.toThrow();
  });
});
