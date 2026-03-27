import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
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

function generateTestId(): string {
  const ts = Date.now().toString(36).slice(-4);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}_${rand}`;
}

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

  const { data: authData, error: authError } =
    await adminClient.auth.admin.createUser({
      email,
      phone,
      email_confirm: true,
      phone_confirm: phone ? true : false,
      user_metadata: { full_name: name },
    });

  if (authError || !authData.user) {
    throw new Error(`Failed to create auth user: ${authError?.message}`);
  }

  const userId = authData.user.id;
  registerTestUser(userId);

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
    await adminClient.auth.admin.deleteUser(userId);
    unregisterTestUser(userId);
    throw new Error(`Failed to update user profile: ${profileError.message}`);
  }

  const { data: sessionData, error: sessionError } =
    await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

  let accessToken: string | undefined;
  let refreshToken: string | undefined;

  if (sessionData && !sessionError) {
    const linkUrl = new URL(sessionData.properties.action_link);
    const tokenHash = linkUrl.searchParams.get("token_hash");

    if (tokenHash) {
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

export function authenticateAs(user: TestUser): SupabaseClient<Database> {
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
    client.auth.setSession({
      access_token: user.accessToken,
      refresh_token: user.refreshToken ?? "",
    });
  }

  return client;
}

export async function createTestUsers(
  count: number,
  baseOptions: CreateTestUserOptions = {},
): Promise<TestUser[]> {
  return Promise.all(
    Array.from({ length: count }, (_, i) =>
      createTestUser({
        ...baseOptions,
        handle: baseOptions.handle ? `${baseOptions.handle}_${i + 1}` : undefined,
        name: baseOptions.name ? `${baseOptions.name} ${i + 1}` : undefined,
      }),
    ),
  );
}

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

  return data as Database["public"]["Tables"]["bills"]["Row"];
}

export async function createTestGroup(
  creatorId: string,
  memberIds: string[] = [],
): Promise<Database["public"]["Tables"]["groups"]["Row"]> {
  if (!isIntegrationTestReady || !adminClient) {
    throw new Error("Integration tests require Supabase environment variables.");
  }

  const testId = generateTestId();

  const { data: groupData, error: groupError } = await adminClient
    .from("groups")
    .insert({
      name: `Test Group ${testId.slice(0, 8)}`,
      creator_id: creatorId,
    })
    .select()
    .single();

  if (groupError || !groupData) {
    throw new Error(`Failed to create test group: ${groupError?.message}`);
  }

  const group = groupData as Database["public"]["Tables"]["groups"]["Row"];

  await adminClient.from("group_members").insert({
    group_id: group.id,
    user_id: creatorId,
    status: "accepted",
    invited_by: creatorId,
  });

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
