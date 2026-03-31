"use client";

import { motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { QuantityStepper } from "@/components/bill/quantity-stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decimalToCents, sanitizeDecimalInput } from "@/lib/currency";

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
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || !price) return;

    const qty = parseInt(quantity) || 1;
    const unitPriceCents = decimalToCents(parseFloat(price.replace(",", ".")) || 0);
    const totalPriceCents = unitPriceCents * qty;

    onAdd({
      description: description.trim(),
      quantity: qty,
      unitPriceCents,
      totalPriceCents,
    });

    setDescription("");
    setQuantity("1");
    setPrice("");
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
        <Input
          placeholder="Descrição (ex: Picanha 400g)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          autoFocus
        />
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Qtd
            </label>
            <QuantityStepper value={quantity} onChange={setQuantity} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Preço unitário (R$)
            </label>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={price}
              onChange={(e) => setPrice(sanitizeDecimalInput(e.target.value))}
            />
            <div className="mt-1.5">
              <AmountQuickAdd
                increments={[1, 2, 5, 10, 20]}
                currentValue={price}
                onChange={setPrice}
              />
            </div>
          </div>
        </div>
      </div>

      <Button type="submit" className="mt-4 w-full gap-2" disabled={!description.trim() || !price}>
        <Plus className="h-4 w-4" />
        Adicionar
      </Button>
    </motion.form>
  );
}
