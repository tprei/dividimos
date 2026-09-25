"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  Pencil,
  Receipt,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Money } from "@/components/shared/money";
import { popIn } from "@/lib/animations";
import { formatExpenseQuantity, type ExpenseQuantity } from "@/lib/expense-quantity";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

export type ChatDraftStatus = "idle" | "confirming" | "confirmed" | "error";

interface ChatDraftCardProps {
  result: ChatExpenseResult;
  onConfirm: (result: ChatExpenseResult) => void;
  onEdit: (result: ChatExpenseResult) => void;
  onDiscard?: () => void;
  status?: ChatDraftStatus;
  errorMessage?: string;
}

const CONFIDENCE_CONFIG = {
  high: { label: "Alta confiança", tone: "success" },
  medium: { label: "Confiança média", tone: "warning" },
  low: { label: "Baixa confiança", tone: "danger" },
} as const;

export function ChatDraftCard({
  result,
  onConfirm,
  onEdit,
  onDiscard,
  status = "idle",
  errorMessage,
}: ChatDraftCardProps) {
  const conf = CONFIDENCE_CONFIG[result.confidence];
  const isLowConfidence = result.confidence === "low";
  const hasAmount = result.amountCents > 0;
  const hasItems = result.items.length > 0;
  const hasUndeterminedAllocations =
    result.splitType === "custom" && result.allocations.length !== 2;
  const isConfirming = status === "confirming";
  const isConfirmed = status === "confirmed";
  const isError = status === "error";
  const isDisabled = isConfirming || isConfirmed;

  return (
    <motion.div
      variants={popIn} initial="hidden" animate="visible"
      className="rounded-2xl border bg-card p-4"
      data-testid="chat-draft-card"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            Conta sugerida
          </span>
        </div>
        {isConfirmed ? (
          <Chip tone="success" data-testid="confirmed-badge">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Confirmada
          </Chip>
        ) : (
          <Chip tone={conf.tone} data-testid="confidence-badge">
            {conf.label}
          </Chip>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium" data-testid="draft-title">
            {result.title || "Sem título"}
          </span>
          {result.merchantName && (
            <span className="text-xs text-muted-foreground">
              — {result.merchantName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {hasAmount && (
            <span data-testid="draft-amount"><Money cents={result.amountCents} size="lg" /></span>
          )}
          <span className="text-xs text-muted-foreground" data-testid="draft-split-type">
            {result.splitType === "equal" ? "Divisão igual" : "Divisão personalizada"}
          </span>
        </div>

        {result.splitType === "custom" && (
          <div className="text-xs text-muted-foreground" data-testid="draft-allocations">
            {result.allocations.length === 2 ? (
              <div className="space-y-0.5">
                {result.allocations.map((allocation) => (
                  <div
                    key={allocation.participantHandle}
                    className="flex items-center justify-between"
                  >
                    <span>
                      {allocation.participantHandle === "SELF"
                        ? "Você"
                        : `@${allocation.participantHandle}`}
                    </span>
                    <Money cents={allocation.shareAmountCents} size="sm" />
                  </div>
                ))}
              </div>
            ) : (
              <span data-testid="draft-allocations-undetermined">
                Não foi possível identificar a divisão exata. Edite para ajustar os valores.
              </span>
            )}
          </div>
        )}

        {hasItems && (
          <div className="mt-1 space-y-1">
            {result.items.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground">
                  {item.quantity > 1000 ? `${formatExpenseQuantity(item.quantity as ExpenseQuantity)}x ` : ""}
                  {item.description}
                </span>
                <Money cents={item.totalCents} size="sm" />
              </div>
            ))}
          </div>
        )}

        {result.participants.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>
              {result.participants
                .map((p) =>
                  p.matchedHandle ? `@${p.matchedHandle}` : p.spokenName,
                )
                .join(", ")}
            </span>
          </div>
        )}

        {result.payerHandle && (
          <div className="text-xs text-muted-foreground" data-testid="draft-payer">
            Pago por{" "}
            {result.payerHandle === "SELF" ? "você" : `@${result.payerHandle}`}
          </div>
        )}
      </div>

      {isLowConfidence && !isConfirmed && (
        <div
          className="mt-3 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground"
          data-testid="low-confidence-warning"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          A IA não tem certeza sobre alguns dados. Revise antes de confirmar.
        </div>
      )}

      <AnimatePresence mode="wait">
        {isError && errorMessage && (
          <motion.div
            key="error"
            variants={popIn} initial="hidden" animate="visible" exit="exit"
            className="mt-3 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive-text"
            data-testid="draft-error"
          >
            <XCircle className="h-3.5 w-3.5 shrink-0" />
            {errorMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {!isConfirmed && (
        <div className="mt-4 flex gap-2">
          {onDiscard && <Button variant="ghost" size="sm" disabled={isDisabled} onClick={onDiscard}>Descartar</Button>}
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onEdit(result)}
            disabled={isDisabled}
            data-testid="draft-edit-button"
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Editar
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={() => onConfirm(result)}
            disabled={
              isDisabled ||
              (!hasAmount && result.expenseType === "single_amount") ||
              hasUndeterminedAllocations
            }
            data-testid="draft-confirm-button"
          >
            {isConfirming ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            )}
            {isConfirming ? "Confirmando…" : "Confirmar"}
          </Button>
        </div>
      )}
    </motion.div>
  );
}
