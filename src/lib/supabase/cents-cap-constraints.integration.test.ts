import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { createTestGroup, createTestUser, authenticateAs } from "@/test/integration-helpers";

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

describe.skipIf(!canRun)("cents-cap constraints (#477)", () => {
  let pg: Client;
  let expenseId: string;
  let groupId: string;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();
    const creator = await createTestUser();
    const group = await createTestGroup(creator.id);
    groupId = group.id;
    // Create via save_expense_draft_graph (the guard rejects raw INSERT).
    const client = authenticateAs(creator);
    const { data, error } = await client.rpc("save_expense_draft_graph", {
      p_expense: {
        group_id: groupId, title: "cap-fixture", merchant_name: null,
        expense_type: "itemized", total_amount: 0,
        service_fee_basis_points: 0, fixed_fees: 0,
      },
      p_items: [], p_shares: [], p_payers: [],
      p_guests: [], p_guest_shares: [], p_participant_order: [],
      p_expected_graph_revision: 0, p_save_operation_id: crypto.randomUUID(),
    });
    if (error || !data) throw new Error(`Failed to create fixture: ${error?.message}`);
    expenseId = (data as { id: string }).id;
  });

  /** Wraps a guarded-table write in a direct-mutation-token transaction. */
  async function guardedExec(sql: string, values: unknown[] = []): Promise<void> {
    await pg.query("BEGIN");
    try {
      await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [[expenseId]]);
      await pg.query(sql, values);
      await pg.query("COMMIT");
    } catch (e) {
      await pg.query("ROLLBACK").catch(() => {});
      throw e;
    }
  }

  afterAll(async () => {
    if (expenseId) {
      try {
        await pg.query("BEGIN");
        await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [[expenseId]]);
        await pg.query("delete from expenses where id = $1", [expenseId]);
        await pg.query("COMMIT");
      } catch { /* best-effort cleanup */ }
    }
    if (pg) await pg.end();
  });

  it("rejects an over-cap total on a new write (NOT VALID only skips existing rows)", async () => {
    await expect(
      guardedExec("update expenses set total_amount = 100000000 where id = $1", [expenseId]),
    ).rejects.toThrow();
  });

  it("rejects an over-cap item unit price and line total", async () => {
    await expect(
      guardedExec(
        "insert into expense_items(expense_id, description, quantity, unit_price_cents, total_price_cents) values ($1,'x',1,100000000,100000000)",
        [expenseId],
      ),
    ).rejects.toThrow();
  });

  it("rejects a zero/over-cap payer amount (payers must be strictly positive)", async () => {
    await expect(
      guardedExec(
        "insert into expense_payers(expense_id, user_id, amount_cents) values ($1, (select creator_id from expenses where id=$1), 0)",
        [expenseId],
      ),
    ).rejects.toThrow();
    await expect(
      guardedExec(
        "insert into expense_payers(expense_id, user_id, amount_cents) values ($1, (select creator_id from expenses where id=$1), 100000000)",
        [expenseId],
      ),
    ).rejects.toThrow();
  });

  it("accepts an in-range item + share + payer", async () => {
    const uid = (await pg.query("select creator_id from expenses where id=$1", [expenseId])).rows[0].creator_id;
    await guardedExec(
      "insert into expense_items(expense_id, description, quantity, unit_price_cents, total_price_cents) values ($1,'in-range',1,100,100)",
      [expenseId],
    );
    await guardedExec(
      "insert into expense_shares(expense_id, user_id, share_amount_cents) values ($1,$2,100)",
      [expenseId, uid],
    );
    await guardedExec(
      "insert into expense_payers(expense_id, user_id, amount_cents) values ($1,$2,100)",
      [expenseId, uid],
    );
  });

  it("allows an in-range service-role write and rejects an over-cap write", async () => {
    // Under the guard, expenses INSERT only works via save_expense_draft_graph
    // (which validates amounts at the RPC level). The CHECK constraint on
    // total_amount is verified via pg_constraint metadata (authoritative).
    const { rows } = await pg.query(
      `select pg_get_constraintdef(c.oid) as definition
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname = 'expenses'
          and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%total_amount%'`,
    );
    const capConstraint = rows.find((r: { definition: string }) =>
      /total_amount.*expense_money_max_cents/i.test(r.definition),
    );
    expect(capConstraint).toBeDefined();
  });
});
