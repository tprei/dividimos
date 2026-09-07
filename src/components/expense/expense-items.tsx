"use client";

import { formatBRL } from "@/lib/currency";
import {
  formatExpenseQuantity,
  type ExpenseQuantity,
} from "@/lib/expense-quantity";
import type {
  ExpenseItemAssignmentPayload,
  ExpenseItemPayload,
} from "@/types/ledger";

interface ExpenseItemsProps {
  items: ExpenseItemPayload[];
  itemAssignments: ExpenseItemAssignmentPayload[] | null;
  participantName: (participantIndex: number) => string;
}

export function ExpenseItems({
  items,
  itemAssignments,
  participantName,
}: ExpenseItemsProps) {
  const namesByItem = new Map<number, string[]>();
  if (itemAssignments) {
    for (const assignment of itemAssignments) {
      const names = namesByItem.get(assignment.itemIndex) ?? [];
      const name = participantName(assignment.participantIndex);
      if (!names.includes(name)) {
        names.push(name);
      }
      namesByItem.set(assignment.itemIndex, names);
    }
  }

  return (
    <section className="mt-5">
      <h2 className="mb-2 text-sm font-semibold">Itens</h2>
      <div className="space-y-2">
        {items.map((item, itemIndex) => {
          const assigned = namesByItem.get(itemIndex) ?? [];
          return (
            <div
              key={`${item.description}-${itemIndex}`}
              className="rounded-xl border bg-card px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{item.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.quantityMilliunits > 1000
                      ? `${formatExpenseQuantity(item.quantityMilliunits as ExpenseQuantity)}x `
                      : ""}
                    {formatBRL(item.unitPriceCents)}/un
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {formatBRL(item.totalPriceCents)}
                </span>
              </div>
              {assigned.length > 0 && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Para: {assigned.join(", ")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
