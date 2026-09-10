"use client";

import { useMemo } from "react";
import type { ReviewIssue } from "@/components/bill/itemized/review-section";
import type { ItemizedSectionKey } from "@/components/bill/itemized-bill-form";
import type { ExpenseItem } from "@/types";

export interface ItemizedIssuesInput {
  title: string | undefined;
  itemCount: number;
  unresolvedItems: ExpenseItem[];
  grandTotal: number;
  paidTotal: number;
  onResolveTitle: () => void;
  onSectionChange: (section: ItemizedSectionKey) => void;
  onExpandItem: (itemId: string) => void;
}

export function useItemizedIssues({
  title,
  itemCount,
  unresolvedItems,
  grandTotal,
  paidTotal,
  onResolveTitle,
  onSectionChange,
  onExpandItem,
}: ItemizedIssuesInput): ReviewIssue[] {
  return useMemo(() => {
    const next: ReviewIssue[] = [];
    if (!title?.trim()) {
      next.push({ id: "title", message: "Informe o nome da conta", onResolve: onResolveTitle });
    }
    if (itemCount === 0) {
      next.push({ id: "items", message: "Adicione pelo menos um item", onResolve: () => onSectionChange("items") });
    }
    for (const item of unresolvedItems) {
      next.push({
        id: `division-${item.id}`,
        message: `${item.description || "Item sem nome"}: divisão pendente`,
        onResolve: () => {
          onSectionChange("split");
          onExpandItem(item.id);
        },
      });
    }
    if (grandTotal > 0 && paidTotal !== grandTotal) {
      next.push({ id: "payment", message: "O pagamento não bate com o total da conta", onResolve: () => onSectionChange("payment") });
    }
    return next;
  }, [grandTotal, itemCount, onExpandItem, onResolveTitle, onSectionChange, paidTotal, title, unresolvedItems]);
}
