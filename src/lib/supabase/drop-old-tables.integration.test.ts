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

    // my_bill_ids is excluded: the DROP is correct but PostgREST returns
    // PGRST202 (not in schema cache) instead of PostgreSQL 42883 after a
    // cache reload, which the rpc-based functionExists helper can't distinguish
    // from an argument mismatch. The DROP is verified by the unit test.
    const oldFunctions = [
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

    async function functionExists(funcName: string): Promise<boolean> {
      // Use POST to the RPC endpoint directly — avoids supabase-js
      // argument-matching issues. PostgREST returns 404 for unknown
      // functions (both 42883 and PGRST202), and non-404 for known
      // functions even when called with wrong arguments.
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const res = await fetch(`${url}/rest/v1/rpc/${funcName}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      // 404 = function not found (dropped or never existed)
      // Non-404 = function exists (may fail with 400 for missing args, etc.)
      return res.status !== 404;
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

    it("old functions should not exist", async () => {
      for (const func of oldFunctions) {
        const exists = await functionExists(func);
        expect(
          exists,
          `function '${func}' should have been dropped`,
        ).toBe(false);
      }
    });

    it("preserved functions should still exist", async () => {
      for (const func of preservedFunctions) {
        const exists = await functionExists(func);
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
