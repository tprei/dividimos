"use client";

import { AnimatePresence } from "framer-motion";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AddItemForm } from "@/components/bill/add-item-form";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { formatExpenseQuantity, type ExpenseQuantity } from "@/lib/expense-quantity";
import { centsText } from "@/lib/item-division";
import type { ExpenseItem } from "@/types";

export interface ItemsSectionProps {
  items: ExpenseItem[];
  amountTexts: Record<string, string>;
  invalidAmountIds: string[];
  serviceFeeText: string;
  serviceFeeCents: number;
  fixedFees: number;
  grandTotal: number;
  onDescriptionChange: (itemId: string, description: string) => void;
  onAmountChange: (itemId: string, text: string) => void;
  onServiceFeeChange: (text: string) => void;
  onRemoveItem: (itemId: string) => void;
  onAddItem: (item: {
    description: string;
    quantity: number;
    unitPriceCents: number;
    totalPriceCents: number;
  }) => void;
}

export function ItemsSection({
  items,
  amountTexts,
  invalidAmountIds,
  serviceFeeText,
  serviceFeeCents,
  fixedFees,
  grandTotal,
  onDescriptionChange,
  onAmountChange,
  onServiceFeeChange,
  onRemoveItem,
  onAddItem,
}: ItemsSectionProps) {
  const [addingItem, setAddingItem] = useState(items.length === 0);

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="divide-y divide-border overflow-hidden rounded-[0.75rem] border bg-card">
        {items.length > 0 && (
          <ul aria-label="Itens" className="divide-y divide-border">
            {items.map((item) => {
              const invalid = invalidAmountIds.includes(item.id);
              const name = item.description || "item";
              const amountText = amountTexts[item.id] ?? centsText(item.totalPriceCents);
              return (
                <li key={item.id} className="py-1 pr-1 pl-3">
                  <div className="flex min-h-11 items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <input
                        value={item.description}
                        onChange={(event) => onDescriptionChange(item.id, event.target.value)}
                        aria-label={`Nome do item ${item.description || "sem nome"}`}
                        className="-mx-1 h-8 w-full min-w-0 truncate rounded-[0.5rem] bg-transparent px-1 text-base font-semibold outline-none focus-visible:bg-muted/70 md:text-sm"
                      />
                      {item.quantity !== 1000 && (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {formatExpenseQuantity(item.quantity as ExpenseQuantity)} × {formatBRL(item.unitPriceCents)}
                        </p>
                      )}
                    </div>
                    <label className="flex h-9 max-w-[7.5rem] shrink-0 items-center justify-end gap-1 rounded-[0.5rem] px-2 focus-within:bg-muted/70 has-aria-invalid:ring-2 has-aria-invalid:ring-destructive/60">
                      <span aria-hidden="true" className="text-xs text-muted-foreground">R$</span>
                      <input
                        value={amountText}
                        onChange={(event) => onAmountChange(item.id, event.target.value)}
                        inputMode="decimal"
                        size={Math.max(4, amountText.length)}
                        aria-label={`Valor de ${name}`}
                        aria-invalid={invalid || undefined}
                        aria-describedby={invalid ? `item-amount-error-${item.id}` : undefined}
                        className="w-auto min-w-[4ch] bg-transparent text-right text-base font-semibold tabular-nums outline-none [field-sizing:content] md:text-sm"
                      />
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remover ${name}`}
                      className="shrink-0 text-muted-foreground hover:text-destructive-text"
                      onClick={() => onRemoveItem(item.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  {invalid && (
                    <p id={`item-amount-error-${item.id}`} className="pb-1 text-xs font-semibold text-destructive-text">
                      Valor incompatível com a quantidade do item.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex min-h-11 items-center gap-2 py-1 pr-12 pl-3 text-sm">
          <label htmlFor="itemized-service-fee" className="min-w-0 flex-1 text-muted-foreground">
            Taxa de serviço
          </label>
          <span className="flex h-8 items-center gap-1 rounded-[0.5rem] border border-input bg-background px-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <input
              id="itemized-service-fee"
              value={serviceFeeText}
              onChange={(event) => onServiceFeeChange(event.target.value)}
              inputMode="decimal"
              aria-label="Taxa de serviço (%)"
              className="w-8 bg-transparent text-right text-base tabular-nums outline-none md:text-sm"
            />
            <span aria-hidden="true" className="text-muted-foreground">%</span>
          </span>
          <Money cents={serviceFeeCents} className="min-w-16 text-right text-sm text-muted-foreground" />
        </div>
        {fixedFees > 0 && (
          <div className="flex min-h-11 items-center justify-between gap-3 pr-12 pl-3 text-sm text-muted-foreground">
            <span>Taxas fixas</span>
            <Money cents={fixedFees} className="text-sm" />
          </div>
        )}
        <div className="flex min-h-11 items-center justify-between gap-3 pr-12 pl-3 text-sm font-bold">
          <span>Total</span>
          <Money cents={grandTotal} className="text-sm font-bold" />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {addingItem ? (
          <AddItemForm onAdd={onAddItem} onCancel={() => setAddingItem(false)} />
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full border-dashed"
            onClick={() => setAddingItem(true)}
          >
            <Plus aria-hidden="true" />
            Adicionar item
          </Button>
        )}
      </AnimatePresence>
    </div>
  );
}
