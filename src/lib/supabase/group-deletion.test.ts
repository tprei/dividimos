import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  __dirname,
  "../../../supabase/migrations/20260716000000_protect_group_financial_history.sql",
);
const sql = readFileSync(migrationPath, "utf8");
const operationSql = readFileSync(
  join(
    __dirname,
    "../../../supabase/migrations/20260716100000_replay_safe_settlement_operations.sql",
  ),
  "utf8",
);
const integrationWorkflow = readFileSync(
  join(__dirname, "../../../.github/workflows/integration.yml"),
  "utf8",
);

function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const end = sql.indexOf("$$;", start);
  if (start < 0 || end < 0) {
    throw new Error(`Function ${name} is missing from the migration`);
  }
  return sql.slice(start, end);
}

describe("protect group financial history migration", () => {
  it("reconciles legacy objects before the lifecycle cutover", () => {
    for (const relation of [
      "public.payments",
      "public.item_splits",
      "public.bill_splits",
      "public.bill_payers",
      "public.bill_participants",
      "public.bill_items",
      "public.ledger",
      "public.group_settlements",
      "public.bills",
    ]) {
      expect(sql).toContain(`'${relation}'`);
    }
    expect(sql).toContain(
      "pg_catalog.to_regprocedure('public.sync_group_settlements(uuid)')",
    );
    expect(sql).toContain(
      "pg_catalog.to_regprocedure('public.sync_group_settlements(uuid,jsonb)')",
    );
    expect(sql.indexOf("DO $$")).toBeLessThan(
      sql.indexOf('DROP POLICY IF EXISTS "group_delete"'),
    );
  });

  it("exports the direct PostgreSQL URL for lock-observation tests", () => {
    expect(integrationWorkflow).toContain(
      "DB_URL=$(supabase status --output json | jq -r '.DB_URL')",
    );
    expect(integrationWorkflow).toContain(
      "SUPABASE_DB_URL: ${{ steps.supabase.outputs.db_url }}",
    );
  });

  it("installs the authenticated deletion privilege boundary", () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "group_delete" ON public.groups;');
    expect(sql).toContain("CREATE POLICY group_delete_denied");
    expect(sql).toContain("FOR DELETE TO authenticated");
    expect(sql).toContain("USING (false)");
    expect(sql).toContain(
      "REVOKE DELETE ON TABLE public.groups FROM PUBLIC, anon, authenticated;",
    );
    expect(sql).toContain("GRANT DELETE ON TABLE public.groups TO service_role;");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.delete_group(uuid) FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.delete_group(uuid) TO authenticated;",
    );
  });

  it("cascades settlement operation ownership when an account is deleted", () => {
    expect(operationSql).toContain(
      "initiated_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,",
    );
  });

  it("defines a lock-first void deletion RPC with the protected predicate", () => {
    const body = functionBody("delete_group");
    expect(body).toContain("RETURNS void");
    expect(body).toContain("SECURITY DEFINER");
    expect(body).toContain("SET search_path = ''");
    expect(body).toContain("FOR UPDATE");
    expect(body).toContain("FROM public.expenses");
    expect(body).toContain("FROM public.balances");
    expect(body).toContain("amount_cents <> 0");
    expect(body).toContain("FROM public.settlements");
    expect(body).toContain("USING ERRCODE = 'PST01'");
    expect(body).toContain("USING ERRCODE = 'PST05'");
    expect(body).toContain("USING ERRCODE = 'PST08'");
    expect(body).not.toMatch(/DELETE FROM public\.(expenses|balances|settlements)/);
    expect(body.indexOf("FOR UPDATE")).toBeLessThan(
      body.indexOf("FROM public.expenses"),
    );
  });

  it("keeps the expense deletion policy draft-only and membership-bound", () => {
    const policyStart = sql.indexOf('CREATE POLICY "expenses_delete"');
    const policy = sql.slice(policyStart, sql.indexOf(";", policyStart));
    expect(policy).toContain("creator_id = auth.uid()");
    expect(policy).toContain("status = 'draft'");
    expect(policy).toContain("public.my_accepted_group_ids()");
  });

  it("uses one group row lock before every required child lock", () => {
    const activate = functionBody("activate_expense");
    expect(
      activate.indexOf(
        "FROM public.groups g\n   WHERE g.id = v_group_id\n     FOR UPDATE",
      ),
    ).toBeLessThan(
      activate.indexOf(
        "FROM public.expenses e\n   WHERE e.id = p_expense_id\n     FOR UPDATE",
      ),
    );

    expect(operationSql).toContain(
      "CREATE FUNCTION public.record_settlements",
    );
    expect(operationSql).toContain(
      "ORDER BY group_id",
    );
    expect(
      operationSql.indexOf("FOR UPDATE") <
        operationSql.indexOf("INSERT INTO public.settlements"),
    ).toBe(true);

    const confirm = functionBody("confirm_settlement");
    expect(
      confirm.indexOf(
        "FROM public.groups g\n   WHERE g.id = v_group_id\n     FOR UPDATE",
      ),
    ).toBeLessThan(
      confirm.indexOf(
        "FROM public.settlements s\n   WHERE s.id = p_settlement_id\n     FOR UPDATE",
      ),
    );

    const claim = functionBody("claim_guest_spot");
    expect(
      claim.indexOf(
        "FROM public.groups g\n   WHERE g.id = v_guest_ref.group_id\n     FOR UPDATE",
      ),
    ).toBeLessThan(
      claim.indexOf(
        "FROM public.expenses e\n   WHERE e.id = v_guest_ref.expense_id\n     FOR UPDATE",
      ),
    );
    expect(
      claim.indexOf(
        "FROM public.expenses e\n   WHERE e.id = v_guest_ref.expense_id\n     FOR UPDATE",
      ),
    ).toBeLessThan(
      claim.indexOf(
        "FROM public.expense_guests eg\n   WHERE eg.id = v_guest_ref.guest_id",
      ),
    );

    const join = functionBody("join_group_via_link");
    expect(
      join.indexOf(
        "FROM public.groups g\n   WHERE g.id = v_link_ref.group_id\n     FOR UPDATE",
      ),
    ).toBeLessThan(
      join.indexOf(
        "FROM public.group_invite_links l\n   WHERE l.id = v_link_ref.id",
      ),
    );
  });
});
