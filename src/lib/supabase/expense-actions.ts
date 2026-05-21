import { createClient } from "@/lib/supabase/client";
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

export interface SaveExpenseDraftParams {
  groupId: string;
  creatorId: string;
  title: string;
  merchantName?: string;
  expenseType: ExpenseType;
  totalAmount: number;
  serviceFeePercent: number;
  fixedFees: number;
  existingExpenseId?: string;
  items?: Array<{
    id?: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    totalPriceCents: number;
  }>;
  shares?: Array<{
    userId: string;
    shareAmountCents: number;
  }>;
  payers?: Array<{
    userId: string;
    amountCents: number;
  }>;
  guests?: Array<{
    localId: string;
    displayName: string;
  }>;
  guestShares?: Array<{
    guestLocalId: string;
    shareAmountCents: number;
  }>;
}

export async function saveExpenseDraft(
  params: SaveExpenseDraftParams,
): Promise<{ expenseId: string } | { error: string }> {
  const supabase = createClient();
  const {
    groupId,
    title,
    merchantName,
    expenseType,
    totalAmount,
    serviceFeePercent,
    fixedFees,
    existingExpenseId,
    items,
    shares,
    payers,
    guests,
    guestShares,
  } = params;

  const pExpense = {
    ...(existingExpenseId ? { id: existingExpenseId } : {}),
    group_id: groupId,
    title,
    merchant_name: merchantName ?? "",
    expense_type: expenseType,
    total_amount: totalAmount,
    service_fee_percent: serviceFeePercent,
    fixed_fees: fixedFees,
  };

  const pItems = (items ?? []).map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unit_price_cents: item.unitPriceCents,
    total_price_cents: item.totalPriceCents,
  }));

  const pShares = (shares ?? []).map((s) => ({
    user_id: s.userId,
    share_amount_cents: s.shareAmountCents,
  }));

  const pPayers = (payers ?? []).map((p) => ({
    user_id: p.userId,
    amount_cents: p.amountCents,
  }));

  const pGuests = (guests ?? []).map((g) => ({
    local_id: g.localId,
    display_name: g.displayName,
  }));

  const pGuestShares = (guestShares ?? []).map((gs) => ({
    local_id: gs.guestLocalId,
    share_amount_cents: gs.shareAmountCents,
  }));

  const { data, error } = await supabase.rpc("save_expense_draft", {
    p_expense: pExpense,
    p_items: pItems,
    p_shares: pShares,
    p_payers: pPayers,
    p_guests: pGuests,
    p_guest_shares: pGuestShares,
  });

  if (error) {
    console.error("Failed to save expense draft:", error);
    return { error: error.message };
  }

  const result = data as { id: string } | null;
  if (!result?.id) {
    return { error: "Erro ao salvar rascunho" };
  }

  return { expenseId: result.id };
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
  service_fee_percent: number;
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
    return { error: error.message };
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
