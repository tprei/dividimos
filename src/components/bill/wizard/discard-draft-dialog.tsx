"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";

export type DiscardDraftMode = "type-switch" | "voice" | "banner-discard";

export interface DiscardDraftDialogProps {
  open: boolean;
  draftTitle: string;
  itemCount: number;
  totalCents: number;
  mode: DiscardDraftMode;
  isItemized?: boolean;
  onDiscard: () => void;
  onKeep: () => void;
}

export function DiscardDraftDialog({
  open,
  draftTitle,
  itemCount,
  totalCents,
  mode,
  isItemized,
  onDiscard,
  onKeep,
}: DiscardDraftDialogProps) {
  const itemized = isItemized ?? itemCount > 0;
  const itemsLabel = itemized
    ? itemCount === 1
      ? "1 item"
      : `${itemCount} itens`
    : null;
  const detail = [itemsLabel, formatBRL(totalCents)].filter(Boolean).join(", ");

  const title =
    mode === "type-switch"
      ? `Descartar a conta «${draftTitle}» em rascunho?`
      : mode === "voice"
        ? "Substituir a conta em rascunho?"
        : "Descartar o rascunho?";

  let body: string;
  if (mode === "voice") {
    body = `Gravar por voz vai substituir «${draftTitle}»${detail ? ` (${detail})` : ""}. O rascunho atual será descartado.`;
  } else if (mode === "banner-discard") {
    body = `Se descartar, você perde o que já preencheu${detail ? ` (${detail})` : ""}. Não dá pra desfazer.`;
  } else if (itemized) {
    body = `Trocar o tipo de conta apaga ${itemsLabel} (${formatBRL(totalCents)}) do rascunho. O rascunho atual será descartado.`;
  } else {
    body = `Trocar o tipo de conta apaga o valor de ${formatBRL(totalCents)} e quem divide do rascunho. O rascunho atual será descartado.`;
  }

  return (
    <Dialog open={open} dismissable={false}>
      <DialogContent
        showCloseButton={false}

      >
        <DialogHeader className="text-left space-y-2">
          <DialogTitle className="text-lg font-bold">
            {title}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {body}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 pt-2">
          <Button
            autoFocus
            variant="outline"
            className="w-full rounded-lg min-h-11"
            onClick={onKeep}
          >
            Manter rascunho
          </Button>
          <Button
            variant="destructive"
            className="w-full rounded-lg min-h-11 bg-destructive/10 text-destructive hover:bg-destructive/20"
            onClick={onDiscard}
          >
            Descartar rascunho
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
