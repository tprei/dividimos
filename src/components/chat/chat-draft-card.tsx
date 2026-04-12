"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Pencil,
  Receipt,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/currency";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

interface ChatDraftCardProps {
  result: ChatExpenseResult;
  onConfirm: (result: ChatExpenseResult) => void;
  onEdit: (result: ChatExpenseResult) => void;
}

const CONFIDENCE_CONFIG = {
  high: { label: "Alta confiança", variant: "secondary" as const },
  medium: { label: "Confiança média", variant: "outline" as const },
  low: { label: "Baixa confiança", variant: "destructive" as const },
} as const;

export function ChatDraftCard({
  result,
  onConfirm,
  onEdit,
}: ChatDraftCardProps) {
  const conf = CONFIDENCE_CONFIG[result.confidence];
  const isLowConfidence = result.confidence === "low";
  const hasAmount = result.amountCents > 0;
  const hasItems = result.items.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="rounded-2xl border bg-card p-4"
      data-testid="chat-draft-card"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            Despesa via IA
          </span>
        </div>
        <Badge variant={conf.variant} data-testid="confidence-badge">
          {conf.label}
        </Badge>
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
            <span
              className="text-lg font-bold tabular-nums"
              data-testid="draft-amount"
            >
              {formatBRL(result.amountCents)}
            </span>
          )}
          <span className="text-xs text-muted-foreground" data-testid="draft-split-type">
            {result.splitType === "equal" ? "Divisão igual" : "Divisão personalizada"}
          </span>
        </div>

        {hasItems && (
          <div className="mt-1 space-y-1">
            {result.items.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground">
                  {item.quantity > 1 ? `${item.quantity}x ` : ""}
                  {item.description}
                </span>
                <span className="tabular-nums">{formatBRL(item.totalCents)}</span>
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

      {isLowConfidence && (
        <div
          className="mt-3 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground"
          data-testid="low-confidence-warning"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          A IA não tem certeza sobre alguns dados. Revise antes de confirmar.
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => onEdit(result)}
          data-testid="draft-edit-button"
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Editar
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={() => onConfirm(result)}
          disabled={!hasAmount && result.expenseType === "single_amount"}
          data-testid="draft-confirm-button"
        >
          <Check className="mr-1.5 h-3.5 w-3.5" />
          Confirmar
        </Button>
      </div>
    </motion.div>
  );
}
