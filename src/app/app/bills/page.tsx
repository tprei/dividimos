import { BillsListContent } from "@/components/bills/bills-list-content";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ExpenseStatus } from "@/types";

export default async function BillsPage() {
  const user = await getAuthUser();

  if (!user) return null;

  const supabase = await createClient();

  const { data } = await supabase
    .from("expenses")
    .select("id, title, status, total_amount, created_at, creator_id")
    .order("created_at", { ascending: false });

  const bills: {
    id: string;
    title: string;
    date: string;
    total: number;
    participants: number;
    status: ExpenseStatus;
    creatorId: string;
  }[] = [];

  if (data && data.length > 0) {
    const expenseIds = data.map((e) => e.id);
    const { data: shareRows } = await supabase
      .from("expense_shares")
      .select("expense_id, user_id")
      .in("expense_id", expenseIds);

    const countMap = new Map<string, Set<string>>();
    for (const row of shareRows ?? []) {
      if (!countMap.has(row.expense_id)) {
        countMap.set(row.expense_id, new Set());
      }
      countMap.get(row.expense_id)!.add(row.user_id);
    }

    for (const expense of data) {
      bills.push({
        id: expense.id,
        title: expense.title,
        date: new Date(expense.created_at).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        total: expense.total_amount,
        participants: countMap.get(expense.id)?.size ?? 0,
        status: expense.status as ExpenseStatus,
        creatorId: expense.creator_id,
      });
    }
  }

  return <BillsListContent initialBills={bills} />;
}
