/**
 * Integration test helpers for Supabase database tests.
 *
 * Provides utilities for creating test users, authenticating as specific users,
 * and cleaning up test data.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { User } from "@/types";
import {
  adminClient,
  registerTestUser,
  unregisterTestUser,
  isIntegrationTestReady,
} from "./integration-setup";

export interface TestUser {
  id: string;
  email: string;
  handle: string;
  name: string;
  phone?: string;
  pixKeyType: "phone" | "cpf" | "email" | "random";
  pixKeyHint: string;
  onboarded: boolean;
  accessToken?: string;
  refreshToken?: string;
}

export interface CreateTestUserOptions {
  handle?: string;
  name?: string;
  email?: string;
  phone?: string;
  pixKeyType?: "phone" | "cpf" | "email" | "random";
  onboarded?: boolean;
}

/**
 * Generate a unique identifier for test isolation.
 */
function generateTestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a test user with auth identity and public profile.
 *
 * The user is automatically registered for cleanup after the test run.
 * Returns both the user info and session tokens for authenticated requests.
 *
 * @param options - User creation options
 * @returns Test user with auth tokens
 */
export async function createTestUser(
  options: CreateTestUserOptions = {},
): Promise<TestUser> {
  if (!isIntegrationTestReady || !adminClient) {
    throw new Error(
      "Integration tests require Supabase environment variables. " +
        "Run `supabase start` and ensure env vars are set.",
    );
  }

  const testId = generateTestId();
  const handle = options.handle ?? `test_${testId}`;
  const name = options.name ?? `Test User ${testId.slice(0, 8)}`;
  const email = options.email ?? `test_${testId}@test.pixwise.local`;
  const phone = options.phone;
  const pixKeyType = options.pixKeyType ?? "email";
  const onboarded = options.onboarded ?? true;

  // Create auth user
  const { data: authData, error: authError } =
    await adminClient.auth.admin.createUser({
      email,
      phone,
      email_confirm: true,
      phone_confirm: phone ? true : false,
      user_metadata: {
        full_name: name,
      },
    });

  if (authError || !authData.user) {
    throw new Error(`Failed to create auth user: ${authError?.message}`);
  }

  const userId = authData.user.id;

  // Register for cleanup
  registerTestUser(userId);

  // The handle_new_user trigger auto-creates public.users row.
  // Update it with test-specific values.
  const { error: profileError } = await adminClient
    .from("users")
    .update({
      handle,
      name,
      pix_key_type: pixKeyType,
      pix_key_hint: `${pixKeyType === "email" ? "test" : "***"}@hint.local`,
      onboarded,
    })
    .eq("id", userId);

  if (profileError) {
    // Clean up on failure
    await adminClient.auth.admin.deleteUser(userId);
    unregisterTestUser(userId);
    throw new Error(`Failed to update user profile: ${profileError.message}`);
  }

  // Generate session tokens for the user
  const { data: sessionData, error: sessionError } =
    await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

  let accessToken: string | undefined;
  let refreshToken: string | undefined;

  if (sessionData && !sessionError) {
    // Extract tokens from the magic link
    const linkUrl = new URL(sessionData.properties.action_link);
    const tokenHash = linkUrl.searchParams.get("token_hash");

    if (tokenHash) {
      // Verify OTP to get actual session
      const tempClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );

      const { data: verifyData } = await tempClient.auth.verifyOtp({
        token_hash: tokenHash,
        type: "magiclink",
      });

      if (verifyData.session) {
        accessToken = verifyData.session.access_token;
        refreshToken = verifyData.session.refresh_token;
      }
    }
  }

  return {
    id: userId,
    email,
    handle,
    name,
    phone,
    pixKeyType,
    pixKeyHint: `${pixKeyType === "email" ? "test" : "***"}@hint.local`,
    onboarded,
    accessToken,
    refreshToken,
  };
}

/**
 * Create a Supabase client authenticated as a specific test user.
 *
 * Use this to test RLS policies from the user's perspective.
 *
 * @param user - Test user with access token
 * @returns Authenticated Supabase client
 */
export function authenticateAs(user: TestUser): ReturnType<
  typeof createClient<Database>
> {
  if (!isIntegrationTestReady) {
    throw new Error(
      "Integration tests require Supabase environment variables. " +
        "Run `supabase start` and ensure env vars are set.",
    );
  }

  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  if (user.accessToken) {
    // Set the session on the client
    client.auth.setSession({
      access_token: user.accessToken,
      refresh_token: user.refreshToken ?? "",
    });
  }

  return client;
}

