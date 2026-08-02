import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";
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

/**
 * Creates a canonical DM group between two users via get_or_create_dm_group,
 * the sole trusted DM-creation path (#472). Never raw-inserts into `groups`
 * with is_dm=true or into `dm_pairs` directly — both are locked down at the
 * privilege boundary and only produce a shape the deferred DM invariant
 * triggers accept.
 */
export async function createTestDmGroup(
  userA: TestUser,
  userB: TestUser,
  options: { bothAccepted?: boolean } = {},
): Promise<Database["public"]["Tables"]["groups"]["Row"]> {
  if (!isIntegrationTestReady || !adminClient) {
    throw new Error("Integration tests require Supabase environment variables.");
  }

  const { bothAccepted = true } = options;

  const callerClient = authenticateAs(userA);
  const { data: groupId, error } = await callerClient.rpc("get_or_create_dm_group", {
    p_other_user_id: userB.id,
  });

  if (error || !groupId) {
    throw new Error(`Failed to create test DM group: ${error?.message}`);
  }

  if (bothAccepted) {
    const otherClient = authenticateAs(userB);
    await otherClient.rpc("accept_group_invitation", { p_group_id: groupId });
  }

  const { data: groupData, error: groupError } = await adminClient
    .from("groups")
    .select()
    .eq("id", groupId)
    .single();

  if (groupError || !groupData) {
    throw new Error(`Failed to load test DM group: ${groupError?.message}`);
  }

  return groupData as Database["public"]["Tables"]["groups"]["Row"];
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
 * Creates an expense with shares and payers, then activates it, entirely
 * through the same public RPCs the real app uses (save_expense_draft_graph
 * then activate_saved_expense). Issue #477's expense-graph mutation-token
 * guard makes every direct INSERT/UPDATE/DELETE against expenses/
 * expense_items/expense_shares/expense_payers/expense_guests/
 * expense_guest_shares/expense_allocation_entities/
 * expense_balance_allocation_plans/expense_balance_allocations require an
 * already-open, per-session mutation token; a service_role PostgREST
 * client issuing separate HTTP requests never reliably shares one
 * database session, so raw table writes here are structurally
 * unreliable now. RPCs open/close their own token internally.
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

  // Payers are participant rows. Preserve payer-only fixtures as explicit
  // zero-share registered users rather than creating unreachable payers.
  const reachableShares = new Map(shares.map((share) => [share.userId, share.amount]));
  for (const payer of payers) {
    if (!reachableShares.has(payer.userId)) {
      reachableShares.set(payer.userId, 0);
    }
  }

  const creatorClient = authenticateAs(creator);

  const { data: saveResult, error: saveError } = await creatorClient.rpc("save_expense_draft_graph", {
    p_expense: {
      group_id: groupId,
      title: title ?? `Test Expense ${testId}`,
      merchant_name: null,
      expense_type: expenseType,
      total_amount: totalAmount,
      service_fee_basis_points: Math.round(serviceFeePercent * 100),
      fixed_fees: fixedFees,
    },
    p_items: [],
    p_shares: [...reachableShares].map(([userId, amount]) => ({
      user_id: userId,
      share_amount_cents: amount,
    })),
    p_payers: payers.map((p) => ({ user_id: p.userId, amount_cents: p.amount })),
    p_guests: [],
    p_guest_shares: [],
    p_participant_order: [],
    p_expected_graph_revision: 0,
    p_save_operation_id: crypto.randomUUID(),
  });

  if (saveError || !saveResult) {
    throw new Error(`Failed to create expense: ${saveError?.message}`);
  }

  const expenseId = (saveResult as { id: string; graph_revision: number }).id;
  const graphRevision = (saveResult as { id: string; graph_revision: number }).graph_revision;

  const { error: rpcError } = await creatorClient.rpc("activate_saved_expense", {
    p_expense_id: expenseId,
    p_expected_graph_revision: graphRevision,
  });

  if (rpcError) {
    throw new Error(`Failed to activate expense: ${rpcError.message}`);
  }

  return expenseId;
}

