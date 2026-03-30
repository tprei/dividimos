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
  const email = options.email ?? `test_${testId}@test.pagajaja.local`;
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

  const password = `test_${testId}_pass!`;
  await adminClient.auth.admin.updateUserById(userId, { password });

  const anonClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: signInData, error: signInError } =
    await anonClient.auth.signInWithPassword({ email, password });

  if (signInError || !signInData.session) {
    throw new Error(`Failed to sign in test user: ${signInError?.message}`);
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
    accessToken: signInData.session.access_token,
    refreshToken: signInData.session.refresh_token,
  };
}

export function authenticateAs(user: TestUser): SupabaseClient<Database> {
  if (!isIntegrationTestReady) {
    throw new Error(
      "Integration tests require Supabase environment variables. " +
        "Run `supabase start` and ensure env vars are set.",
    );
  }

  if (!user.accessToken) {
    throw new Error(`User ${user.handle} has no access token`);
  }

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${user.accessToken}` },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
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

// ---------------------------------------------------------------------------
// Expense helpers
// ---------------------------------------------------------------------------

export interface ExpenseShareInput {
  userId: string;
  amount: number;
}

export interface ExpensePayerInput {
  userId: string;
  amount: number;
}

export interface CreateAndActivateExpenseOptions {
  creator: TestUser;
  groupId: string;
  shares: ExpenseShareInput[];
  payers: ExpensePayerInput[];
  title?: string;
  expenseType?: "single_amount" | "itemized";
  serviceFeePercent?: number;
  fixedFees?: number;
}

/**
 * Creates an expense with shares and payers, then activates it via RPC.
 * The total is computed as the sum of payer amounts.
 * Returns the expense id.
 */
export async function createAndActivateExpense(
  options: CreateAndActivateExpenseOptions,
): Promise<string> {
  if (!isIntegrationTestReady || !adminClient) {
    throw new Error("Integration tests require Supabase environment variables.");
  }

  const {
    creator,
    groupId,
    shares,
    payers,
    title,
    expenseType = "single_amount",
    serviceFeePercent = 0,
    fixedFees = 0,
  } = options;

  const totalAmount = payers.reduce((sum, p) => sum + p.amount, 0);
  const testId = Date.now().toString(36).slice(-4);

  // Insert expense
  const { data: expense, error: expError } = await adminClient
    .from("expenses")
    .insert({
      group_id: groupId,
      creator_id: creator.id,
      title: title ?? `Test Expense ${testId}`,
      expense_type: expenseType,
      total_amount: totalAmount,
      service_fee_percent: serviceFeePercent,
      fixed_fees: fixedFees,
      status: "draft",
    })
    .select("id")
    .single();

  if (expError || !expense) {
    throw new Error(`Failed to create expense: ${expError?.message}`);
  }

  const expenseId = expense.id;

  // Insert shares and payers in parallel
  const [sharesResult, payersResult] = await Promise.all([
    adminClient.from("expense_shares").insert(
      shares.map((s) => ({
        expense_id: expenseId,
        user_id: s.userId,
        share_amount_cents: s.amount,
      })),
    ),
    adminClient.from("expense_payers").insert(
      payers.map((p) => ({
        expense_id: expenseId,
        user_id: p.userId,
        amount_cents: p.amount,
      })),
    ),
  ]);

  if (sharesResult.error) {
    throw new Error(`Failed to insert shares: ${sharesResult.error.message}`);
  }
  if (payersResult.error) {
    throw new Error(`Failed to insert payers: ${payersResult.error.message}`);
  }

  // Activate via RPC as the creator
  const creatorClient = authenticateAs(creator);
  const { error: rpcError } = await creatorClient.rpc("activate_expense", {
    p_expense_id: expenseId,
  });

  if (rpcError) {
    throw new Error(`Failed to activate expense: ${rpcError.message}`);
  }

  return expenseId;
}

// ---------------------------------------------------------------------------
// Settlement helpers
// ---------------------------------------------------------------------------

export interface SettleDebtOptions {
  caller: TestUser;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

/**
 * Calls the record_and_settle RPC to atomically create a confirmed settlement
 * and update balances. Returns the settlement id.
 */
export async function settleDebt(options: SettleDebtOptions): Promise<string> {
  if (!isIntegrationTestReady) {
    throw new Error("Integration tests require Supabase environment variables.");
  }

  const { caller, groupId, fromUserId, toUserId, amountCents } = options;
  const callerClient = authenticateAs(caller);

  const { data, error } = await callerClient.rpc("record_and_settle", {
    p_group_id: groupId,
    p_from_user_id: fromUserId,
    p_to_user_id: toUserId,
    p_amount_cents: amountCents,
  });

  if (error) {
    throw new Error(`record_and_settle failed: ${error.message}`);
  }

  return data as string;
}

// ---------------------------------------------------------------------------
// Balance helpers
// ---------------------------------------------------------------------------

/**
 * Gets the balance between two users in a group.
 * Returns a signed value: positive means userX owes userY,
 * negative means userY owes userX.
 * Returns 0 if no balance row exists.
 */
export async function getBalanceBetween(
  groupId: string,
  userX: string,
  userY: string,
): Promise<number> {
  if (!isIntegrationTestReady || !adminClient) {
    throw new Error("Integration tests require Supabase environment variables.");
  }

  // Canonical ordering: user_a < user_b
  const [userA, userB] = userX < userY ? [userX, userY] : [userY, userX];

  const { data, error } = await adminClient
    .from("balances")
    .select("amount_cents")
    .eq("group_id", groupId)
    .eq("user_a", userA)
    .eq("user_b", userB)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query balance: ${error.message}`);
  }

  if (!data) return 0;

  // If userX is the canonical user_a, return as-is (positive = userX owes userY).
  // If userX is user_b, flip the sign (positive = userX owes userY).
  return (userX < userY ? data.amount_cents : -data.amount_cents) || 0;
}

// ---------------------------------------------------------------------------
// Group membership helpers
// ---------------------------------------------------------------------------

/**
 * Accepts a group invitation for the given user.
 * Uses the user's authenticated client so RLS policies are respected.
 */
export async function acceptGroupInvite(
  user: TestUser,
  groupId: string,
): Promise<void> {
  const userClient = authenticateAs(user);

  const { error } = await userClient
    .from("group_members")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("group_id", groupId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(
      `Failed to accept group invite for ${user.handle}: ${error.message}`,
    );
  }
}

/**
 * Creates a group with accepted members in one step.
 * Convenience wrapper that creates the group, invites members, and accepts all invites.
 */
export async function createTestGroupWithMembers(
  creator: TestUser,
  members: TestUser[],
): Promise<Database["public"]["Tables"]["groups"]["Row"]> {
  const memberIds = members.map((m) => m.id);
  const group = await createTestGroup(creator.id, memberIds);

  // Accept all invitations in parallel
  await Promise.all(members.map((m) => acceptGroupInvite(m, group.id)));

  return group;
}
