/**
 * Integration test setup for Supabase database tests.
 *
 * Verifies database connectivity and provides global hooks for test lifecycle.
 * Run with: npm run test:integration
 *
 * Prerequisites:
 *   - `supabase start` must be running (local Supabase stack)
 *   - Environment variables set by CI or via .env.local:
 *     - NEXT_PUBLIC_SUPABASE_URL (http://localhost:54321)
 *     - NEXT_PUBLIC_SUPABASE_ANON_KEY
 *     - SUPABASE_SERVICE_ROLE_KEY
 */

import { afterAll, beforeAll, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Skip all integration tests if required env vars are missing
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

/**
 * Admin client with service role key (bypasses RLS).
 * Use for test setup and cleanup only.
 */
export const adminClient = hasRequiredEnv
  ? createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
  : null;

/**
 * Anonymous client (no auth, subject to RLS).
 * Use for testing unauthenticated access.
 */
export const anonClient = hasRequiredEnv
  ? createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  : null;

// Track test user IDs for cleanup
const testUserIds = new Set<string>();

/**
 * Register a test user for cleanup.
 * Called automatically by createTestUser in integration-helpers.
 */
export function registerTestUser(userId: string): void {
  testUserIds.add(userId);
}

/**
 * Unregister a test user (e.g., after manual cleanup).
 */
export function unregisterTestUser(userId: string): void {
  testUserIds.delete(userId);
}

beforeAll(async () => {
  if (!hasRequiredEnv) {
    return;
  }

  // Verify database connectivity
  const { error } = await adminClient!.from("users").select("id").limit(1);

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `[integration-setup] Database not ready: ${error.message}. ` +
        "Ensure `supabase start` is running.",
    );
  }

  // Suppress console.log in integration tests unless DEBUG is set
  if (!process.env.DEBUG) {
    vi.spyOn(console, "log").mockImplementation(() => {});
  }
});

afterAll(async () => {
  if (!hasRequiredEnv || testUserIds.size === 0) {
    return;
  }

  // Clean up all test users (cascade deletes related data)
  const userIds = Array.from(testUserIds);

  // Delete from public.users first (triggers cascade to related tables)
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

  // Delete from auth.users (cascade should handle this, but be explicit)
  // Delete users one at a time since deleteUsers doesn't exist in this API version
  for (const userId of userIds) {
    const { error: deleteError } = await adminClient!.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error(
        `[integration-setup] Failed to clean up auth user ${userId}:`,
        deleteError.message,
      );
    }
  }

  testUserIds.clear();
});

// Export for use in tests that need to skip when env vars are missing
export const isIntegrationTestReady = hasRequiredEnv;
