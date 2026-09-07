import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import type { ValidationResult } from "../src/lib/expense-money";
import { allocateEvenly } from "../src/lib/expense-money";
import { decodeChatMessage, decodeMutationAck } from "../src/lib/ledger/decode";
import { transfersFromBalances } from "../src/lib/ledger/transfers";
import type {
  BalanceRow,
  ExpenseItemAssignmentPayload,
  ExpenseItemPayload,
  ExpensePayerPayload,
  ExpensePayload,
  ExpenseStatus,
  ExpenseType,
  ParticipantRef,
  SettlementStatus,
} from "../src/types/ledger";

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
  totalCents: number;
  versionNo: number;
  status: ExpenseStatus;
}

export interface SeededSettlement {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  status: SettlementStatus;
}

export interface CreateUserOptions {
  handle?: string;
  name?: string;
  pixKeyType?: "cpf" | "email" | "random";
  onboarded?: boolean;
}

export interface CreateExpenseOptions {
  title?: string;
  merchantName?: string | null;
  occurredOn?: string;
  expenseType?: ExpenseType;
  totalCents?: number;
  serviceFeeBps?: number;
  fixedFeeCents?: number;
  participants?: ParticipantRef[];
  shares?: number[];
  payers?: ExpensePayerPayload[];
  items?: ExpenseItemPayload[];
  itemAssignments?: ExpenseItemAssignmentPayload[] | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTestId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function unwrap<T, E>(result: ValidationResult<T, E>, context: string): T {
  if (!result.ok) {
    throw new Error(`${context}: ${JSON.stringify(result.issue)}`);
  }
  return result.value;
}


// ---------------------------------------------------------------------------
// SeedHelper
// ---------------------------------------------------------------------------

export class SeedHelper {
  private admin: SupabaseClient;
  private supabaseUrl: string;
  private supabaseAnonKey: string;
  private jwtSecret: Uint8Array | null;

  private userIds: string[] = [];
  private groupIds: string[] = [];
  private sessionCache = new Map<string, string>();

  constructor(admin: SupabaseClient) {
    this.admin = admin;
    this.supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    this.supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const secret = process.env.SUPABASE_JWT_SECRET;
    this.jwtSecret = secret ? new TextEncoder().encode(secret) : null;

    if (!this.supabaseUrl || !this.supabaseAnonKey) {
      throw new Error(
        "SeedHelper requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
      );
    }
  }

