"use client";

import { motion } from "framer-motion";
import { Minus, Plus, X } from "lucide-react";
import { useCallback, useState } from "react";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { haptics } from "@/hooks/use-haptics";

interface AddItemFormProps {
  onAdd: (item: {
    description: string;
    quantity: number;
    unitPriceCents: number;
    totalPriceCents: number;
  }) => void;
  onCancel: () => void;
}

export function AddItemForm({ onAdd, onCancel }: AddItemFormProps) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [priceCents, setPriceCents] = useState(0);

  const decrement = useCallback(() => {
    setQuantity((q) => {
      if (q <= 1) return q;
      haptics.selectionChanged();
      return q - 1;
    });
  }, []);

  const increment = useCallback(() => {
    haptics.selectionChanged();
    setQuantity((q) => q + 1);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || priceCents <= 0) return;

    onAdd({
      description: description.trim(),
      quantity,
      unitPriceCents: priceCents,
      totalPriceCents: priceCents * quantity,
    });

    setDescription("");
    setQuantity(1);
    setPriceCents(0);
  };

  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3 }}
      onSubmit={handleSubmit}
      className="overflow-hidden rounded-2xl border bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Adicionar item</span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 space-y-3">
        <div className="flex items-center gap-0 rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <Input
            placeholder="Descrição (ex: Picanha 400g)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autoFocus
            className="flex-1 border-0 focus-visible:border-0 focus-visible:ring-0"
          />
          <div className="flex shrink-0 items-center gap-0.5 pr-1">
            <button
              type="button"
              onClick={decrement}
              disabled={quantity <= 1}
              aria-label="Diminuir quantidade"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="min-w-[1.5rem] text-center text-xs font-medium tabular-nums">
              {quantity}x
            </span>
            <button
              type="button"
              onClick={increment}
              aria-label="Aumentar quantidade"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Preço unitário (R$)
            </label>
            <div className="flex items-center rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
              <span className="pl-2.5 text-sm text-muted-foreground">R$</span>
              <CurrencyInput
                valueCents={priceCents}
                onChangeCents={setPriceCents}
                className="flex-1 h-8 px-2.5 py-1 text-base md:text-sm text-left"
              />
            </div>
            <div className="mt-1.5">
              <AmountQuickAdd
                increments={[1, 2, 5, 10, 20]}
                valueCents={priceCents}
                onChangeCents={setPriceCents}
              />
            </div>
          </div>
        </div>
      </div>

      <Button type="submit" className="mt-4 w-full gap-2" disabled={!description.trim() || priceCents <= 0}>
        <Plus className="h-4 w-4" />
        Adicionar
      </Button>
    </motion.form>
  );
}
