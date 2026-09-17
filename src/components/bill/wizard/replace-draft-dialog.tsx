"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/shared/money";

export interface ReplaceDraftDialogProps {
  open: boolean;
  draftTitle: string;
  itemCount: number;
  totalCents: number;
  onReplace: () => void;
  onKeep: () => void;
}

export function ReplaceDraftDialog({
  open,
  draftTitle,
  itemCount,
  totalCents,
  onReplace,
  onKeep,
}: ReplaceDraftDialogProps) {
  return (
    <Dialog open={open} dismissable={false}>
      <DialogContent
        showCloseButton={false}
        className="w-full max-w-sm rounded-3xl bg-card p-6"
      >
        <DialogHeader className="text-left space-y-2">
          <DialogTitle className="text-lg font-bold">
            Substituir a conta em rascunho?
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            A nota escaneada vai substituir «{draftTitle}» ({itemCount} itens,{" "}
            <Money cents={totalCents} />). O rascunho atual será descartado.
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
            onClick={onReplace}
          >
            Substituir rascunho
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
