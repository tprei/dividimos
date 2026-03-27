import { afterAll, beforeAll, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
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