/**
 * Deletes test expenses directly, for suites that need raw teardown rather
 * than the app's own delete paths. #477's expense-graph mutation-token
 * guard requires an already-open direct token for any raw DELETE against
 * `expenses` (and its cascading children); `pg_temp`'s `ON COMMIT DELETE
 * ROWS` wipes that token at the end of the transaction it opened in, so
 * the open and the delete must share one explicit transaction, never two
 * separate autocommit statements. Also scrubs any live `committed`
 * expense_graph_save_operations ledger rows first: that table's
 * expense_id FK is `ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED`, so
 * an un-scrubbed row aborts the delete at COMMIT.
 */
export async function deleteTestExpenses(pg: Client, expenseIds: string[]): Promise<void> {
  if (expenseIds.length === 0) return;
  await pg.query("BEGIN");
  try {
    await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [expenseIds]);
    await pg.query(
      `update public.expense_graph_save_operations
          set outcome = 'retired',
              canonical_request = null,
              request_digest = null,
              expense_id = null,
              graph_revision = null,
              result = null,
              result_created_at = null,
              retired_reason = 'expense_deleted',
              retired_at = statement_timestamp()
        where expense_id = any($1::uuid[]) and outcome = 'committed'`,
      [expenseIds],
    );
    await pg.query("delete from public.expenses where id = any($1::uuid[])", [expenseIds]);
    await pg.query("COMMIT");
  } catch (error) {
    await pg.query("ROLLBACK").catch(() => {});
    throw error;
  }
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
  operationId?: string;
}

/**
 * Calls the replay-safe batch settlement RPC and returns its one settlement ID.
 */
export async function settleDebt(options: SettleDebtOptions): Promise<string> {
  if (!isIntegrationTestReady) {
    throw new Error("Integration tests require Supabase environment variables.");
  }

  const {
    caller,
    groupId,
    fromUserId,
    toUserId,
    amountCents,
    operationId = crypto.randomUUID(),
  } = options;
  const callerClient = authenticateAs(caller);

  const { data, error } = await callerClient.rpc("record_settlements", {
    p_allocations: [{
      group_id: groupId,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount_cents: amountCents,
    }],
    p_operation_id: operationId,
  });

  if (error) {
    throw new Error(`record_settlements failed: ${error.message}`);
  }
  if (!data || data.length !== 1 || typeof data[0].settlement_id !== "string") {
    throw new Error("record_settlements did not return exactly one settlement.");
  }

  return data[0].settlement_id;
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

  const { error } = await userClient.rpc("accept_group_invitation", {
    p_group_id: groupId,
  });

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

/**
 * Issue a v1 guest-claim credential (gst1_...) as the expense creator.
 * Replaces the legacy group-readable expense_guests.claim_token: an
 * unclaimed active guest now has no usable token until the creator
 * explicitly issues one through issue_guest_claim_token (#581). Used by
 * integration tests to obtain a claimable bearer before calling
 * claim_guest_spot(text). Throws on any error or non-`issued` outcome.
 */
export async function issueGuestClaimToken(
  creator: TestUser,
  guestId: string,
): Promise<string> {
  const client = authenticateAs(creator);
  const { data, error } = await client.rpc("issue_guest_claim_token", {
    p_guest_id: guestId,
    p_rotate: false,
    // SQL arg is nullable integer; gen-types renders it as non-null number,
    // so cast. Initial issue requires NULL here (see issue_guest_claim_token).
    p_expected_generation: null as unknown as number,
  });
  if (error || !data) {
    throw new Error(`Failed to issue guest claim token: ${error?.message}`);
  }
  const result = data as {
    outcome: string;
    token?: string;
    generation?: number;
  };
  if (result.outcome !== "issued" || typeof result.token !== "string") {
    throw new Error(
      `issue_guest_claim_token returned unexpected outcome: ${JSON.stringify(result)}`,
    );
  }
  return result.token;
}
