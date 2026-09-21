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
  pendingParticipantIds?: string[];
  closePending?: boolean;
  cancelPending?: boolean;
  onRemove: (participantId: string) => void;
  onClose: () => void;
  onCancel: () => void;
}

export function RoomHostControls({
  participants,
  fullyAssignedCount,
  totalItemCount,
  complete,
  closed,
  pendingParticipantIds = [],
  closePending = false,
  cancelPending = false,
  onRemove,
  onClose,
  onCancel,
}: RoomHostControlsProps) {
  const [removeTarget, setRemoveTarget] = useState<AssignmentRoomParticipant | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4" aria-labelledby="room-host-heading">
      <div>
        <h2 id="room-host-heading" className="font-heading font-semibold">Controle da sala</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {fullyAssignedCount} de {totalItemCount} linhas totalmente escolhidas
        </p>
        {!complete && (
          <p className="mt-1 text-sm">Ainda há quantidades sem dono.</p>
        )}
      </div>

      <details className="space-y-2">
        <summary className="flex min-h-11 cursor-pointer items-center rounded-xl border px-3 text-sm font-semibold">
          Gerenciar pessoas
        </summary>
        <ul className="space-y-2">
          {participants.map((participant) => {
            const pending = pendingParticipantIds.includes(participant.id);
            // The ordinal-zero host cannot be removed from their own room;
            // everyone else keeps a correction path even after closing.
            const removable = participant.ordinal !== 0;
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
                    disabled={pending}
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

      {!closed && (
        <div className="space-y-2 border-t pt-4">
          <Button
            type="button"
            className="min-h-11 w-full"
            disabled={!complete || closePending}
            onClick={onClose}
          >
            {complete ? <CheckCircle2 className="size-4" /> : <Lock className="size-4" />}
            {closePending ? "Fechando..." : "Fechar escolhas"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full text-destructive"
            disabled={cancelPending}
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
              disabled={removeTarget ? pendingParticipantIds.includes(removeTarget.id) : true}
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
              disabled={cancelPending}
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
