"use client";

import { AnimatePresence } from "framer-motion";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AddItemForm } from "@/components/bill/add-item-form";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { centsText } from "@/lib/item-division";
import type { ExpenseItem } from "@/types";

export interface ItemsSectionProps {
  items: ExpenseItem[];
  amountTexts: Record<string, string>;
  invalidAmountIds: string[];
  serviceFeeText: string;
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
  fixedFees,
  grandTotal,
  onDescriptionChange,
  onAmountChange,
  onServiceFeeChange,
  onRemoveItem,
  onAddItem,
}: ItemsSectionProps) {
  const [addingItem, setAddingItem] = useState(false);

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="divide-y divide-border rounded-2xl border bg-card">
        {items.map((item) => {
          const invalid = invalidAmountIds.includes(item.id);
          return (
            <div key={item.id} className="px-4 py-2">
              <div className="flex min-h-14 items-center gap-2">
                <Input
                  value={item.description}
                  onChange={(event) => onDescriptionChange(item.id, event.target.value)}
                  aria-label={`Nome do item ${item.description || "sem nome"}`}
                  className="h-9 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                />
                <Input
                  value={amountTexts[item.id] ?? centsText(item.totalPriceCents)}
                  onChange={(event) => onAmountChange(item.id, event.target.value)}
                  inputMode="decimal"
                  aria-label={`Valor de ${item.description || "item"}`}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? `item-amount-error-${item.id}` : undefined}
                  className="h-9 w-24 shrink-0 border-0 bg-transparent px-0 text-right font-mono shadow-none focus-visible:ring-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label={`Remover ${item.description || "item"}`}
                  className="min-h-11 min-w-11"
                  onClick={() => onRemoveItem(item.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {invalid && (
                <p id={`item-amount-error-${item.id}`} className="text-xs font-semibold text-destructive">
                  Valor incompatível com a quantidade do item.
                </p>
              )}
            </div>
          );
        })}
        <div className="flex min-h-14 items-center gap-2 px-4 py-2">
          <label htmlFor="itemized-service-fee" className="min-w-0 flex-1 text-sm text-muted-foreground">
            Taxa de serviço
          </label>
          <div className="flex shrink-0 items-center gap-1">
            <Input
              id="itemized-service-fee"
              value={serviceFeeText}
              onChange={(event) => onServiceFeeChange(event.target.value)}
              inputMode="decimal"
              aria-label="Taxa de serviço (%)"
              className="h-9 w-20 border-input bg-background px-2 text-right font-mono"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>
        {fixedFees > 0 && (
          <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
            <span className="text-sm text-muted-foreground">Taxas fixas</span>
            <Money cents={fixedFees} className="text-sm" />
          </div>
        )}
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
          <span className="text-sm font-bold">Total</span>
          <Money cents={grandTotal} className="text-sm font-bold" />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {addingItem ? (
          <AddItemForm
            onAdd={(item) => {
              onAddItem(item);
              setAddingItem(false);
            }}
            onCancel={() => setAddingItem(false)}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 h-11 w-full"
            onClick={() => setAddingItem(true)}
          >
            <Plus className="size-4" />
            Adicionar item
          </Button>
        )}
      </AnimatePresence>
    </div>
  );
}
