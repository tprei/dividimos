import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  decodeExpenseGraphSaveResult,
  type ExpenseCents,
  type ExpenseGraphSaveResult,
  type GraphRevision,
  type NormalizedExpenseItem,
  type ServiceFeeBasisPoints,
} from "@/lib/expense-money";
import type {
  CanonicalGuestShareRow,
  CanonicalPayerRow,
  CanonicalShareRow,
  ParticipantOrderEntry,
} from "@/lib/expense-graph";
import {
  expenseRowToExpense,
  expenseItemRowToExpenseItem,
  expenseShareRowToExpenseShare,
  expensePayerRowToExpensePayer,
  expenseGuestRowToExpenseGuest,
  expenseGuestShareRowToExpenseGuestShare,
  userProfileRowToUserProfile,
} from "@/lib/supabase/expense-mappers";
import type {
  Expense,
  ExpenseItem,
  ExpenseType,
  ExpenseWithDetails,
  UserProfile,
} from "@/types";
import type { Database } from "@/types/database";

type ExpenseRow = Database["public"]["Tables"]["expenses"]["Row"];
type ExpenseItemRow = Database["public"]["Tables"]["expense_items"]["Row"];
type ExpenseShareRow = Database["public"]["Tables"]["expense_shares"]["Row"];
type ExpensePayerRow = Database["public"]["Tables"]["expense_payers"]["Row"];
type ExpenseGuestRow = Database["public"]["Tables"]["expense_guests"]["Row"];
type ExpenseGuestShareRow = Database["public"]["Tables"]["expense_guest_shares"]["Row"];
type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

// ============================================================
// Save / Update draft expense
// ============================================================

type GraphSaveExpenseWire = Readonly<{
  group_id: string;
  title: string;
  merchant_name: string | null;
  expense_type: ExpenseType;
  total_amount: ExpenseCents;
  service_fee_basis_points: ServiceFeeBasisPoints;
  fixed_fees: ExpenseCents;
}>;

type GraphSaveItemWire = Readonly<{
  description: string;
  quantity: number;
  unit_price_cents: ExpenseCents;
  total_price_cents: ExpenseCents;
}>;

type GraphSaveShareWire = Readonly<{
  user_id: string;
  share_amount_cents: ExpenseCents;
}>;

type GraphSavePayerWire = Readonly<{
  user_id: string;
  amount_cents: ExpenseCents;
}>;

type GraphSaveGuestWire = Readonly<{
  local_id: string;
  display_name: string;
}>;

type GraphSaveGuestShareWire = Readonly<{
  local_id: string;
  share_amount_cents: ExpenseCents;
}>;

type GraphSaveParticipantOrderWire =
  | Readonly<{ kind: "user"; user_id: string }>
  | Readonly<{ kind: "guest"; guest_local_id: string }>;

type GraphSaveRpcArgs = Record<string, unknown> &
  Readonly<{
    p_expense: GraphSaveExpenseWire | (GraphSaveExpenseWire & Readonly<{ id: string }>);
    p_items: readonly GraphSaveItemWire[];
    p_shares: readonly GraphSaveShareWire[];
    p_payers: readonly GraphSavePayerWire[];
    p_guests: readonly GraphSaveGuestWire[];
    p_guest_shares: readonly GraphSaveGuestShareWire[];
    p_participant_order: readonly GraphSaveParticipantOrderWire[];
    p_expected_graph_revision: GraphRevision;
    p_save_operation_id: string;
  }>;

type ExpenseGraphSaveDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      save_expense_draft_graph: {
        Args: GraphSaveRpcArgs;
        Returns: unknown;
      };
    };
  };
};

type ExpenseGraphSaveClient = SupabaseClient<ExpenseGraphSaveDatabase>;

export type SaveExpenseDraftGuest = Readonly<{
  localId: string;
  displayName: string;
}>;

export interface SaveExpenseDraftParams {
  readonly groupId: string;
  readonly title: string;
  readonly merchantName?: string | null;
  readonly expenseType: ExpenseType;
  readonly totalAmountCents: ExpenseCents;
  readonly serviceFeeBasisPoints: ServiceFeeBasisPoints;
  readonly fixedFeesCents: ExpenseCents;
  readonly existingExpenseId?: string;
  readonly items?: readonly NormalizedExpenseItem[];
  readonly shares?: readonly CanonicalShareRow[];
  readonly payers?: readonly CanonicalPayerRow[];
  readonly guests?: readonly SaveExpenseDraftGuest[];
  readonly guestShares?: readonly CanonicalGuestShareRow[];
  readonly participantOrder: readonly ParticipantOrderEntry[];
  readonly expectedGraphRevision: GraphRevision;
  readonly saveOperationId: string;
}

