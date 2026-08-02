"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface GuestClaimRotateDialogProps {
  open: boolean;
  guestName: string;
  issuing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation shown when a credential already exists for a guest. Only
 * confirming sends the rotate (compare-and-set); cancelling performs no RPC.
 */
export function GuestClaimRotateDialog({
  open,
  guestName,
  issuing,
  onConfirm,
  onCancel,
}: GuestClaimRotateDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gerar novo link</DialogTitle>
          <DialogDescription>
            Já existe um link para {guestName}. Gerar um novo link invalida o
            anterior, e quem estiver com o link antigo não conseguirá entrar na
            conta.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={issuing}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={issuing}>
            {issuing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Gerar novo link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
