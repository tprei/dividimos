import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ExpenseStatus } from "@/types";

export default async function AppHome() {
  const user = await getAuthUser();

  if (!user) return null;

  const supabase = await createClient();

  // Fetch recent expenses and balance data in parallel
  const [expensesResult, balancesResult] = await Promise.all([
    supabase
      .from("expenses")
      .select("id, title, status, total_amount, created_at, creator_id")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("balances")
      .select("user_a, user_b, amount_cents")
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`),
  ]);

  const myExpenses = expensesResult.data ?? [];
  let bills: {
    id: string;
    title: string;
    date: string;
    total: number;
    participants: number;
    status: ExpenseStatus;
    myBalance: number;
    creatorId: string;
  }[] = [];

  if (myExpenses.length > 0) {
    const expenseIds = myExpenses.map((e) => e.id);
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

    bills = myExpenses.map((expense) => ({
      id: expense.id,
      title: expense.title,
      date: new Date(expense.created_at).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
      }),
      total: expense.total_amount,
      participants: countMap.get(expense.id)?.size ?? 0,
      status: expense.status as ExpenseStatus,
      myBalance: 0,
      creatorId: expense.creator_id,
    }));
  }

  // Compute net balance from balances table
  // Convention: positive amount_cents = user_a owes user_b
  let netBalance = 0;
  for (const row of balancesResult.data ?? []) {
    if (row.user_a === user.id) {
      // I am user_a: positive means I owe, so subtract from my balance
      netBalance -= row.amount_cents;
    } else {
      // I am user_b: positive means they owe me, so add to my balance
      netBalance += row.amount_cents;
    }
  }

  return <DashboardContent initialBills={bills} initialNetBalance={netBalance} />;
}
