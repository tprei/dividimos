// Issue #475: no global RATE_LIMIT_DISABLED bypass here. A suite-wide
// bypass would make every future route-to-RPC enforcement test a false
// green. A test that genuinely does not exercise rate limiting may opt out
// only within its own isolated module/env scope (see
// src/lib/rate-limit.test.ts for the guarded non-production bypass itself).
import { afterAll, beforeAll, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import type { Database } from "@/types/database";

const hasRequiredEnv =
  typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string" &&
  typeof process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY === "string" &&
  typeof process.env.SUPABASE_SERVICE_ROLE_KEY === "string";

if (!hasRequiredEnv) {
  console.warn(
    "[integration-setup] Missing required environment variables. " +
      "Integration tests will be skipped. " +
      "Run `supabase start` and ensure env vars are set.",
  );
}

export const adminClient = hasRequiredEnv
  ? createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
  : null;

const testUserIds = new Set<string>();

export function registerTestUser(userId: string): void {
  testUserIds.add(userId);
}

export function unregisterTestUser(userId: string): void {
  testUserIds.delete(userId);
}

beforeAll(async () => {
  if (!hasRequiredEnv) return;

  const { error } = await adminClient!.from("users").select("id").limit(1);

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `[integration-setup] Database not ready: ${error.message}. ` +
        "Ensure `supabase start` is running.",
    );
  }

  if (!process.env.DEBUG) {
    vi.spyOn(console, "log").mockImplementation(() => {});
  }
});

afterAll(async () => {
  if (!hasRequiredEnv || testUserIds.size === 0) return;

  const userIds = Array.from(testUserIds);

  const { error: operationError } = await adminClient!
    .from("settlement_operations")
    .delete()
    .in("initiated_by", userIds);

  if (operationError) {
    console.error(
      "[integration-setup] Failed to clean up settlement operations:",
      operationError.message,
    );
  }

  // #477: the users -> expenses cascade below now requires an open
  // direct mutation token (the expense-graph guard rejects unguarded
  // writes/cascades). A PostgREST .from().delete() call cannot open a
  // token first in the same database session, so this step uses a raw,
  // single-session pg connection instead: look up the affected users'
  // owned expenses, register a direct token for them, then delete.
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (dbUrl) {
    const pgClient = new Client(dbUrl);
    await pgClient.connect();
    try {
      const owned = await pgClient.query<{ id: string }>(
        "select id from public.expenses where creator_id = any($1::uuid[])",
        [userIds],
      );
      // ON COMMIT DELETE ROWS wipes the token at the end of the
      // transaction it was opened in; the open and the delete must
      // share one explicit transaction, not two autocommit statements.
      await pgClient.query("BEGIN");
      if (owned.rows.length > 0) {
        const ownedIds = owned.rows.map((r) => r.id);
        await pgClient.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [
          ownedIds,
        ]);
        // expense_graph_save_operations.expense_id is ON DELETE RESTRICT
        // DEFERRABLE INITIALLY DEFERRED; an un-scrubbed committed row
        // aborts the cascading delete below at COMMIT.
      }
      // caller_id is ON DELETE RESTRICT with NO deferrable clause, so it
      // blocks the users delete below immediately -- not just at commit
      // -- for ANY row still naming these callers, including one a test
      // file's own cleanup already retired with 'expense_deleted' (which
      // deliberately keeps caller_id as an owner-bound audit trail).
      // Deleting the account itself is exactly what 'account_deleted'
      // exists for: tombstone every row naming these callers, keyed on
      // caller_id directly rather than expense_id, regardless of its
      // current outcome.
      await pgClient.query(
        `update public.expense_graph_save_operations
            set outcome = 'retired', caller_id = null, group_id = null,
                canonical_request = null, request_digest = null,
                expense_id = null, graph_revision = null, result = null,
                result_created_at = null, retired_reason = 'account_deleted',
                retired_at = statement_timestamp()
          where caller_id = any($1::uuid[])`,
        [userIds],
      );
      await pgClient.query("delete from public.users where id = any($1::uuid[])", [userIds]);
      await pgClient.query("COMMIT");
    } catch (error) {
      console.error(
        "[integration-setup] Failed to clean up public.users:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      await pgClient.end();
    }
  } else {
    const { error: publicError } = await adminClient!
      .from("users")
      .delete()
      .in("id", userIds);

    if (publicError) {
      console.error(
        "[integration-setup] Failed to clean up public.users:",
        publicError.message,
      );
    }
  }

  for (const userId of userIds) {
    const { error: authError } = await adminClient!.auth.admin.deleteUser(userId);
    if (authError) {
      console.error(
        `[integration-setup] Failed to clean up auth user ${userId}:`,
        authError.message,
      );
    }
  }

  testUserIds.clear();
});

export const isIntegrationTestReady = hasRequiredEnv;
