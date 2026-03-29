import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A user created by the SeedHelper. Contains all fields needed
 * for Playwright tests to authenticate and verify UI state.
 */
export interface SeededUser {
  id: string;
  email: string;
  handle: string;
  name: string;
  phone: string;
  pixKeyType: "phone" | "cpf" | "email" | "random";
  pixKeyHint: string;
  onboarded: boolean;
  /** Supabase access token — use with authenticateAs() for API calls. */
  accessToken: string;
  refreshToken: string;
}

export interface SeededGroup {
  id: string;
  name: string;
  creatorId: string;
  memberIds: string[];
}

export interface SeededExpense {
  id: string;
  groupId: string;
  creatorId: string;
  title: string;
  totalAmount: number;
  status: "draft" | "active" | "settled";
}

export interface SeededSettlement {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  status: "pending" | "confirmed";
}

export interface CreateUserOptions {
  handle?: string;
  name?: string;
  phone?: string;
  pixKeyType?: "phone" | "cpf" | "email" | "random";
  onboarded?: boolean;
}

export interface CreateExpenseOptions {
  title?: string;
  expenseType?: "single_amount" | "itemized";
  totalAmount?: number;
  serviceFeePercent?: number;
  fixedFees?: number;
  /** Map of userId → share amount in centavos. Defaults to equal split. */
  shares?: Record<string, number>;
  /** Map of userId → paid amount in centavos. Defaults to creator pays all. */
  payers?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTestId(): string {
  const ts = Date.now().toString(36).slice(-4);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}_${rand}`;
}

/**
 * Format a 11-digit phone string for Supabase auth (E.164 with +55 prefix).
 */
function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `+55${digits}`;
}

// ---------------------------------------------------------------------------
// SeedHelper
// ---------------------------------------------------------------------------

/**
 * Creates and manages test data for Playwright synthetic tests.
 *
 * Uses an admin Supabase client (service role key) to bypass RLS
 * and directly insert into all tables. Each instance tracks every
 * entity it creates so `cleanup()` can remove them in the right order.
 *
 * Usage:
 * ```ts
 * const seed = new SeedHelper(adminClient);
 * const alice = await seed.createUser({ handle: "alice" });
 * const bob = await seed.createUser({ handle: "bob" });
 * const group = await seed.createGroup(alice.id, [bob.id]);
 * const expense = await seed.createActiveExpense(group.id, alice.id, [alice.id, bob.id]);
 * // ... run Playwright assertions ...
 * await seed.cleanup();
 * ```
 */
export class SeedHelper {
  private admin: SupabaseClient;
  private supabaseUrl: string;
  private supabaseAnonKey: string;

  // Track created entities for cleanup (LIFO order)
  private userIds: string[] = [];
  private groupIds: string[] = [];
  private expenseIds: string[] = [];
  private settlementIds: string[] = [];

  constructor(admin: SupabaseClient) {
    this.admin = admin;
    this.supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    this.supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    if (!this.supabaseUrl || !this.supabaseAnonKey) {
      throw new Error(
        "SeedHelper requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
      );
    }
  }

  // -----------------------------------------------------------------------
  // User creation
  // -----------------------------------------------------------------------

  /**
   * Create a test user with auth credentials, profile, and Pix key hint.
   * The user is fully onboarded by default and ready for login via
   * `/api/dev/login` or direct Supabase auth.
   */
  async createUser(options: CreateUserOptions = {}): Promise<SeededUser> {
    const testId = generateTestId();
    const handle = options.handle ?? `synth_${testId}`;
    const name = options.name ?? `Synth ${testId.slice(0, 8)}`;
    const phone = options.phone ?? `119${testId.replace(/_/g, "").slice(0, 8)}`;
    const pixKeyType = options.pixKeyType ?? "phone";
    const onboarded = options.onboarded ?? true;

    // 1. Create auth user with phone
    const email = `synth_${testId}@test.pixwise.local`;
    const password = `synth_${testId}_pass!`;

    const { data: authData, error: authError } =
      await this.admin.auth.admin.createUser({
        email,
        phone: toE164(phone),
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { full_name: name },
      });

    if (authError || !authData.user) {
      throw new Error(`SeedHelper.createUser: auth failed: ${authError?.message}`);
    }

    const userId = authData.user.id;
    this.userIds.push(userId);

    // 2. Update profile
    const pixKeyHint = pixKeyType === "phone" ? `(**) *****-${phone.slice(-4)}` : `***@hint`;

    const { error: profileError } = await this.admin
      .from("users")
      .update({
        handle,
        name,
        phone,
        pix_key_type: pixKeyType,
        pix_key_hint: pixKeyHint,
        onboarded,
      })
      .eq("id", userId);

    if (profileError) {
      throw new Error(
        `SeedHelper.createUser: profile update failed: ${profileError.message}`,
      );
    }

    // 3. Set password and sign in to get tokens
    await this.admin.auth.admin.updateUserById(userId, { password });

    const anonClient = createClient(this.supabaseUrl, this.supabaseAnonKey, {
      auth: { persistSession: false },
    });

    const { data: signInData, error: signInError } =
      await anonClient.auth.signInWithPassword({ email, password });

    if (signInError || !signInData.session) {
      throw new Error(
        `SeedHelper.createUser: sign-in failed: ${signInError?.message}`,
      );
    }

    return {
      id: userId,
      email,
      handle,
      name,
      phone,
      pixKeyType,
      pixKeyHint,
      onboarded,
      accessToken: signInData.session.access_token,
      refreshToken: signInData.session.refresh_token,
    };
  }

  /**
   * Create multiple test users in parallel.
   */
  async createUsers(
    count: number,
    baseOptions: CreateUserOptions = {},
  ): Promise<SeededUser[]> {
    return Promise.all(
      Array.from({ length: count }, (_, i) =>
        this.createUser({
          ...baseOptions,
          handle: baseOptions.handle ? `${baseOptions.handle}_${i + 1}` : undefined,
          name: baseOptions.name ? `${baseOptions.name} ${i + 1}` : undefined,
        }),
      ),
    );
  }

  // -----------------------------------------------------------------------
  // Group creation
  // -----------------------------------------------------------------------

  /**
   * Create a group with the creator as an accepted member.
   * Additional member IDs are added as accepted (bypassing invite flow).
   */
  async createGroup(
    creatorId: string,
    memberIds: string[] = [],
    groupName?: string,
  ): Promise<SeededGroup> {
    const testId = generateTestId();

    const { data: groupData, error: groupError } = await this.admin
      .from("groups")
      .insert({
        name: groupName ?? `Synth Group ${testId.slice(0, 8)}`,
        creator_id: creatorId,
      })
      .select()
      .single();

    if (groupError || !groupData) {
      throw new Error(
        `SeedHelper.createGroup: insert failed: ${groupError?.message}`,
      );
    }

    const groupId = groupData.id as string;
    this.groupIds.push(groupId);

    // Add creator as accepted member
    await this.admin.from("group_members").insert({
      group_id: groupId,
      user_id: creatorId,
      status: "accepted",
      invited_by: creatorId,
    });

    // Add other members as accepted (for synthetic tests we skip invite flow)
    if (memberIds.length > 0) {
      await this.admin.from("group_members").insert(
        memberIds.map((userId) => ({
          group_id: groupId,
          user_id: userId,
          status: "accepted" as const,
          invited_by: creatorId,
        })),
      );
    }

    return {
      id: groupId,
      name: groupData.name as string,
      creatorId,
      memberIds: [creatorId, ...memberIds],
    };
  }

  // -----------------------------------------------------------------------
  // Expense creation
  // -----------------------------------------------------------------------

  /**
   * Create a draft expense with shares and payers.
   *
   * By default creates a single_amount expense split equally among
   * participantIds, with creatorId as the sole payer.
   */
  async createExpense(
    groupId: string,
    creatorId: string,
    participantIds: string[],
    options: CreateExpenseOptions = {},
  ): Promise<SeededExpense> {
    const testId = generateTestId();
    const totalAmount = options.totalAmount ?? 10000; // R$100,00
    const title = options.title ?? `Synth Expense ${testId.slice(0, 8)}`;

    // 1. Insert expense
    const { data: expenseData, error: expenseError } = await this.admin
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: creatorId,
        title,
        expense_type: options.expenseType ?? "single_amount",
        total_amount: totalAmount,
        service_fee_percent: options.serviceFeePercent ?? 0,
        fixed_fees: options.fixedFees ?? 0,
        status: "draft",
      })
      .select()
      .single();

    if (expenseError || !expenseData) {
      throw new Error(
        `SeedHelper.createExpense: insert failed: ${expenseError?.message}`,
      );
    }

    const expenseId = expenseData.id as string;
    this.expenseIds.push(expenseId);

    // 2. Insert shares
    const shares = options.shares ?? this.equalSplit(participantIds, totalAmount);
    const shareRows = Object.entries(shares).map(([userId, amount]) => ({
      expense_id: expenseId,
      user_id: userId,
      share_amount_cents: amount,
    }));

    const { error: sharesError } = await this.admin
      .from("expense_shares")
      .insert(shareRows);

    if (sharesError) {
      throw new Error(
        `SeedHelper.createExpense: shares insert failed: ${sharesError.message}`,
      );
    }

    // 3. Insert payers
    const payers = options.payers ?? { [creatorId]: totalAmount };
    const payerRows = Object.entries(payers).map(([userId, amount]) => ({
      expense_id: expenseId,
      user_id: userId,
      amount_cents: amount,
    }));

    const { error: payersError } = await this.admin
      .from("expense_payers")
      .insert(payerRows);

    if (payersError) {
      throw new Error(
        `SeedHelper.createExpense: payers insert failed: ${payersError.message}`,
      );
    }

    return {
      id: expenseId,
      groupId,
      creatorId,
      title,
      totalAmount,
      status: "draft",
    };
  }

  /**
   * Create an expense and activate it atomically via the RPC.
   *
   * The activate_expense RPC checks auth.uid() = creator, so we
   * authenticate as the creator to call it.
   */
  async createActiveExpense(
    groupId: string,
    creatorId: string,
    participantIds: string[],
    options: CreateExpenseOptions = {},
  ): Promise<SeededExpense> {
    const expense = await this.createExpense(
      groupId,
      creatorId,
      participantIds,
      options,
    );

    // Activate via RPC as the creator
    const creatorClient = await this.authenticateAs(creatorId);
    const { error: rpcError } = await creatorClient.rpc("activate_expense", {
      p_expense_id: expense.id,
    });

    if (rpcError) {
      throw new Error(
        `SeedHelper.createActiveExpense: RPC failed: ${rpcError.message}`,
      );
    }

    return { ...expense, status: "active" };
  }

  /**
   * Create an expense, activate it, then settle all resulting debts.
   *
   * Returns the expense (status: settled) and the settlement records.
   */
  async createSettledExpense(
    groupId: string,
    creatorId: string,
    participantIds: string[],
    options: CreateExpenseOptions = {},
  ): Promise<{ expense: SeededExpense; settlements: SeededSettlement[] }> {
    const expense = await this.createActiveExpense(
      groupId,
      creatorId,
      participantIds,
      options,
    );

    // Query the balances created by this expense
    const { data: balances, error: balError } = await this.admin
      .from("balances")
      .select("*")
      .eq("group_id", groupId)
      .neq("amount_cents", 0);

    if (balError) {
      throw new Error(
        `SeedHelper.createSettledExpense: balance query failed: ${balError.message}`,
      );
    }

    // Settle each non-zero balance
    const settlements: SeededSettlement[] = [];

    for (const bal of balances ?? []) {
      const amountCents = bal.amount_cents as number;
      if (amountCents === 0) continue;

      // Positive = user_a owes user_b; negative = user_b owes user_a
      const fromUserId = amountCents > 0
        ? (bal.user_a as string)
        : (bal.user_b as string);
      const toUserId = amountCents > 0
        ? (bal.user_b as string)
        : (bal.user_a as string);
      const absAmount = Math.abs(amountCents);

      // Use record_and_settle RPC as the debtor
      const debtorClient = await this.authenticateAs(fromUserId);
      const { data: settlementId, error: settleError } =
        await debtorClient.rpc("record_and_settle", {
          p_group_id: groupId,
          p_from_user_id: fromUserId,
          p_to_user_id: toUserId,
          p_amount_cents: absAmount,
        });

      if (settleError) {
        throw new Error(
          `SeedHelper.createSettledExpense: settlement RPC failed: ${settleError.message}`,
        );
      }

      const settlement: SeededSettlement = {
        id: settlementId as string,
        groupId,
        fromUserId,
        toUserId,
        amountCents: absAmount,
        status: "confirmed",
      };
      this.settlementIds.push(settlement.id);
      settlements.push(settlement);
    }

    return { expense: { ...expense, status: "settled" }, settlements };
  }

  // -----------------------------------------------------------------------
  // Auth helper
  // -----------------------------------------------------------------------

  /**
   * Get an authenticated Supabase client for a given user ID.
   * Looks up the user's access token from the tracked users,
   * or generates a new session via admin API.
   */
  async authenticateAs(userId: string): Promise<SupabaseClient> {
    // Generate a fresh session for this user
    const { data, error } =
      await this.admin.auth.admin.generateLink({
        type: "magiclink",
        email: (await this.getUserEmail(userId))!,
      });

    if (error || !data) {
      throw new Error(
        `SeedHelper.authenticateAs: generateLink failed: ${error?.message}`,
      );
    }

    // Extract token from the link and verify it to get a session
    const url = new URL(data.properties.action_link);
    const token = url.searchParams.get("token");

    if (!token) {
      throw new Error("SeedHelper.authenticateAs: no token in magic link");
    }

    const anonClient = createClient(this.supabaseUrl, this.supabaseAnonKey, {
      auth: { persistSession: false },
    });

    const { data: verifyData, error: verifyError } =
      await anonClient.auth.verifyOtp({
        token_hash: token,
        type: "magiclink",
      });

    if (verifyError || !verifyData.session) {
      throw new Error(
        `SeedHelper.authenticateAs: verify failed: ${verifyError?.message}`,
      );
    }

    return createClient(this.supabaseUrl, this.supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${verifyData.session.access_token}`,
        },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Remove all entities created by this SeedHelper instance.
   * Deletes in reverse dependency order:
   * settlements → expenses (cascades shares/payers) → groups (cascades members) → users
   */
  async cleanup(): Promise<void> {
    // 1. Settlements
    if (this.settlementIds.length > 0) {
      await this.admin
        .from("settlements")
        .delete()
        .in("id", this.settlementIds);
    }

    // 2. Expenses (cascade deletes shares, payers, items)
    if (this.expenseIds.length > 0) {
      // Delete child rows first in case there's no CASCADE
      await this.admin
        .from("expense_payers")
        .delete()
        .in("expense_id", this.expenseIds);
      await this.admin
        .from("expense_shares")
        .delete()
        .in("expense_id", this.expenseIds);
      await this.admin
        .from("expense_items")
        .delete()
        .in("expense_id", this.expenseIds);

      // Delete balances related to these groups
      if (this.groupIds.length > 0) {
        await this.admin
          .from("balances")
          .delete()
          .in("group_id", this.groupIds);
      }

      await this.admin
        .from("expenses")
        .delete()
        .in("id", this.expenseIds);
    }

    // 3. Groups (delete members first)
    if (this.groupIds.length > 0) {
      await this.admin
        .from("group_members")
        .delete()
        .in("group_id", this.groupIds);
      await this.admin
        .from("groups")
        .delete()
        .in("id", this.groupIds);
    }

    // 4. Users (public.users then auth.users)
    if (this.userIds.length > 0) {
      await this.admin
        .from("users")
        .delete()
        .in("id", this.userIds);

      for (const userId of this.userIds) {
        await this.admin.auth.admin.deleteUser(userId);
      }
    }

    // Reset tracking arrays
    this.settlementIds = [];
    this.expenseIds = [];
    this.groupIds = [];
    this.userIds = [];
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Compute equal split amounts that sum exactly to totalAmount.
   * Assigns any remainder cents to the first participant.
   */
  private equalSplit(
    participantIds: string[],
    totalAmount: number,
  ): Record<string, number> {
    const count = participantIds.length;
    const baseShare = Math.floor(totalAmount / count);
    const remainder = totalAmount - baseShare * count;

    const shares: Record<string, number> = {};
    for (let i = 0; i < count; i++) {
      shares[participantIds[i]] = baseShare + (i < remainder ? 1 : 0);
    }
    return shares;
  }

  /**
   * Look up a user's email by ID from auth.users.
   */
  private async getUserEmail(userId: string): Promise<string | null> {
    const { data, error } =
      await this.admin.auth.admin.getUserById(userId);

    if (error || !data.user) return null;
    return data.user.email ?? null;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a SeedHelper with a fresh admin client from environment variables.
 */
export function createSeedHelper(): SeedHelper {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "createSeedHelper requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return new SeedHelper(admin);
}
