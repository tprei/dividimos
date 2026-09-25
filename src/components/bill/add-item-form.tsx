"use client";

import { motion } from "framer-motion";
import { Minus, Plus, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { haptics } from "@/hooks/use-haptics";
import { popIn } from "@/lib/animations";
import {
  computeExpenseLineTotalCents,
  formatExpenseQuantity,
  type ExpenseQuantity,
} from "@/lib/expense-quantity";
import { brandExpenseCents } from "@/lib/expense-money";

interface AddItemFormProps {
  onAdd: (item: {
    description: string;
    quantity: number;
    unitPriceCents: number;
    totalPriceCents: number;
  }) => void;
  onCancel: () => void;
}

/** Pressing a control must not pull focus out of the field: that would drop the keyboard mid-entry. */
function keepFocus(event: React.MouseEvent) {
  event.preventDefault();
}

export function AddItemForm({ onAdd, onCancel }: AddItemFormProps) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1000);
  const [priceCents, setPriceCents] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  const decrement = useCallback(() => {
    setQuantity((q) => {
      if (q <= 1000) return q;
      haptics.selectionChanged();
      return q - 1000;
    });
  }, []);

  const increment = useCallback(() => {
    haptics.selectionChanged();
    setQuantity((q) => q + 1000);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || priceCents <= 0) return;

    const total = computeExpenseLineTotalCents(
      quantity as ExpenseQuantity,
      brandExpenseCents(priceCents),
    );
    if (!total.ok) return;

    onAdd({
      description: description.trim(),
      quantity,
      unitPriceCents: priceCents,
      totalPriceCents: total.value as number,
    });
    haptics.tap();

    setDescription("");
    setQuantity(1000);
    setPriceCents(0);
    nameRef.current?.focus();
  };

  return (
    <motion.form
      variants={popIn}
      initial="hidden"
      animate="visible"
      exit="exit"
      onSubmit={handleSubmit}
      className="space-y-2 rounded-[0.75rem] border bg-card p-2.5"
    >
      <div className="flex items-center gap-1">
        <Input
          ref={nameRef}
          placeholder="Descrição (ex: Picanha 400g)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || priceCents > 0) return;
            e.preventDefault();
            if (description.trim()) priceRef.current?.focus();
          }}
          enterKeyHint="next"
          autoFocus
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Fechar inclusão de item"
          className="shrink-0 text-muted-foreground"
          onClick={onCancel}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex h-11 shrink-0 items-center rounded-[0.75rem] border border-input">
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={decrement}
            disabled={quantity <= 1000}
            aria-label="Diminuir quantidade"
            className="flex h-full w-9 items-center justify-center rounded-l-[0.75rem] text-muted-foreground hover:bg-muted disabled:opacity-30"
          >
            <Minus className="size-3.5" aria-hidden="true" />
          </button>
          <span className="min-w-7 text-center text-sm font-semibold tabular-nums">
            {formatExpenseQuantity(quantity as ExpenseQuantity)}x
          </span>
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={increment}
            aria-label="Aumentar quantidade"
            className="flex h-full w-9 items-center justify-center rounded-r-[0.75rem] text-muted-foreground hover:bg-muted"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <label className="flex h-11 min-w-0 flex-1 items-center gap-1 rounded-[0.75rem] border border-input px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <span aria-hidden="true" className="text-base leading-6 text-muted-foreground md:text-sm">R$</span>
          <CurrencyInput
            ref={priceRef}
            valueCents={priceCents}
            onChangeCents={setPriceCents}
            aria-label="Preço unitário"
            className="h-auto w-full min-w-0 rounded-none border-0 bg-transparent p-0 focus-visible:ring-0"
          />
        </label>
        <Button
          type="submit"
          className="h-11 shrink-0"
          disabled={!description.trim() || priceCents <= 0}
          onMouseDown={keepFocus}
        >
          Adicionar
        </Button>
      </div>
      <AmountQuickAdd increments={[1, 2, 5, 10, 20]} valueCents={priceCents} onChangeCents={setPriceCents} />
    </motion.form>
  );
}
