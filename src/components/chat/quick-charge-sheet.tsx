"use client";

import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, DollarSign, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { CurrencyInput } from "@/components/ui/currency-input";
import { formatBRL } from "@/lib/currency";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

export type QuickChargeStatus = "idle" | "confirming" | "confirmed" | "error";

export interface QuickChargeSheetProps {
  counterpartyName: string;
  counterpartyHandle: string;
  currentUserHandle: string;
  onConfirm: (result: ChatExpenseResult) => void;
  onEdit: (result: ChatExpenseResult) => void;
  onDismiss: () => void;
  status?: QuickChargeStatus;
  errorMessage?: string;
}

function buildDescription(amountCents: number, counterpartyName: string): string {
  if (amountCents <= 0) return "";
  return `Cobrança de ${formatBRL(amountCents)} para ${counterpartyName}`;
}

function buildResult(
  amountCents: number,
  description: string,
  payerIsSelf: boolean,
  counterpartyHandle: string,
): ChatExpenseResult {
  return {
    title: description || "Cobrança",
    amountCents,
    expenseType: "single_amount",
    splitType: "equal",
    items: [],
    participants: [
      {
        spokenName: counterpartyHandle,
        matchedHandle: counterpartyHandle,
        confidence: "high",
      },
    ],
    payerHandle: payerIsSelf ? "SELF" : counterpartyHandle,
    merchantName: null,
    confidence: "high",
  };
}

export function QuickChargeSheet({
  counterpartyName,
  counterpartyHandle,
  currentUserHandle,
  onConfirm,
  onEdit,
  onDismiss,
  status = "idle",
  errorMessage,
}: QuickChargeSheetProps) {
  const [amountCents, setAmountCents] = useState(0);
  const [description, setDescription] = useState("");
  const [descriptionEdited, setDescriptionEdited] = useState(false);
  const [payerIsSelf, setPayerIsSelf] = useState(true);

  const autoDescription = useMemo(
    () => buildDescription(amountCents, counterpartyName),
    [amountCents, counterpartyName],
  );

  const displayDescription = descriptionEdited ? description : autoDescription;

  const isConfirming = status === "confirming";
  const isConfirmed = status === "confirmed";
  const isDisabled = isConfirming || isConfirmed || amountCents <= 0;

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDescriptionEdited(true);
      setDescription(e.target.value);
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    if (amountCents <= 0) return;
    const result = buildResult(
      amountCents,
      displayDescription,
      payerIsSelf,
      counterpartyHandle,
    );
    onConfirm(result);
  }, [amountCents, displayDescription, payerIsSelf, counterpartyHandle, onConfirm]);

  const handleEdit = useCallback(() => {
    const result = buildResult(
      amountCents,
      displayDescription,
      payerIsSelf,
      counterpartyHandle,
    );
    onEdit(result);
  }, [amountCents, displayDescription, payerIsSelf, counterpartyHandle, onEdit]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="rounded-2xl border bg-card p-4"
      data-testid="quick-charge-sheet"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <DollarSign className="h-4 w-4 text-primary" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            Cobrança rápida
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Fechar"
          data-testid="quick-charge-dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3 text-center">
        <div className="mb-1 text-xs text-muted-foreground">
          Cobrar de {counterpartyName}
        </div>
        <div className="flex items-center justify-center gap-1">
          <span className="text-lg font-bold text-muted-foreground">R$</span>
          <CurrencyInput
            valueCents={amountCents}
            onChangeCents={setAmountCents}
            className="w-32 text-3xl font-bold"
            autoFocus
            data-testid="quick-charge-amount"
          />
        </div>
        {amountCents > 0 && (
          <div className="mt-1 text-xs text-muted-foreground" data-testid="quick-charge-preview">
            {formatBRL(amountCents)}
          </div>
        )}
      </div>

      <div className="mb-3 flex justify-center">
        <AmountQuickAdd valueCents={amountCents} onChangeCents={setAmountCents} />
      </div>

      <div className="mb-3">
        <input
          type="text"
          value={displayDescription}
          onChange={handleDescriptionChange}
          placeholder="Descrição (opcional)"
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
          data-testid="quick-charge-description"
        />
      </div>

      <div className="mb-4">
        <div className="mb-1.5 text-xs text-muted-foreground">Quem pagou?</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPayerIsSelf(true)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              payerIsSelf
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:border-primary/30"
            }`}
            data-testid="quick-charge-payer-self"
          >
            Eu (@{currentUserHandle})
          </button>
          <button
            type="button"
            onClick={() => setPayerIsSelf(false)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              !payerIsSelf
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:border-primary/30"
            }`}
            data-testid="quick-charge-payer-other"
          >
            {counterpartyName}
          </button>
        </div>
      </div>

      {status === "error" && errorMessage && (
        <div
          className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          data-testid="quick-charge-error"
        >
          {errorMessage}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={handleEdit}
          disabled={isConfirming || isConfirmed}
          data-testid="quick-charge-edit"
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Editar no wizard
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={handleConfirm}
          disabled={isDisabled}
          data-testid="quick-charge-confirm"
        >
          {isConfirming ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-1.5 h-3.5 w-3.5" />
          )}
          {isConfirming ? "Enviando…" : "Cobrar"}
        </Button>
      </div>
    </motion.div>
  );
}
