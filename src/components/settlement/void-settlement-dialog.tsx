"use client";

import { useState } from "react";
import { ArrowRight, Info, Undo2 } from "lucide-react";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface VoidSettlementDialogProps {
  open: boolean;
  amountCents: number;
  payerName: string;
  recipientName: string;
  payerAvatarUrl?: string | null;
  recipientAvatarUrl?: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onSkipFutureConfirmations?: () => void;
}

export function VoidSettlementDialog({
  open,
  amountCents,
  payerName,
  recipientName,
  payerAvatarUrl,
  recipientAvatarUrl,
  busy,
  onCancel,
  onConfirm,
  onSkipFutureConfirmations,
}: VoidSettlementDialogProps) {
  const [skip, setSkip] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSkip(false);
    }
  }

  return (
    <Dialog
      open={open}
      dismissable={!busy}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader className="space-y-2 text-center sm:text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning/15 text-warning">
            <Undo2 className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">Desfazer este registro?</DialogTitle>
          <DialogDescription className="text-center">
            O registro fica marcado como Desfeito e os saldos são recalculados na hora.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-center justify-center gap-2">
            <UserAvatar name={payerName} avatarUrl={payerAvatarUrl} size="sm" />
            <span className="font-medium text-sm">{payerName}</span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <UserAvatar name={recipientName} avatarUrl={recipientAvatarUrl} size="sm" />
            <span className="font-medium text-sm">{recipientName}</span>
          </div>
          <Money cents={amountCents} className="mt-1 block text-center text-lg font-semibold" />
        </div>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          O Pix em si não é estornado. Combina a devolução direto com a outra pessoa.
        </p>

        {onSkipFutureConfirmations && (
          <label className="flex min-h-11 items-center gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={skip}
              onChange={(e) => setSkip(e.target.checked)}
            />
            Não perguntar de novo
          </label>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 w-full rounded-lg"
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (skip) {
                onSkipFutureConfirmations?.();
              }
              onConfirm();
            }}
            disabled={busy}
            className="min-h-11 w-full rounded-lg"
          >
            {busy ? "Desfazendo…" : "Desfazer registro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
