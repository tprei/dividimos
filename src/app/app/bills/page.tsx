import { BillsListContent } from "@/components/bills/bills-list-content";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { BillStatus } from "@/types";

export default async function BillsPage() {
  const user = await getAuthUser();

  if (!user) return null;

  const supabase = await createClient();

  const { data } = await supabase
    .from("bills")
    .select("id, title, status, total_amount, created_at, creator_id")
    .order("created_at", { ascending: false });

  const bills: {
    id: string;
    title: string;
    date: string;
    total: number;
    participants: number;
    status: BillStatus;
    creatorId: string;
  }[] = [];

  if (data && data.length > 0) {
    const billIds = data.map((b) => b.id);
    const { data: participantRows } = await supabase
      .from("bill_participants")
      .select("bill_id")
      .in("bill_id", billIds);

    const countMap = new Map<string, number>();
    for (const row of participantRows ?? []) {
      countMap.set(row.bill_id, (countMap.get(row.bill_id) ?? 0) + 1);
    }

    for (const bill of data) {
      bills.push({
        id: bill.id,
        title: bill.title,
        date: new Date(bill.created_at).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        total: bill.total_amount,
        participants: countMap.get(bill.id) ?? 0,
        status: bill.status as BillStatus,
        creatorId: bill.creator_id,
      });
    }
  }

  return <BillsListContent initialBills={bills} />;
}
