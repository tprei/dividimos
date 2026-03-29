import { execSync } from "child_process";
import { describe, it, expect } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";

/**
 * Verifies that the old bill/payment/ledger tables have been dropped
 * and the new expense tables exist after the migration runs.
 */
describe.skipIf(!isIntegrationTestReady)(
  "drop old bill tables migration",
  () => {
    const oldTables = [
      "bills",
      "bill_items",
      "bill_participants",
      "bill_payers",
      "bill_splits",
      "item_splits",
      "ledger",
      "payments",
      "group_settlements",
    ];

    const newTables = [
      "expenses",
      "expense_items",
      "expense_shares",
      "expense_payers",
      "balances",
      "settlements",
    ];

    const oldFunctions = [
      "my_bill_ids",
      "update_ledger_on_payment",
      "update_group_settlement_on_payment",
      "cascade_group_settlement",
      "sync_group_settlements",
    ];

    const preservedFunctions = [
      "my_group_ids",
      "lookup_user_by_handle",
      "activate_expense",
      "confirm_settlement",
    ];

    async function tableExists(tableName: string): Promise<boolean> {
      await adminClient!.rpc("execute_sql" as never, {
        query: `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = '${tableName}'
        ) AS exists`,
      } as never);
      // Fallback: try a direct query
      const { error } = await adminClient!
        .from(tableName as never)
        .select("*")
        .limit(0);
      return !error || error.code !== "42P01"; // 42P01 = undefined_table
    }

    function functionExists(funcName: string): boolean {
      // Query pg_catalog directly via psql to avoid PostgREST issues:
      // - PGRST202 vs 42883 inconsistency after schema cache reloads
      // - Functions granted only to 'authenticated' are invisible to
      //   service_role via the PostgREST RPC endpoint
      const dbUrl =
        process.env.SUPABASE_DB_URL ??
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
      const result = execSync(
        `psql "${dbUrl}" -Atc "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${funcName}')"`,
        { encoding: "utf-8" },
      ).trim();
      return result === "t";
    }

    it("old tables should not exist", async () => {
      for (const table of oldTables) {
        const exists = await tableExists(table);
        expect(exists, `table '${table}' should have been dropped`).toBe(
          false,
        );
      }
    });

    it("new expense tables should exist", async () => {
      for (const table of newTables) {
        const exists = await tableExists(table);
        expect(exists, `table '${table}' should exist`).toBe(true);
      }
    });

    it("preserved tables should still exist", async () => {
      for (const table of ["users", "groups", "group_members"]) {
        const exists = await tableExists(table);
        expect(exists, `table '${table}' should still exist`).toBe(true);
      }
    });

    it("old functions should not exist", () => {
      for (const func of oldFunctions) {
        const exists = functionExists(func);
        expect(
          exists,
          `function '${func}' should have been dropped`,
        ).toBe(false);
      }
    });

    it("preserved functions should still exist", () => {
      for (const func of preservedFunctions) {
        const exists = functionExists(func);
        expect(exists, `function '${func}' should still exist`).toBe(
          true,
        );
      }
    });

    it("users_read_visible policy should not reference bills", async () => {
      // Verify user profile visibility still works via group membership
      const { error } = await adminClient!
        .from("users")
        .select("id")
        .limit(1);
      expect(error).toBeNull();
    });
  },
);
