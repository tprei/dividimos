"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Pencil, Plus, Store, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { QuantityStepper } from "@/components/bill/quantity-stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  formatBRL,
  sanitizeDecimalInput,
} from "@/lib/currency";
import type { ReceiptOcrResult, ReceiptItem } from "@/lib/receipt-ocr";

interface EditingState {
  index: number;
  description: string;
  quantity: string;
  unitPriceCents: number;
}

interface ScannedItemsReviewProps {
  result: ReceiptOcrResult & { totalMismatch?: boolean };
  onConfirm: (result: ReceiptOcrResult) => void;
  onCancel: () => void;
}

export function ScannedItemsReview({
  result,
  onConfirm,
  onCancel,
}: ScannedItemsReviewProps) {
  const [items, setItems] = useState<ReceiptItem[]>(() => [...result.items]);
  const [merchant, setMerchant] = useState(result.merchant ?? "");
  const [serviceFee, setServiceFee] = useState(
    result.serviceFeePercent.toString(),
  );
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [adding, setAdding] = useState(false);
  const [newDescription, setNewDescription] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");
  const [newPriceCents, setNewPriceCents] = useState(0);

  const computedTotal = items.reduce((sum, item) => sum + item.totalCents, 0);

  const startEdit = useCallback(
    (index: number) => {
      const item = items[index];
      setEditing({
        index,
        description: item.description,
        quantity: item.quantity.toString(),
        unitPriceCents: item.unitPriceCents,
      });
    },
    [items],
  );

  const saveEdit = useCallback(() => {
    if (!editing) return;
    const qty = Math.max(0.001, parseFloat(editing.quantity) || 1);
    setItems((prev) =>
      prev.map((item, i) =>
        i === editing.index
          ? {
              ...item,
              description: editing.description.trim() || item.description,
              quantity: qty,
              unitPriceCents: editing.unitPriceCents,
              totalCents: editing.unitPriceCents * qty,
            }
          : item,
      ),
    );
    setEditing(null);
  }, [editing]);

  const cancelEdit = useCallback(() => setEditing(null), []);

  const removeItem = useCallback(
    (index: number) => {
      if (editing?.index === index) setEditing(null);
      setItems((prev) => prev.filter((_, i) => i !== index));
    },
    [editing],
  );

  const addItem = useCallback(() => {
    const desc = newDescription.trim();
    if (!desc || newPriceCents <= 0) return;
    const qty = Math.max(0.001, parseFloat(newQuantity) || 1);
    setItems((prev) => [
      ...prev,
      {
        description: desc,
        quantity: qty,
        unitPriceCents: newPriceCents,
        totalCents: newPriceCents * qty,
      },
    ]);
    setNewDescription("");
    setNewQuantity("1");
    setNewPriceCents(0);
    setAdding(false);
  }, [newDescription, newQuantity, newPriceCents]);

  const handleConfirm = useCallback(() => {
    if (items.length === 0) return;
    const feePercent = parseFloat(serviceFee.replace(",", ".")) || 0;
    onConfirm({
      merchant: merchant.trim() || null,
      items,
      serviceFeePercent: Math.max(0, feePercent),
      totalCents: computedTotal,
    });
  }, [items, merchant, serviceFee, computedTotal, onConfirm]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Revisar itens escaneados</h2>
        <p className="text-sm text-muted-foreground">
          Confira os itens e corrija se necessario.
        </p>
      </div>

      {/* Merchant */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Store className="h-4 w-4" />
          <span>Estabelecimento</span>
        </div>
        <Input
          className="mt-2"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          placeholder="Nome do estabelecimento"
        />
      </div>

      {/* Items list */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-2"
      >
        <AnimatePresence mode="popLayout">
          {items.map((item, index) => (
            <motion.div
              key={`${item.description}-${index}`}
              variants={staggerItem}
              exit={{ opacity: 0, x: -40 }}
              layout
              className="rounded-2xl border bg-card p-4"
            >
              {editing?.index === index ? (
                <div className="space-y-3">
                  <Input
                    value={editing.description}
                    onChange={(e) =>
                      setEditing({ ...editing, description: e.target.value })
                    }
                    placeholder="Descricao"
                    autoFocus
                  />
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Qtd
                      </label>
                      <QuantityStepper
                        value={editing.quantity}
                        onChange={(v) =>
                          setEditing({ ...editing, quantity: v })
                        }
                        min={0.001}
                        allowDecimal
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Preco unit. (R$)
                      </label>
                      <div className="flex items-center rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                        <span className="pl-2.5 text-sm text-muted-foreground">R$</span>
                        <CurrencyInput
                          valueCents={editing.unitPriceCents}
                          onChangeCents={(cents) =>
                            setEditing({ ...editing, unitPriceCents: cents })
                          }
                          className="flex-1 h-8 px-2.5 py-1 text-base md:text-sm text-left"
                        />
                      </div>
                      <div className="mt-1.5">
                        <AmountQuickAdd
                          increments={[1, 2, 5, 10, 20]}
                          valueCents={editing.unitPriceCents}
                          onChangeCents={(cents) =>
                            setEditing({ ...editing, unitPriceCents: cents })
                          }
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 gap-1.5"
                      onClick={saveEdit}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Salvar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={cancelEdit}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => startEdit(index)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") startEdit(index);
                    }}
                  >
                    <p className="font-medium">{item.description}</p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      {item.quantity > 1 && <span>{item.quantity}x</span>}
                      {item.quantity > 1 && (
                        <span>{formatBRL(item.unitPriceCents)} un.</span>
                      )}
                      <span className="font-semibold tabular-nums text-foreground">
                        {formatBRL(item.totalCents)}
                      </span>
                    </div>
                  </div>
                  <div className="ml-2 flex gap-1">
                    <button
                      onClick={() => startEdit(index)}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                      aria-label={`Editar ${item.description}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => removeItem(index)}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Remover ${item.description}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {items.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum item. Adicione pelo menos um item para continuar.
          </p>
        )}
      </motion.div>

      {/* Add item */}
      <AnimatePresence>
        {adding ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden rounded-2xl border bg-card p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Adicionar item</span>
              <button
                onClick={() => setAdding(false)}
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 space-y-3">
              <Input
                placeholder="Descricao (ex: Picanha 400g)"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                autoFocus
              />
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Qtd
                  </label>
                  <QuantityStepper
                    value={newQuantity}
                    onChange={setNewQuantity}
                    min={1}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Preco unitario (R$)
                  </label>
                  <div className="flex items-center rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                    <span className="pl-2.5 text-sm text-muted-foreground">R$</span>
                    <CurrencyInput
                      valueCents={newPriceCents}
                      onChangeCents={setNewPriceCents}
                      className="flex-1 h-8 px-2.5 py-1 text-base md:text-sm text-left"
                    />
                  </div>
                  <div className="mt-1.5">
                    <AmountQuickAdd
                      increments={[1, 2, 5, 10, 20]}
                      valueCents={newPriceCents}
                      onChangeCents={setNewPriceCents}
                    />
                  </div>
                </div>
              </div>
            </div>
            <Button
              className="mt-4 w-full gap-2"
              onClick={addItem}
              disabled={!newDescription.trim() || newPriceCents <= 0}
            >
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
          </motion.div>
        ) : (
          <motion.div layout>
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-4 w-4" />
              Adicionar mais item
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Service fee */}
      <div className="rounded-2xl border bg-card p-4">
        <label className="mb-2 block text-sm font-medium">
          Taxa de servico (%)
        </label>
        <Input
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={serviceFee}
          onChange={(e) => setServiceFee(sanitizeDecimalInput(e.target.value))}
        />
      </div>

      {/* Total */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            Total dos itens
          </span>
          <span className="text-lg font-bold tabular-nums">
            {formatBRL(computedTotal)}
          </span>
        </div>
      </div>

      {/* Mismatch warning */}
      {result.totalMismatch && result.totalCents > 0 && computedTotal !== result.totalCents && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Total da nota: {formatBRL(result.totalCents)} — itens somam{" "}
            {formatBRL(computedTotal)}. Confira os valores.
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          className="flex-1"
          onClick={handleConfirm}
          disabled={items.length === 0}
        >
          Confirmar
        </Button>
      </div>
    </motion.div>
  );
}
