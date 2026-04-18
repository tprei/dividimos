"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { AddItemForm } from "@/components/bill/add-item-form";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import type { ExpenseItem } from "@/types";

interface Expense {
  totalAmount: number;
  serviceFeePercent: number;
  fixedFees: number;
}

export interface ItemsStepProps {
  items: ExpenseItem[];
  expense: Expense | null;
  grandTotal: number;
  onAddItem: (item: { description: string; quantity: number; unitPriceCents: number; totalPriceCents: number }) => void;
  onRemoveItem: (id: string) => void;
}

export function ItemsStep({
  items,
  expense,
  grandTotal,
  onAddItem,
  onRemoveItem,
}: ItemsStepProps) {
  const [showAddItem, setShowAddItem] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Adicione os itens da conta.{" "}
        {items.length > 0 && (
          <span className="font-medium text-foreground">
            {items.length} itens — {formatBRL(expense?.totalAmount || 0)}
          </span>
        )}
      </p>
      <AnimatePresence>
        {items.map((item) => (
          <motion.div key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -100 }} className="flex items-center justify-between rounded-xl border bg-card p-3">
            <div>
              <p className="text-sm font-medium">{item.description}</p>
              <p className="text-xs text-muted-foreground">{item.quantity}x {formatBRL(item.unitPriceCents)}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold tabular-nums text-sm">{formatBRL(item.totalPriceCents)}</span>
              <button onClick={() => onRemoveItem(item.id)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive">
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <AnimatePresence>
        {showAddItem && (
          <AddItemForm onAdd={(item) => { onAddItem(item); setShowAddItem(false); }} onCancel={() => setShowAddItem(false)} />
        )}
      </AnimatePresence>
      {!showAddItem && (
        <Button variant="outline" className="w-full gap-2" onClick={() => setShowAddItem(true)}>
          <Plus className="h-4 w-4" />
          Adicionar item
        </Button>
      )}
      {items.length > 0 && expense && expense.serviceFeePercent > 0 && (
        <div className="rounded-xl bg-muted/50 p-3 text-sm space-y-1">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatBRL(expense.totalAmount)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Garçom ({expense.serviceFeePercent}%)</span>
            <span className="tabular-nums">{formatBRL(Math.round(expense.totalAmount * expense.serviceFeePercent / 100))}</span>
          </div>
          {expense.fixedFees > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Couvert</span>
              <span className="tabular-nums">{formatBRL(expense.fixedFees)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold border-t border-border pt-1">
            <span>Total com garçom</span>
            <span className="tabular-nums text-primary">{formatBRL(grandTotal)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