/**
 * Immediately delete test users and their related data.
 *
 * This is called automatically after all tests complete, but can be used
 * for explicit cleanup within a test suite.
 *
 * @param userIds - User IDs to delete
 */
export async function cleanupTestUsers(userIds: string[]): Promise<void> {
  if (!isIntegrationTestReady || !adminClient) {
    return;
  }

  // Delete from public.users (cascade handles related data)
  await adminClient.from("users").delete().in("id", userIds);

  // Delete from auth.users (one at a time)
  for (const id of userIds) {
    await adminClient.auth.admin.deleteUser(id);
  }

  for (const id of userIds) {
    unregisterTestUser(id);
  }
}

/**
 * Create multiple test users in parallel.
 *
 * @param count - Number of users to create
 * @param baseOptions - Base options applied to all users
 * @returns Array of test users
 */
export async function createTestUsers(
  count: number,
  baseOptions: CreateTestUserOptions = {},
): Promise<TestUser[]> {
  return Promise.all(
    Array.from({ length: count }, (_, i) =>
      createTestUser({
        ...baseOptions,
        handle: baseOptions.handle
          ? `${baseOptions.handle}_${i + 1}`
          : undefined,
        name: baseOptions.name ? `${baseOptions.name} ${i + 1}` : undefined,
      }),
    ),
  );
}

/**
 * Convert a TestUser to the app's User type.
 */
export function toUser(testUser: TestUser): User {
  return {
    id: testUser.id,
    email: testUser.email,
    handle: testUser.handle,
    name: testUser.name,
    phone: testUser.phone,
    pixKeyType: testUser.pixKeyType,
    pixKeyHint: testUser.pixKeyHint,
    onboarded: testUser.onboarded,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Wait for realtime subscription to be ready.
 * Useful for tests that depend on realtime events.
 */
export async function waitForRealtime(
  client: ReturnType<typeof createClient<Database>>,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Realtime subscription timeout"));
    }, timeoutMs);

    const channels = client.realtime.getChannels();

    if (channels.length === 0) {
      clearTimeout(timeout);
      resolve();
      return;
    }

    // Wait for at least one channel to be subscribed
    let resolved = false;
    for (const channel of channels) {
      if (channel.state === "joined" && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve();
      }
    }

    // If no channels are ready, wait a bit and resolve anyway
    setTimeout(() => {
      if (!resolved) {
        clearTimeout(timeout);
        resolve();
      }
    }, 500);
  });
}

/**
 * Create a test bill with the given creator.
 *
 * @param creatorId - User ID of the bill creator
 * @param overrides - Bill field overrides
 * @returns Created bill row
 */
export async function createTestBill(
  creatorId: string,
  overrides: Partial<Database["public"]["Tables"]["bills"]["Insert"]> = {},
): Promise<Database["public"]["Tables"]["bills"]["Row"]> {
  if (!isIntegrationTestReady || !adminClient) {
    throw new Error("Integration tests require Supabase environment variables.");
  }

  const testId = generateTestId();

  const { data, error } = await adminClient
    .from("bills")
    .insert({
      creator_id: creatorId,
      title: `Test Bill ${testId.slice(0, 8)}`,
      bill_type: "single_amount",
      status: "draft",
      total_amount: 0,
      total_amount_input: 10000,
      ...overrides,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create test bill: ${error?.message}`);
  }

  return data;
}

/**
 * Create a test group with the given creator.
 *
 * @param creatorId - User ID of the group creator
 * @param memberIds - Additional member user IDs to add
 * @returns Created group row
 */
export async function createTestGroup(
  creatorId: string,
  memberIds: string[] = [],
): Promise<Database["public"]["Tables"]["groups"]["Row"]> {
  if (!isIntegrationTestReady || !adminClient) {
    throw new Error("Integration tests require Supabase environment variables.");
  }

  const testId = generateTestId();

  const { data: group, error: groupError } = await adminClient
    .from("groups")
    .insert({
      name: `Test Group ${testId.slice(0, 8)}`,
      creator_id: creatorId,
    })
    .select()
    .single();

  if (groupError || !group) {
    throw new Error(`Failed to create test group: ${groupError?.message}`);
  }

  // Add creator as accepted member
  await adminClient.from("group_members").insert({
    group_id: group.id,
    user_id: creatorId,
    status: "accepted",
    invited_by: creatorId,
  });

  // Add additional members as invited
  if (memberIds.length > 0) {
    await adminClient.from("group_members").insert(
      memberIds.map((userId) => ({
        group_id: group.id,
        user_id: userId,
        status: "invited" as const,
        invited_by: creatorId,
      })),
    );
  }

  return group;
}
