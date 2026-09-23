"use client";

import { Ban, CheckCircle2, Lock, UserMinus } from "lucide-react";
import { useState } from "react";
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
import type { AssignmentRoomParticipant } from "@/types/assignment-room";

interface RoomHostControlsProps {
  participants: AssignmentRoomParticipant[];
  fullyAssignedCount: number;
  totalItemCount: number;
  complete: boolean;
  closed: boolean;
  disabled?: boolean;
  pendingParticipantIds?: string[];
  closePending?: boolean;
  cancelPending?: boolean;
  onRemove: (participantId: string) => void;
  onReturnToReview?: () => void;
  onClose: () => void;
  onCancel: () => void;
}

export function RoomHostControls({
  participants,
  fullyAssignedCount,
  totalItemCount,
  complete,
  closed,
  disabled = false,
  pendingParticipantIds = [],
  closePending = false,
  cancelPending = false,
  onRemove,
  onReturnToReview,
  onClose,
  onCancel,
}: RoomHostControlsProps) {
  const [removeTarget, setRemoveTarget] = useState<AssignmentRoomParticipant | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby="room-host-heading">

      <h2 id="room-host-heading" className="sr-only">Controle da sala</h2>

      <details className="space-y-2">
        <summary className="flex min-h-11 cursor-pointer items-center rounded-xl border px-3 text-sm font-semibold">
          Gerenciar pessoas
        </summary>
        <ul className="space-y-2">
          {participants.map((participant) => {
            const pending = pendingParticipantIds.includes(participant.id);
            const removable = !closed && participant.ordinal !== 0;
            return (
              <li key={participant.id} className="flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2">
                <UserAvatar name={participant.displayName} avatarUrl={participant.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {participant.displayName}
                </span>
                {participant.removed ? (
                  <span className="text-xs text-muted-foreground">Removido</span>
                ) : removable ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="min-h-11 min-w-11"
                    aria-label={`Remover ${participant.displayName}`}
                    disabled={disabled || pending}
                    onClick={() => setRemoveTarget(participant)}
                  >
                    <UserMinus className="size-4" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </details>

      {closed ? (
        <div className="border-t pt-4">
          <Button
            type="button"
            className="min-h-12 w-full text-base font-semibold"
            disabled={disabled || !onReturnToReview}
            onClick={onReturnToReview}
          >
            Voltar à revisão
          </Button>
        </div>
      ) : (
        <div className="space-y-2 border-t pt-4">
          <Button
            type="button"
            className="min-h-12 w-full text-base font-semibold"
            disabled={!complete || closePending || disabled}
            onClick={onClose}
          >
            {complete ? <CheckCircle2 className="size-4" /> : <Lock className="size-4" />}
            {closePending
              ? "Fechando..."
              : complete
                ? "Fechar escolhas"
                : totalItemCount === 0
                  ? "Sem itens para fechar"
                  : `Fechar escolhas · ${totalItemCount - fullyAssignedCount} ${totalItemCount - fullyAssignedCount === 1 ? "pendente" : "pendentes"}`}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full text-destructive"
            disabled={cancelPending || disabled}
            onClick={() => setCancelOpen(true)}
          >
            <Ban className="size-4" />
            Cancelar sala
          </Button>
        </div>
      )}

      <Dialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover {removeTarget?.displayName}?</DialogTitle>
            <DialogDescription>
              As escolhas dessa pessoa serão liberadas para o grupo. O convite também será renovado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              type="button"
              variant="destructive"
              disabled={disabled || (removeTarget ? pendingParticipantIds.includes(removeTarget.id) : true)}
              onClick={() => {
                if (!removeTarget) return;
                onRemove(removeTarget.id);
                setRemoveTarget(null);
              }}
            >
              Remover e liberar itens
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar esta sala?</DialogTitle>
            <DialogDescription>
              Ninguém poderá continuar escolhendo itens. Essa ação não registra uma conta.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              type="button"
              variant="destructive"
              disabled={disabled || cancelPending}
              onClick={() => {
                onCancel();
                setCancelOpen(false);
              }}
            >
              Cancelar sala
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
