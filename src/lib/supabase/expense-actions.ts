import { createClient } from "@/lib/supabase/client";
import {
  expenseRowToExpense,
  expenseItemRowToExpenseItem,
  expenseShareRowToExpenseShare,
  expensePayerRowToExpensePayer,
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

type ExpenseInsert = Database["public"]["Tables"]["expenses"]["Insert"];
type ExpenseUpdate = Database["public"]["Tables"]["expenses"]["Update"];
type ExpenseRow = Database["public"]["Tables"]["expenses"]["Row"];
type ExpenseItemRow = Database["public"]["Tables"]["expense_items"]["Row"];
type ExpenseShareRow = Database["public"]["Tables"]["expense_shares"]["Row"];
type ExpensePayerRow = Database["public"]["Tables"]["expense_payers"]["Row"];
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
}

export async function saveExpenseDraft(
  params: SaveExpenseDraftParams,
): Promise<{ expenseId: string } | { error: string }> {
  const supabase = createClient();
  const {
    groupId,
    creatorId,
    title,
    merchantName,
    expenseType,
    totalAmount,
    serviceFeePercent,
    fixedFees,
    existingExpenseId,
  } = params;

  let expenseId = existingExpenseId;

  if (expenseId) {
    // Update existing draft
    const updatePayload: ExpenseUpdate = {
      title,
      merchant_name: merchantName || null,
      expense_type: expenseType,
      total_amount: totalAmount,
      service_fee_percent: serviceFeePercent,
      fixed_fees: fixedFees,
    };

    const { error } = await supabase
      .from("expenses")
      .update(updatePayload)
      .eq("id", expenseId)
      .eq("status", "draft");

    if (error) {
      console.error("Failed to update expense draft:", error);
      return { error: error.message };
    }
  } else {
    // Insert new draft
    const insertPayload: ExpenseInsert = {
      group_id: groupId,
      creator_id: creatorId,
      title,
      merchant_name: merchantName || null,
      expense_type: expenseType,
      total_amount: totalAmount,
      service_fee_percent: serviceFeePercent,
      fixed_fees: fixedFees,
      status: "draft",
    };

    const { data: inserted, error } = await supabase
      .from("expenses")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error || !inserted) {
      console.error("Failed to insert expense draft:", error);
      return { error: error?.message ?? "Erro ao salvar rascunho" };
    }
    expenseId = inserted.id;
  }

  // Persist child data (items, shares, payers) so drafts are fully resumable
  const childError = await saveExpenseChildData(supabase, expenseId!, params);
  if (childError) {
    return { error: childError };
  }

  return { expenseId: expenseId! };
}

async function saveExpenseChildData(
  supabase: ReturnType<typeof createClient>,
  expenseId: string,
  params: SaveExpenseDraftParams,
): Promise<string | null> {
  const { items, shares, payers } = params;

  // Delete-and-reinsert for simplicity (draft only, no concurrent access concerns)
  // Run deletes in parallel since they're independent
  await Promise.all([
    supabase.from("expense_items").delete().eq("expense_id", expenseId),
    supabase.from("expense_shares").delete().eq("expense_id", expenseId),
    supabase.from("expense_payers").delete().eq("expense_id", expenseId),
  ]);

  const inserts: PromiseLike<{ error: { message: string } | null }>[] = [];

  // Insert items
  if (items && items.length > 0) {
    const itemRows = items.map((item) => ({
      expense_id: expenseId,
      description: item.description,
      quantity: item.quantity,
      unit_price_cents: item.unitPriceCents,
      total_price_cents: item.totalPriceCents,
    }));
    inserts.push(supabase.from("expense_items").insert(itemRows).then(({ error }) => ({ error })));
  }

  // Insert shares
  if (shares && shares.length > 0) {
    const shareRows = shares.map((s) => ({
      expense_id: expenseId,
      user_id: s.userId,
      share_amount_cents: s.shareAmountCents,
    }));
    inserts.push(supabase.from("expense_shares").insert(shareRows).then(({ error }) => ({ error })));
  }

  // Insert payers
  if (payers && payers.length > 0) {
    const payerRows = payers.map((p) => ({
      expense_id: expenseId,
      user_id: p.userId,
      amount_cents: p.amountCents,
    }));
    inserts.push(supabase.from("expense_payers").insert(payerRows).then(({ error }) => ({ error })));
  }

  // Run all inserts in parallel
  const results = await Promise.all(inserts);
  const firstError = results.find((r) => r.error);
  if (firstError?.error) {
    console.error("Failed to save expense child data:", firstError.error);
    return firstError.error.message;
  }

  return null;
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

  const { data } = await supabase
    .from("expenses")
    .select(
      "*, expense_items(*), expense_shares(*), expense_payers(*)",
    )
    .eq("id", expenseId)
    .single();

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
    profileMap.set(p.id, userProfileRowToUserProfile(p));
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

  return { ...expense, items, shares, payers, guests: [] };
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