function graphSaveErrorMessage(code: string | undefined): string {
  switch (code) {
    case "PST01":
      return "Faça login para salvar o rascunho.";
    case "PST02":
      return "Os dados do rascunho são inválidos.";
    case "PST03":
      return "Os valores da despesa são inválidos.";
    case "PST04":
      return "Os pagadores precisam participar da despesa.";
    case "PST05":
      return "Você não tem permissão para salvar este rascunho.";
    case "PST06":
      return "Esta operação de salvamento entrou em conflito.";
    case "PST07":
      return "Não foi possível salvar este rascunho.";
    case "PST08":
      return "Este rascunho foi alterado. Atualize antes de salvar.";
    default:
      return "Erro ao salvar rascunho";
  }
}

export async function saveExpenseDraft(
  params: SaveExpenseDraftParams,
): Promise<ExpenseGraphSaveResult | { error: string }> {
  const pExpenseBase: GraphSaveExpenseWire = {
    group_id: params.groupId,
    title: params.title,
    merchant_name: params.merchantName ?? null,
    expense_type: params.expenseType,
    total_amount: params.totalAmountCents,
    service_fee_basis_points: params.serviceFeeBasisPoints,
    fixed_fees: params.fixedFeesCents,
  };
  const pExpense =
    params.existingExpenseId === undefined
      ? pExpenseBase
      : { id: params.existingExpenseId, ...pExpenseBase };
  const pItems = (params.items ?? []).map<GraphSaveItemWire>((item) => ({
    description: item.description,
    quantity: item.quantity,
    unit_price_cents: item.unitPriceCents,
    total_price_cents: item.totalPriceCents,
  }));
  const pShares = (params.shares ?? []).map<GraphSaveShareWire>((share) => ({
    user_id: share.userId,
    share_amount_cents: share.shareAmountCents,
  }));
  const pPayers: GraphSavePayerWire[] = [];
  for (const payer of params.payers ?? []) {
    if (payer.amountCents > 0) {
      pPayers.push({ user_id: payer.userId, amount_cents: payer.amountCents });
    }
  }
  const pGuests = (params.guests ?? []).map<GraphSaveGuestWire>((guest) => ({
    local_id: guest.localId,
    display_name: guest.displayName,
  }));
  const pGuestShares = (params.guestShares ?? []).map<GraphSaveGuestShareWire>(
    (guestShare) => ({
      local_id: guestShare.guestLocalId,
      share_amount_cents: guestShare.shareAmountCents,
    }),
  );
  const pParticipantOrder = params.participantOrder.map<GraphSaveParticipantOrderWire>(
    (participant) =>
      participant.kind === "user"
        ? { kind: "user", user_id: participant.userId }
        : { kind: "guest", guest_local_id: participant.guestLocalId },
  );
  const rpcArgs: GraphSaveRpcArgs = {
    p_expense: pExpense,
    p_items: pItems,
    p_shares: pShares,
    p_payers: pPayers,
    p_guests: pGuests,
    p_guest_shares: pGuestShares,
    p_participant_order: pParticipantOrder,
    p_expected_graph_revision: params.expectedGraphRevision,
    p_save_operation_id: params.saveOperationId,
  };

  // Generated database types intentionally lag this forward-only RPC migration.
  // Its result stays unknown until the strict decoder accepts it.
  const supabase = createClient() as unknown as ExpenseGraphSaveClient;
  const { data, error } = await supabase.rpc("save_expense_draft_graph", rpcArgs);

  if (error) {
    return { error: graphSaveErrorMessage(error.code) };
  }

  const result = decodeExpenseGraphSaveResult(data);
  if (!result.ok) {
    return { error: "Erro ao salvar rascunho" };
  }

  return result.value;
}

// ============================================================
// Load a single expense with all details
// ============================================================

/** Row shape returned by the nested select on expenses. */
interface ExpenseWithRelations {
  id: string;
  group_id: string;
  creator_id: string;
  title: string;
  merchant_name: string | null;
  expense_type: "itemized" | "single_amount";
  total_amount: number;
  fixed_fees: number;
  status: "draft" | "active" | "settled";
  created_at: string;
  updated_at: string;
  expense_items: ExpenseItemRow[];
  expense_shares: ExpenseShareRow[];
  expense_payers: ExpensePayerRow[];
}

