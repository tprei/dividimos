"use client";

import { AlertTriangle, Check, Pencil, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/currency";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";

interface VoiceExpenseModalProps {
  open: boolean;
  result: VoiceExpenseResult;
  onConfirm: (result: VoiceExpenseResult) => void;
  onCancel: () => void;
}

export function VoiceExpenseModal({
  open,
  result,
  onConfirm,
  onCancel,
}: VoiceExpenseModalProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(result.title);
  const [editingAmount, setEditingAmount] = useState(false);
  const [amountInput, setAmountInput] = useState(
    (result.amountCents / 100).toFixed(2).replace(".", ","),
  );

  const handleConfirm = () => {
    const amountCents = Math.round(
      parseFloat(amountInput.replace(",", ".")) * 100,
    );
    onConfirm({
      ...result,
      title: title || result.title,
      amountCents: Number.isFinite(amountCents) ? amountCents : result.amountCents,
    });
  };

  const needsAmount = result.amountCents === 0 && result.expenseType === "single_amount";

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar despesa</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Título</span>
            {editingTitle ? (
              <div className="flex items-center gap-1">
                <Input
                  className="h-8 w-40 text-sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                />
                <Button variant="ghost" size="icon-sm" onClick={() => setEditingTitle(false)}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <button
                className="flex items-center gap-1 text-sm font-medium"
                onClick={() => setEditingTitle(true)}
              >
                {title || "Sem título"}
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Tipo</span>
            <span className="text-sm font-medium">
              {result.expenseType === "single_amount" ? "Valor único" : "Vários itens"}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Valor</span>
            {editingAmount ? (
              <div className="flex items-center gap-1">
                <span className="text-sm">R$</span>
                <Input
                  className="h-8 w-24 text-right text-sm"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  autoFocus
                />
                <Button variant="ghost" size="icon-sm" onClick={() => setEditingAmount(false)}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <button
                className="flex items-center gap-1 text-sm font-medium"
                onClick={() => setEditingAmount(true)}
              >
                {result.amountCents > 0 ? formatBRL(result.amountCents) : "Não informado"}
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>

          {result.merchantName && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Local</span>
              <span className="text-sm font-medium">{result.merchantName}</span>
            </div>
          )}

          {result.items.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-sm text-muted-foreground">Itens</span>
              <div className="space-y-1 rounded-lg border p-2">
                {result.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span>
                      {item.quantity}x {item.description}
                    </span>
                    <span className="font-medium">{formatBRL(item.totalCents)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.participants.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-sm text-muted-foreground">Participantes</span>
              <div className="flex flex-wrap gap-1.5">
                {result.participants.map((p, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                  >
                    {p.spokenName}
                    {p.matchedHandle && (
                      <span className="text-muted-foreground">@{p.matchedHandle}</span>
                    )}
                    {p.confidence === "low" && (
                      <AlertTriangle className="h-3 w-3 text-warning" />
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {needsAmount && (
            <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-sm text-warning-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Informe o valor antes de confirmar
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={needsAmount && !editingAmount}>
            <Check className="mr-1.5 h-3.5 w-3.5" />
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
