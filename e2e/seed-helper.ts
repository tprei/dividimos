import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeededUser {
  id: string;
  email: string;
  handle: string;
  name: string;
  pixKeyType: "cpf" | "email" | "random";
  pixKeyHint: string;
  onboarded: boolean;
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
  pixKeyType?: "cpf" | "email" | "random";
  onboarded?: boolean;
}

export interface CreateExpenseOptions {
  title?: string;
  expenseType?: "single_amount" | "itemized";
  totalAmount?: number;
  serviceFeePercent?: number;
  fixedFees?: number;
  shares?: Record<string, number>;
  payers?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTestId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

// ---------------------------------------------------------------------------
// SeedHelper
// ---------------------------------------------------------------------------

export class SeedHelper {
  private admin: SupabaseClient;
  private supabaseUrl: string;
  private supabaseAnonKey: string;

  private userIds: string[] = [];
  private groupIds: string[] = [];
  private expenseIds: string[] = [];
  private settlementIds: string[] = [];
  private sessionCache = new Map<string, string>();

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

  async createUser(options: CreateUserOptions = {}): Promise<SeededUser> {
    const testId = generateTestId();
    const handle = options.handle ?? `synth_${testId}`;
    const name = options.name ?? `Synth ${testId.slice(0, 8)}`;
    const pixKeyType = options.pixKeyType ?? "email";
    const onboarded = options.onboarded ?? true;

    const email = `synth_${testId}@test.dividimos.local`;
    const password = `synth_${testId}_pass!`;

    const { data: authData, error: authError } =
      await this.admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: name },
      });

    if (authError || !authData.user) {
      throw new Error(`SeedHelper.createUser: auth failed: ${authError?.message}`);
    }

    const userId = authData.user.id;
    this.userIds.push(userId);

    const pixKeyHint = pixKeyType === "email" ? `synth_${testId.slice(0, 4)}***@test.dividimos.local` : `***@hint`;

    const { error: profileError } = await this.admin
      .from("users")
      .update({
        handle,
        name,
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

    this.sessionCache.set(userId, signInData.session.access_token);

    return {
      id: userId,
      email,
      handle,
      name,
      pixKeyType,
      pixKeyHint,
      onboarded,
      accessToken: signInData.session.access_token,
      refreshToken: signInData.session.refresh_token,
    };
  }

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

    await this.admin.from("group_members").insert({
      group_id: groupId,
      user_id: creatorId,
      status: "accepted",
      invited_by: creatorId,
    });

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
  // DM group creation
  // -----------------------------------------------------------------------

  async createDmGroup(
    userA: SeededUser,
    userB: SeededUser,
    options: { autoAcceptCounterparty?: boolean } = {},
  ): Promise<SeededGroup> {
    const { autoAcceptCounterparty = true } = options;

    const client = await this.authenticateAs(userA.id);

    const { data, error } = await client.rpc("get_or_create_dm_group", {
      p_other_user_id: userB.id,
    });

    if (error || !data) {
      throw new Error(
        `SeedHelper.createDmGroup: RPC failed: ${error?.message}`,
      );
    }

    const groupId = data as string;
    this.groupIds.push(groupId);

    const { data: groupRow, error: groupError } = await this.admin
      .from("groups")
      .select("name")
      .eq("id", groupId)
      .single();

    if (groupError || !groupRow) {
      throw new Error(
        `SeedHelper.createDmGroup: group fetch failed: ${groupError?.message}`,
      );
    }

    if (autoAcceptCounterparty) {
      const { error: acceptError } = await this.admin
        .from("group_members")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("group_id", groupId)
        .neq("status", "accepted");

      if (acceptError) {
        throw new Error(
          `SeedHelper.createDmGroup: auto-accept failed: ${acceptError.message}`,
        );
      }
    }

    return {
      id: groupId,
      name: groupRow.name as string,
      creatorId: userA.id,
      memberIds: [userA.id, userB.id],
    };
  }

  // -----------------------------------------------------------------------
  // Chat message creation
  // -----------------------------------------------------------------------

  async sendChatMessage(
    groupId: string,
    senderId: string,
    content: string,
  ): Promise<string> {
    const client = await this.authenticateAs(senderId);

    const { data, error } = await client
      .from("chat_messages")
      .insert({
        group_id: groupId,
        sender_id: senderId,
        content,
        message_type: "text",
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(
        `SeedHelper.sendChatMessage: insert failed: ${error?.message}`,
      );
    }

    return (data as { id: string }).id;
  }

  // -----------------------------------------------------------------------
  // Expense creation
  // -----------------------------------------------------------------------

  async createExpense(
    groupId: string,
    creatorId: string,
    participantIds: string[],
    options: CreateExpenseOptions = {},
  ): Promise<SeededExpense> {
    const testId = generateTestId();
    const totalAmount = options.totalAmount ?? 10000;
    const title = options.title ?? `Synth Expense ${testId.slice(0, 8)}`;

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

    const settlements: SeededSettlement[] = [];

    for (const bal of balances ?? []) {
      const amountCents = bal.amount_cents as number;
      if (amountCents === 0) continue;

      const fromUserId = amountCents > 0
        ? (bal.user_a as string)
        : (bal.user_b as string);
      const toUserId = amountCents > 0
        ? (bal.user_b as string)
        : (bal.user_a as string);
      const absAmount = Math.abs(amountCents);

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

  async authenticateAs(userId: string): Promise<SupabaseClient> {
    const cached = this.sessionCache.get(userId);
    if (cached) {
      return createClient(this.supabaseUrl, this.supabaseAnonKey, {
        global: {
          headers: {
            Authorization: `Bearer ${cached}`,
          },
        },
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }

    throw new Error(
      `SeedHelper.authenticateAs: no cached session for userId=${userId}. ` +
        `Only users created via SeedHelper.createUser are supported.`,
    );
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  async cleanup(): Promise<void> {
    if (this.settlementIds.length > 0) {
      await this.admin
        .from("settlements")
        .delete()
        .in("id", this.settlementIds);
    }

    if (this.expenseIds.length > 0) {
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

    if (this.userIds.length > 0) {
      await this.admin
        .from("users")
        .delete()
        .in("id", this.userIds);

      for (const userId of this.userIds) {
        await this.admin.auth.admin.deleteUser(userId);
      }
    }

    this.settlementIds = [];
    this.expenseIds = [];
    this.groupIds = [];
    this.userIds = [];
    this.sessionCache.clear();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

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

}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

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
