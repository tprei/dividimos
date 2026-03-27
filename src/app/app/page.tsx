import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { BillStatus } from "@/types";

export default async function AppHome() {
  const user = await getAuthUser();

  if (!user) return null;

  const supabase = await createClient();

  const [billsResult, debtOwedResult, debtToMeResult] = await Promise.all([
    supabase
      .from("bills")
      .select("id, title, status, total_amount, created_at, creator_id")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("ledger")
      .select("amount_cents")
      .eq("from_user_id", user.id)
      .neq("status", "settled"),
    supabase
      .from("ledger")
      .select("amount_cents")
      .eq("to_user_id", user.id)
      .neq("status", "settled"),
  ]);

  const myBills = billsResult.data ?? [];
  let bills: {
    id: string;
    title: string;
    date: string;
    total: number;
    participants: number;
    status: BillStatus;
    myBalance: number;
    creatorId: string;
  }[] = [];

  if (myBills.length > 0) {
    const billIds = myBills.map((b) => b.id);
    const { data: participantRows } = await supabase
      .from("bill_participants")
      .select("bill_id")
      .in("bill_id", billIds);

    const countMap = new Map<string, number>();
    for (const row of participantRows ?? []) {
      countMap.set(row.bill_id, (countMap.get(row.bill_id) ?? 0) + 1);
    }

    bills = myBills.map((bill) => ({
      id: bill.id,
      title: bill.title,
      date: new Date(bill.created_at).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
      }),
      total: bill.total_amount,
      participants: countMap.get(bill.id) ?? 0,
      status: bill.status as BillStatus,
      myBalance: 0,
      creatorId: bill.creator_id,
    }));
  }

  const iOwe = (debtOwedResult.data ?? []).reduce((s, d) => s + d.amount_cents, 0);
  const theyOweMe = (debtToMeResult.data ?? []).reduce((s, d) => s + d.amount_cents, 0);
  const netBalance = theyOweMe - iOwe;

  return <DashboardContent initialBills={bills} initialNetBalance={netBalance} />;
}
