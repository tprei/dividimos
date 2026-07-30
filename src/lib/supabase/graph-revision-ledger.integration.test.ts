import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { createTestGroup } from "@/test/integration-helpers";

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

describe.skipIf(!canRun)("graph_revision + expense_graph_save_operations (#477)", () => {
  const fixtureCreatorId = "a1111111-1111-1111-1111-111111111111";
  let pg: Client;
  let groupId: string | undefined;
  let ownerlessTombstoneOperationId: string | undefined;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();
    const group = await createTestGroup(fixtureCreatorId);
    groupId = group.id;
  });
  afterAll(async () => {
    if (!pg) return;

    try {
      if (ownerlessTombstoneOperationId) {
        await pg.query(
          "delete from expense_graph_save_operations where operation_id = $1",
          [ownerlessTombstoneOperationId],
        );
      }
      if (groupId) {
        await pg.query(
          "delete from expense_graph_save_operations where group_id = $1",
          [groupId],
        );
        await pg.query("delete from expenses where group_id = $1", [groupId]);
        await pg.query("delete from group_members where group_id = $1", [groupId]);
        await pg.query("delete from groups where id = $1", [groupId]);
      }
    } finally {
      await pg.end();
    }
  });

  it("adds expenses.graph_revision NOT NULL DEFAULT 0 with the int4 bound", async () => {
    const { rows } = await pg.query(
      `select column_default, is_nullable, data_type
         from information_schema.columns
        where table_name = 'expenses' and column_name = 'graph_revision'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].column_default).toBe("0");
    expect(rows[0].is_nullable).toBe("NO");
    expect(rows[0].data_type).toBe("integer");
    // The guard always creates new rows at graph_revision=1 (via
    // save_expense_draft_graph), so the DEFAULT 0 is a backfill/migration
    // default only. The column metadata above is the authoritative check.
  });

  it("rejects graph_revision outside [0, 2147483647]", async () => {
    // The guard intercepts graph_revision changes (must advance by exactly
    // 1 per token), so we verify the CHECK constraint exists in the column
    // definition rather than trying to violate it via INSERT/UPDATE.
    const { rows } = await pg.query(
      `select pg_get_constraintdef(c.oid) as definition
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname = 'expenses'
          and c.contype = 'c'`,
    );
    const graphRevConstraint = rows.find((r: { definition: string }) =>
      r.definition.includes("graph_revision"),
    );
    expect(graphRevConstraint).toBeDefined();
    expect(graphRevConstraint!.definition).toMatch(/graph_revision.*>=.*0/);
    expect(graphRevConstraint!.definition).toMatch(/graph_revision.*<=.*2147483647/);
  });

  it("creates the save-operation ledger RLS-locked with no policies", async () => {
    const { rows } = await pg.query(
      `select c.relrowsecurity as rls_on,
              exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename='expense_graph_save_operations') as has_policy
         from pg_class c where c.relname='expense_graph_save_operations'`,
    );
    expect(rows[0].rls_on).toBe(true);
    expect(rows[0].has_policy).toBe(false);
  });

  it("enforces the committed-arm shape constraint", async () => {
    // committed with null result/result_created_at must be rejected.
    await expect(
      pg.query(
        `insert into expense_graph_save_operations (operation_id, caller_id, group_id, outcome, expense_id, graph_revision)
         values (gen_random_uuid(), $1, $2, 'committed', null, 0)`,
        [fixtureCreatorId, groupId],
      ),
    ).rejects.toThrow();
    // retired without a reason must be rejected.
    await expect(
      pg.query(
        `insert into expense_graph_save_operations (operation_id, outcome) values (gen_random_uuid(), 'retired')`,
      ),
    ).rejects.toThrow();
  });

  it("accepts a well-formed committed row and an ownerless group_deleted tombstone", async () => {
    // Create a minimal expense via raw pg + direct token. The guard
    // requires a 'new'-sourced token for expenses INSERT (only
    // save_expense_draft_graph can open), so use a pre-existing
    // expense from an earlier test's fixture, or skip the FK-dependent
    // parts if none exists. This test primarily validates the ledger
    // table's committed-row shape constraint.
    //
    // Use an existing expense from the group (created by a prior test or
    // a helper), or insert one via the RPC path.
    const { createAndActivateExpense, createTestUsers } = await import("@/test/integration-helpers");
    const [testUser] = await createTestUsers(1);
    await import("@/test/integration-setup").then((m) =>
      m.adminClient!.from("group_members").insert({
        group_id: groupId!, user_id: testUser.id, status: "accepted", invited_by: fixtureCreatorId,
      }),
    );
    const eid = await createAndActivateExpense({
      creator: testUser,
      groupId: groupId!,
      shares: [{ userId: testUser.id, amount: 100 }],
      payers: [{ userId: testUser.id, amount: 100 }],
    });

    await pg.query(
      `insert into expense_graph_save_operations
         (operation_id, caller_id, group_id, canonical_request, request_digest, outcome, expense_id, graph_revision, result, result_created_at)
       values (gen_random_uuid(), $1, $2, '{}'::jsonb, decode(repeat('00',32),'hex'), 'committed', $3, 1, '{"id":"x","graph_revision":1}'::jsonb, statement_timestamp())`,
      [testUser.id, groupId, eid],
    );
    const tombstone = await pg.query<{ operation_id: string }>(
      `insert into expense_graph_save_operations (operation_id, outcome, retired_reason)
       values (gen_random_uuid(), 'retired', 'group_deleted')
       returning operation_id`,
    );
    ownerlessTombstoneOperationId = tombstone.rows[0].operation_id;
    await pg.query("delete from expense_graph_save_operations where expense_id = $1", [eid]);
    // Cleanup the expense via direct token.
    await pg.query("BEGIN");
    await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [[eid]]);
    await pg.query("delete from expenses where id = $1", [eid]);
    await pg.query("COMMIT");
  });
});
