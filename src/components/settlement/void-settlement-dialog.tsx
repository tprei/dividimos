"use client";

import { Money } from "@/components/shared/money";
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
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function VoidSettlementDialog({
  open,
  amountCents,
  payerName,
  recipientName,
  busy,
  onCancel,
  onConfirm,
}: VoidSettlementDialogProps) {
  return (
    <Dialog
      open={open}
      dismissable={!busy}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            Desfazer o registro de <Money cents={amountCents} />?
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">
              {payerName} pagou {recipientName}.
            </span>
            <span className="block">
              O registro ficará marcado como Desfeito e os saldos atuais serão recalculados.
            </span>
            <span className="mt-2 block rounded-xl border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning-foreground">
              O Pix em si não é estornado — combine a devolução diretamente com a outra pessoa.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? "Desfazendo…" : "Desfazer registro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
