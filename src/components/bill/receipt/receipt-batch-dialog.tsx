"use client";

import { useState } from "react";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { ItemDivisionParticipant } from "@/components/bill/item-division-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ReceiptBatchDialogProps {
  open: boolean;
  selectedCount: number;
  participants: ItemDivisionParticipant[];
  onOpenChange: (open: boolean) => void;
  onApply: (participantIds: string[]) => void;
}

export function ReceiptBatchDialog({
  open,
  selectedCount,
  participants,
  onOpenChange,
  onApply,
}: ReceiptBatchDialogProps) {
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const activeIds = selectedIds ?? participants.map((participant) => participant.id);

  const toggleParticipant = (participantId: string) => {
    setSelectedIds(
      activeIds.includes(participantId)
        ? activeIds.filter((id) => id !== participantId)
        : [...activeIds, participantId],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Atribuir itens</DialogTitle>
          <DialogDescription>
            {selectedCount} {selectedCount === 1 ? "item selecionado" : "itens selecionados"} na leitura do recibo.
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
          {participants.map((participant) => (
            <label key={participant.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={activeIds.includes(participant.id)}
                onChange={() => toggleParticipant(participant.id)}
                aria-label={`Atribuir a ${participant.name}`}
              />
              {participant.isGuest ? (
                <GuestAvatar size="sm" />
              ) : (
                <UserAvatar name={participant.name} avatarUrl={participant.avatarUrl} size="sm" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{participant.name}</span>
            </label>
          ))}
        </div>
        <Button
          className="min-h-11 w-full text-base font-bold"
          disabled={activeIds.length === 0 || selectedCount === 0}
          onClick={() => onApply(activeIds)}
        >
          Aplicar em {selectedCount} {selectedCount === 1 ? "item" : "itens"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
