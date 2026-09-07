"use client";

import { useParams } from "next/navigation";
import { ExpenseDetail } from "@/components/expense/expense-detail";

export function ExpenseDetailPage() {
  const params = useParams<{ id: string }>();
  return <ExpenseDetail expenseId={params.id} />;
}