export async function loadExpense(
  expenseId: string,
): Promise<ExpenseWithDetails | null> {
  const supabase = createClient();

  const [{ data }, { data: guestRows }, { data: guestShareRows }] = await Promise.all([
    supabase
      .from("expenses")
      .select("*, expense_items(*), expense_shares(*), expense_payers(*)")
      .eq("id", expenseId)
      .single(),
    supabase
      .from("expense_guests")
      .select("*")
      .eq("expense_id", expenseId),
    supabase
      .from("expense_guest_shares")
      .select("*")
      .eq("expense_id", expenseId),
  ]);

  if (!data) return null;

  const row = data as unknown as ExpenseWithRelations;

  // Collect all user IDs from shares and payers
  const userIds = [
    ...new Set([
      row.creator_id,
      ...row.expense_shares.map((s) => s.user_id),
      ...row.expense_payers.map((p) => p.user_id),
    ]),
  ];

  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("*")
    .in("id", userIds);

  const profileMap = new Map<string, UserProfile>();
  for (const p of (profiles ?? []) as unknown as UserProfileRow[]) {
    const profile = userProfileRowToUserProfile(p);
    profileMap.set(profile.id, profile);
  }

  const fallbackProfile = (userId: string): UserProfile => ({
    id: userId,
    handle: "",
    name: "Desconhecido",
  });

  const expense = expenseRowToExpense(row as unknown as ExpenseRow);

  const items: ExpenseItem[] = row.expense_items.map(expenseItemRowToExpenseItem);

  const shares = row.expense_shares.map((s) => ({
    ...expenseShareRowToExpenseShare(s),
    user: profileMap.get(s.user_id) ?? fallbackProfile(s.user_id),
  }));

  const payers = row.expense_payers.map((p) => ({
    ...expensePayerRowToExpensePayer(p),
    user: profileMap.get(p.user_id) ?? fallbackProfile(p.user_id),
  }));

  const guestShareMap = new Map<string, ExpenseGuestShareRow>();
  for (const gs of (guestShareRows ?? []) as ExpenseGuestShareRow[]) {
    guestShareMap.set(gs.guest_id, gs);
  }

  const guests = ((guestRows ?? []) as ExpenseGuestRow[]).map((g) => {
    const guest = expenseGuestRowToExpenseGuest(g);
    const guestShareRow = guestShareMap.get(g.id);
    return {
      ...guest,
      share: guestShareRow ? expenseGuestShareRowToExpenseGuestShare(guestShareRow) : undefined,
    };
  });

  return { ...expense, items, shares, payers, guests };
}

// ============================================================
// Delete an expense (drafts only — RLS enforces creator check)
// ============================================================

export async function deleteExpense(
  expenseId: string,
): Promise<{ error?: string }> {
  const supabase = createClient();

  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", expenseId)
    .eq("status", "draft");

  if (error) {
    console.error("Failed to delete expense:", error);
    return { error: "Erro ao excluir rascunho" };
  }

  return {};
}

// ============================================================
// List group expenses (non-draft)
// ============================================================

export async function listGroupExpenses(
  groupId: string,
): Promise<{ expenses: Expense[]; participants: UserProfile[] }> {
  const supabase = createClient();

  const { data: expenseRows } = await supabase
    .from("expenses")
    .select("*")
    .eq("group_id", groupId)
    .neq("status", "draft")
    .order("created_at", { ascending: false });

  const expenses = ((expenseRows ?? []) as ExpenseRow[]).map(expenseRowToExpense);

  if (expenses.length === 0) {
    return { expenses, participants: [] };
  }

  // Fetch shares to find all participants in these expenses
  const expenseIds = expenses.map((e) => e.id);

  const [sharesResult, payersResult] = await Promise.all([
    supabase
      .from("expense_shares")
      .select("user_id")
      .in("expense_id", expenseIds),
    supabase
      .from("expense_payers")
      .select("user_id")
      .in("expense_id", expenseIds),
  ]);

  const participantIds = [
    ...new Set([
      ...expenses.map((e) => e.creatorId),
      ...(sharesResult.data ?? []).map((s) => s.user_id),
      ...(payersResult.data ?? []).map((p) => p.user_id),
    ]),
  ];

  let participants: UserProfile[] = [];
  if (participantIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("*")
      .in("id", participantIds);

    participants = ((profiles ?? []) as unknown as UserProfileRow[]).map(
      userProfileRowToUserProfile,
    );
  }

  return { expenses, participants };
}
