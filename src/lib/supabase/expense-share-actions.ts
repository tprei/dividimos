import { createClient } from "@/lib/supabase/client";
import type { ExpenseShare } from "@/types";
import { expenseShareRowToExpenseShare } from "./mappers";

export async function loadSharesForBill(
  billId: string,
): Promise<{ shares: ExpenseShare[]; error?: string }> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("expense_shares")
    .select("*")
    .eq("bill_id", billId);

  if (error) return { shares: [], error: error.message };

  const shares = (data ?? []).map(expenseShareRowToExpenseShare);
  return { shares };
}

export async function loadSharesForGroup(
  groupId: string,
): Promise<{ shares: ExpenseShare[]; error?: string }> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("expense_shares")
    .select("*, bills!inner(group_id)")
    .eq("bills.group_id", groupId);

  if (error) return { shares: [], error: error.message };

  const shares = (data ?? []).map(expenseShareRowToExpenseShare);
  return { shares };
}

export async function loadSharesForUser(
  userId: string,
): Promise<{ shares: ExpenseShare[]; error?: string }> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("expense_shares")
    .select("*")
    .eq("user_id", userId);

  if (error) return { shares: [], error: error.message };

  const shares = (data ?? []).map(expenseShareRowToExpenseShare);
  return { shares };
}
