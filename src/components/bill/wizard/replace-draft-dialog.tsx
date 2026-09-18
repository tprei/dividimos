"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/shared/money";
import type { ScanDraftChoice } from "@/lib/confirmation-preferences";

export type RememberedScanChoice = Exclude<ScanDraftChoice, "ask">;

export interface ReplaceDraftDialogProps {
  open: boolean;
  draftTitle: string;
  itemCount: number;
  totalCents: number;
  onReplace: () => void;
  onKeep: () => void;
  /** When provided, the dialog offers to remember the chosen answer. */
  onRemember?: (choice: RememberedScanChoice) => void;
}

export function ReplaceDraftDialog({
  open,
  draftTitle,
  itemCount,
  totalCents,
  onReplace,
  onKeep,
  onRemember,
}: ReplaceDraftDialogProps) {
  const [remember, setRemember] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setRemember(false);
  }

  const decide = (choice: RememberedScanChoice) => {
    if (remember) onRemember?.(choice);
    if (choice === "keep") onKeep();
    else onReplace();
  };

  return (
    <Dialog open={open} dismissable={false}>
      <DialogContent
        showCloseButton={false}
        className="rounded-2xl bg-card p-5"
      >
        <DialogHeader className="text-left space-y-2">
          <DialogTitle className="text-lg font-bold">
            Substituir a conta em rascunho?
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            A nota escaneada vai substituir «{draftTitle}» (
            {itemCount > 0 ? `${itemCount} ${itemCount === 1 ? "item" : "itens"}, ` : ""}
            <Money cents={totalCents} />). O rascunho atual será descartado.
          </DialogDescription>
        </DialogHeader>
        {onRemember && (
          <div>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Lembrar minha escolha
            </label>
            {remember && (
              <p className="text-xs text-muted-foreground">Dá pra mudar depois em Configurações.</p>
            )}
          </div>
        )}
        <div className="flex flex-col gap-2 pt-2">
          <Button
            autoFocus
            variant="outline"
            className="w-full rounded-lg min-h-11"
            onClick={() => decide("keep")}
          >
            Manter rascunho
          </Button>
          <Button
            variant="destructive"
            className="w-full rounded-lg min-h-11 bg-destructive/10 text-destructive hover:bg-destructive/20"
            onClick={() => decide("replace")}
          >
            Substituir rascunho
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
