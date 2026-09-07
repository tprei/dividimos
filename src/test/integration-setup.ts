// Issue #475: no global RATE_LIMIT_DISABLED bypass here. A suite-wide
// bypass would make every future route-to-RPC enforcement test a false
// green. A test that genuinely does not exercise rate limiting may opt out
// only within its own isolated module/env scope (see
// src/lib/rate-limit.test.ts for the guarded non-production bypass itself).
import { afterAll, beforeAll, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";

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
  ? createClient(
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

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (dbUrl) {
    const client = new Client(dbUrl);
    await client.connect();
    try {
      await client.query("select 1 from public.groups limit 1");
    } catch (error) {
      throw new Error(
        `[integration-setup] Database not ready: ${
          error instanceof Error ? error.message : error
        }. ` + "Ensure `supabase start` is running.",
      );
    } finally {
      await client.end();
    }
  }

  if (!process.env.DEBUG) {
    vi.spyOn(console, "log").mockImplementation(() => {});
  }
});

afterAll(async () => {
  if (!hasRequiredEnv || testUserIds.size === 0) return;

  const userIds = Array.from(testUserIds);

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (dbUrl) {
    const pgClient = new Client(dbUrl);
    await pgClient.connect();
    try {
      await pgClient.query("BEGIN");
      await pgClient.query(
        "DELETE FROM public.groups WHERE creator_id = ANY($1::uuid[])",
        [userIds],
      );
      await pgClient.query(
        "DELETE FROM public.vendor_charges WHERE user_id = ANY($1::uuid[])",
        [userIds],
      );
      await pgClient.query(
        "DELETE FROM public.push_subscriptions WHERE user_id = ANY($1::uuid[])",
        [userIds],
      );
      await pgClient.query(
        "DELETE FROM public.users WHERE id = ANY($1::uuid[])",
        [userIds],
      );
      await pgClient.query("COMMIT");
    } catch (error) {
      await pgClient.query("ROLLBACK").catch(() => {});
      console.error(
        "[integration-setup] Failed to clean up test data:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      await pgClient.end();
    }
  } else {
    console.error(
      "[integration-setup] SUPABASE_DB_URL is not set; skipping database cleanup.",
    );
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
