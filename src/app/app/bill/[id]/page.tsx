"use client";

import { useParams } from "next/navigation";
import { ExpenseDetail } from "@/components/expense/expense-detail";

export default function BillDetailPage() {
  const params = useParams<{ id: string }>();
  return <ExpenseDetail expenseId={params.id} />;
}