  private async mintAccessToken(
    userId: string,
    email: string,
    role: string = "authenticated",
  ): Promise<string> {
    if (!this.jwtSecret) {
      throw new Error(
        "SeedHelper.mintAccessToken: SUPABASE_JWT_SECRET is required to mint JWTs",
      );
    }

    const now = Math.floor(Date.now() / 1000);

    return new SignJWT({
      sub: userId,
      email,
      role,
      aud: "authenticated",
      iss: `${this.supabaseUrl}/auth/v1`,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(this.jwtSecret);
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

    const pixKeyHint =
      pixKeyType === "email"
        ? `synth_${testId.slice(0, 4)}***@test.dividimos.local`
        : `***@hint`;

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

    let accessToken: string;
    let refreshToken: string;

    if (this.jwtSecret) {
      accessToken = await this.mintAccessToken(userId, email);
      refreshToken = "noop";
    } else {
      const password = `synth_${testId}_pass!`;
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

      accessToken = signInData.session.access_token;
      refreshToken = signInData.session.refresh_token;
    }

    this.sessionCache.set(userId, accessToken);

    return {
      id: userId,
      email,
      handle,
      name,
      pixKeyType,
      pixKeyHint,
      onboarded,
      accessToken,
      refreshToken,
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
    const name = groupName ?? `Synth Group ${testId.slice(0, 8)}`;

    const creatorClient = await this.authenticateAs(creatorId);
    const { data, error } = await creatorClient.rpc("create_group", {
      p_name: name,
      p_member_ids: memberIds,
    });

    if (error) {
      throw new Error(`SeedHelper.createGroup: create_group failed: ${error.message}`);
    }

    const ack = unwrap(
      decodeMutationAck(data),
      "SeedHelper.createGroup: malformed create_group acknowledgment",
    );

    this.groupIds.push(ack.groupId);

    for (const memberId of memberIds) {
      const memberClient = await this.authenticateAs(memberId);
      const { error: acceptError } = await memberClient.rpc("accept_invitation", {
        p_group_id: ack.groupId,
      });
      if (acceptError) {
        throw new Error(
          `SeedHelper.createGroup: accept_invitation failed for ${memberId}: ${acceptError.message}`,
        );
      }
    }

    return {
      id: ack.groupId,
      name,
      creatorId,
      memberIds: [creatorId, ...memberIds],
    };
  }

  // -----------------------------------------------------------------------
  // DM creation
  // -----------------------------------------------------------------------

  async createDmGroup(userA: SeededUser, userB: SeededUser): Promise<SeededGroup> {
    const client = await this.authenticateAs(userA.id);

    const { data, error } = await client.rpc("get_or_create_dm", {
      p_user_id: userB.id,
    });

    if (error) {
      throw new Error(`SeedHelper.createDmGroup: get_or_create_dm failed: ${error.message}`);
    }

    const ack = unwrap(
      decodeMutationAck(data),
      "SeedHelper.createDmGroup: malformed get_or_create_dm acknowledgment",
    );

    if (!this.groupIds.includes(ack.groupId)) {
      this.groupIds.push(ack.groupId);
    }

    return {
      id: ack.groupId,
      name: "",
      creatorId: userA.id,
      memberIds: [userA.id, userB.id],
    };
  }

  // -----------------------------------------------------------------------
  // Chat
  // -----------------------------------------------------------------------

  async sendChatMessage(
    groupId: string,
    senderId: string,
    content: string,
  ): Promise<string> {
    const client = await this.authenticateAs(senderId);

    const { data, error } = await client.rpc("send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_content: content,
    });

    if (error) {
      throw new Error(`SeedHelper.sendChatMessage: send_message failed: ${error.message}`);
    }

    const message = unwrap(
      decodeChatMessage(data),
      "SeedHelper.sendChatMessage: malformed send_message response",
    );

    return message.id;
  }

  // -----------------------------------------------------------------------
  // Expenses
  // -----------------------------------------------------------------------

  async createExpense(
    groupId: string,
    creatorId: string,
    participantIds: string[],
    options: CreateExpenseOptions = {},
  ): Promise<SeededExpense> {
    const testId = generateTestId();
    const title = options.title ?? `Synth Expense ${testId.slice(0, 8)}`;
    const totalCents = options.totalCents ?? 10000;
    const expenseType = options.expenseType ?? "single_amount";
    const serviceFeeBps = options.serviceFeeBps ?? 0;
    const fixedFeeCents = options.fixedFeeCents ?? 0;

    const participants: ParticipantRef[] =
      options.participants ??
      participantIds.map((userId) => ({ kind: "user" as const, userId }));

    if (participants.length === 0) {
      throw new Error("SeedHelper.createExpense: at least one participant is required");
    }

    const items = options.items ?? [];
    if (expenseType === "itemized" && items.length === 0) {
      throw new Error(
        "SeedHelper.createExpense: an itemized expense requires at least one item",
      );
    }

    const shares =
      options.shares ??
      unwrap(
        allocateEvenly(totalCents, participants.length),
        "SeedHelper.createExpense: even share allocation failed",
      ).map((cents) => cents as number);

    if (shares.length !== participants.length) {
      throw new Error(
        `SeedHelper.createExpense: ${shares.length} shares for ${participants.length} participants`,
      );
    }
    const shareTotal = shares.reduce((acc, cents) => acc + cents, 0);
    if (shareTotal !== totalCents) {
      throw new Error(
        `SeedHelper.createExpense: shares sum to ${shareTotal}, expected ${totalCents}`,
      );
    }

    let payers = options.payers;
    if (!payers) {
      const creatorIndex = participants.findIndex(
        (p) => p.kind === "user" && p.userId === creatorId,
      );
      if (creatorIndex < 0) {
        throw new Error(
          `SeedHelper.createExpense: creator ${creatorId} is not among the participants`,
        );
      }
      payers = [{ participantIndex: creatorIndex, amountCents: totalCents }];
    }
    const payerTotal = payers.reduce((acc, payer) => acc + payer.amountCents, 0);
    if (payerTotal !== totalCents) {
      throw new Error(
        `SeedHelper.createExpense: payers sum to ${payerTotal}, expected ${totalCents}`,
      );
    }

    const payload: ExpensePayload = {
      items,
      participants,
      shares,
      payers,
      itemAssignments: options.itemAssignments ?? null,
    };

    const creatorClient = await this.authenticateAs(creatorId);
    const { data, error } = await creatorClient.rpc("create_expense", {
      p_client_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_occurred_on: options.occurredOn ?? new Date().toISOString().slice(0, 10),
      p_title: title,
      p_merchant_name: options.merchantName ?? null,
      p_expense_type: expenseType,
      p_total_cents: totalCents,
      p_service_fee_bps: serviceFeeBps,
      p_fixed_fee_cents: fixedFeeCents,
      p_payload: payload,
    });

    if (error) {
      throw new Error(`SeedHelper.createExpense: create_expense failed: ${error.message}`);
    }

    const ack = unwrap(
      decodeMutationAck(data),
      "SeedHelper.createExpense: malformed create_expense acknowledgment",
    );

    if (!ack.expenseId || ack.versionNo === undefined) {
      throw new Error(
        "SeedHelper.createExpense: create_expense returned no expenseId or versionNo",
      );
    }

    return {
      id: ack.expenseId,
      groupId,
      creatorId,
      title,
      totalCents,
      versionNo: ack.versionNo,
      status: "active",
    };
  }

  async createExpenseWithConfirmedSettlements(
    groupId: string,
    creatorId: string,
    participantIds: string[],
    options: CreateExpenseOptions = {},
  ): Promise<{ expense: SeededExpense; settlements: SeededSettlement[] }> {
    const expense = await this.createExpense(
      groupId,
      creatorId,
      participantIds,
      options,
    );

    const { data: balanceRows, error: balanceError } = await this.admin
      .from("group_balances")
      .select("kind, participant_id, net_cents")
      .eq("group_id", groupId);

    if (balanceError) {
      throw new Error(
        `SeedHelper.createExpenseWithConfirmedSettlements: balance query failed: ${balanceError.message}`,
      );
    }

    const balances: BalanceRow[] = (balanceRows ?? []).map((row) => ({
      kind: row.kind as BalanceRow["kind"],
      participantId: row.participant_id as string,
      netCents: Number(row.net_cents),
    }));

    const settlements: SeededSettlement[] = [];

    for (const transfer of transfersFromBalances(balances)) {
      if (transfer.fromKind !== "user") {
        throw new Error(
          `SeedHelper.createExpenseWithConfirmedSettlements: guest ${transfer.fromId} cannot settle; ` +
            `use a user-only fixture for confirmed settlements`,
        );
      }

      const debtorClient = await this.authenticateAs(transfer.fromId);
      const { data: recordData, error: recordError } = await debtorClient.rpc(
        "record_settlement",
        {
          p_operation_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_to_user_id: transfer.toId,
          p_amount_cents: transfer.amountCents,
        },
      );

      if (recordError) {
        throw new Error(
          `SeedHelper.createExpenseWithConfirmedSettlements: record_settlement failed: ${recordError.message}`,
        );
      }

      const recordAck = unwrap(
        decodeMutationAck(recordData),
        "SeedHelper.createExpenseWithConfirmedSettlements: malformed record_settlement acknowledgment",
      );

      if (!recordAck.settlementId) {
        throw new Error(
          "SeedHelper.createExpenseWithConfirmedSettlements: record_settlement returned no settlementId",
        );
      }

      const creditorClient = await this.authenticateAs(transfer.toId);
      const { error: confirmError } = await creditorClient.rpc("confirm_settlement", {
        p_settlement_id: recordAck.settlementId,
      });

      if (confirmError) {
        throw new Error(
          `SeedHelper.createExpenseWithConfirmedSettlements: confirm_settlement failed: ${confirmError.message}`,
        );
      }

      settlements.push({
        id: recordAck.settlementId,
        groupId,
        fromUserId: transfer.fromId,
        toUserId: transfer.toId,
        amountCents: transfer.amountCents,
        status: "confirmed",
      });
    }

    return { expense, settlements };
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
    const groupIds = new Set(this.groupIds);

    if (this.userIds.length > 0) {
      const [memberships, created] = await Promise.all([
        this.admin.from("group_members").select("group_id").in("user_id", this.userIds),
        this.admin.from("groups").select("id").in("creator_id", this.userIds),
      ]);

      if (memberships.error) {
        throw new Error(
          `SeedHelper.cleanup: group membership query failed: ${memberships.error.message}`,
        );
      }
      if (created.error) {
        throw new Error(
          `SeedHelper.cleanup: created-group query failed: ${created.error.message}`,
        );
      }

      for (const row of memberships.data ?? []) groupIds.add(row.group_id as string);
      for (const row of created.data ?? []) groupIds.add(row.id as string);
    }

    if (groupIds.size > 0) {
      const { error } = await this.admin
        .from("groups")
        .delete()
        .in("id", [...groupIds]);
      if (error) {
        throw new Error(`SeedHelper.cleanup: group delete failed: ${error.message}`);
      }
    }

    if (this.userIds.length > 0) {
      const { error } = await this.admin.from("users").delete().in("id", this.userIds);
      if (error) {
        throw new Error(`SeedHelper.cleanup: user delete failed: ${error.message}`);
      }

      for (const userId of this.userIds) {
        const { error: authError } = await this.admin.auth.admin.deleteUser(userId);
        if (authError) {
          throw new Error(
            `SeedHelper.cleanup: auth user delete failed for ${userId}: ${authError.message}`,
          );
        }
      }
    }

    this.groupIds = [];
    this.userIds = [];
    this.sessionCache.clear();
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
