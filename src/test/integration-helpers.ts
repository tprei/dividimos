import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
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
  pixKeyType: "cpf" | "email" | "random";
  pixKeyHint: string;
  onboarded: boolean;
  accessToken?: string;
  refreshToken?: string;
}

export interface CreateTestUserOptions {
  handle?: string;
  name?: string;
  email?: string;
  pixKeyType?: "cpf" | "email" | "random";
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
  const email = options.email ?? `test_${testId}@test.dividimos.local`;
  const pixKeyType = options.pixKeyType ?? "email";
  const onboarded = options.onboarded ?? true;

  const { data: authData, error: authError } =
    await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
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

  const anonClient = createClient(
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

async function callRpc<T>(
  client: SupabaseClient<Database>,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(fn as never, args as never);
  if (error) {
    throw new Error(error.message);
  }
  return data as T;
}

export async function createGroup(
  creator: TestUser,
  name: string,
  memberIds: string[] = [],
): Promise<{ groupId: string }> {
  const client = authenticateAs(creator);
  const data = await callRpc<{ groupId: string }>(client, "create_group", {
    p_name: name,
    p_member_ids: memberIds,
  });
  return { groupId: data.groupId };
}

export async function acceptInvitation(
  user: TestUser,
  groupId: string,
): Promise<void> {
  const client = authenticateAs(user);
  await callRpc<unknown>(client, "accept_invitation", { p_group_id: groupId });
}

export async function createGroupWithMembers(
  creator: TestUser,
  members: TestUser[],
  name = "Grupo teste",
): Promise<string> {
  const { groupId } = await createGroup(
    creator,
    name,
    members.map((member) => member.id),
  );
  for (const member of members) {
    await acceptInvitation(member, groupId);
  }
  return groupId;
}

export interface CreateExpenseInput {
  groupId: string;
  title?: string;
  occurredOn?: string;
  expenseType?: "itemized" | "single_amount";
  totalCents: number;
  serviceFeeBps?: number;
  fixedFeeCents?: number;
  payload: unknown;
  clientId?: string;
  receiptAccessKey?: string | null;
}

export async function createExpense(
  actor: TestUser,
  input: CreateExpenseInput,
): Promise<{
  expenseId: string;
  versionNo: number;
  ledgerVersion: number;
  eventId: number;
}> {
  const client = authenticateAs(actor);
  return callRpc(client, "create_expense", {
    p_client_id: input.clientId ?? crypto.randomUUID(),
    p_group_id: input.groupId,
    p_occurred_on: input.occurredOn ?? new Date().toISOString().slice(0, 10),
    p_title: input.title ?? "Despesa",
    p_merchant_name: null,
    p_expense_type: input.expenseType ?? "single_amount",
    p_total_cents: input.totalCents,
    p_service_fee_bps: input.serviceFeeBps ?? 0,
    p_fixed_fee_cents: input.fixedFeeCents ?? 0,
    p_chave_acesso: input.receiptAccessKey ?? null,
    p_payload: input.payload,
  });
}

export function equalSplitPayload(
  userIds: string[],
  totalCents: number,
  payerIndex = 0,
): unknown {
  const base = Math.floor(totalCents / userIds.length);
  const remainder = totalCents % userIds.length;
  const shares = userIds.map((_, index) => (index < remainder ? base + 1 : base));
  return {
    items: [],
    participants: userIds.map((userId) => ({ kind: "user", userId })),
    shares,
    payers: [{ participantIndex: payerIndex, amountCents: totalCents }],
    itemAssignments: null,
  };
}

export async function withPg<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error(
      "SUPABASE_DB_URL is not set; direct database access is required.",
    );
  }
  const client = new Client(dbUrl);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function getBalances(
  groupId: string,
): Promise<Array<{ kind: string; participant_id: string; net_cents: number }>> {
  return withPg(async (client) => {
    const result = await client.query<{
      kind: string;
      participant_id: string;
      net_cents: number;
    }>(
      "select kind, participant_id, net_cents::int " +
        "from public.group_balances where group_id = $1 " +
        "order by kind, participant_id",
      [groupId],
    );
    return result.rows;
  });
}

export async function expectRpcError(
  call: PromiseLike<{ error: { message: string } | null }>,
): Promise<string> {
  const { error } = await call;
  if (!error) {
    throw new Error("Expected RPC to fail, but it succeeded");
  }
  return error.message;
}
