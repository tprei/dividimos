"use client";

import { Ban, Lock, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { RoomParticipantMoney } from "@/lib/assignment-room-projection";
import type { AssignmentRoomParticipant } from "@/types/assignment-room";

interface RoomHostControlsProps {
  unownedLineCount: number;
  complete: boolean;
  closed: boolean;
  disabled?: boolean;
  closePending?: boolean;
  onReturnToReview?: () => void;
  onClose: () => void;
}

export function RoomHostControls({ unownedLineCount, complete, closed, disabled = false, closePending = false, onReturnToReview, onClose }: RoomHostControlsProps) {
  return (
    <footer className="sticky bottom-0 z-10 border-t bg-background/95 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto max-w-lg px-4 md:max-w-2xl">
        <Button type="button" className="h-12 w-full text-base font-semibold disabled:border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100" disabled={disabled || (closed ? !onReturnToReview : !complete || closePending)} onClick={closed ? onReturnToReview : onClose}>
          {!closed && !complete && <Lock aria-hidden="true" className="size-4" />}
          {closed ? "Voltar à revisão" : closePending ? "Encerrando..." : complete ? "Encerrar sala" : `Encerrar sala · ${unownedLineCount} sem dono`}
        </Button>
      </div>
    </footer>
  );
}

export function RoomHostMenu({ disabled = false, onCancel }: { disabled?: boolean; onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger aria-label="Mais" className="flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
          <MoreHorizontal aria-hidden="true" className="size-5" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52">
          <Button variant="ghost" className="min-h-11 justify-start text-destructive-text" disabled={disabled} onClick={() => { setOpen(false); setCancelOpen(true); }}><Ban aria-hidden="true" className="size-4" />Cancelar sala</Button>
        </PopoverContent>
      </Popover>
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent showCloseButton={false} aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Cancelar sala</DialogTitle></DialogHeader>
          <DialogFooter showCloseButton>
            <Button variant="destructive" disabled={disabled} onClick={() => { onCancel(); setCancelOpen(false); }}>Cancelar sala</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RoomHostPerson({ participant, label, money, disabled, removable, onRemove }: {
  participant: AssignmentRoomParticipant;
  label: string;
  money?: RoomParticipantMoney;
  disabled: boolean;
  removable: boolean;
  onRemove: (participantId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={participant.displayName} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border bg-card py-1 pr-3 pl-1.5 text-xs font-medium hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary">
        {participant.isGuest
          ? <GuestAvatar id={participant.id} name={participant.displayName} size="xs" />
          : <UserAvatar id={participant.id} name={participant.displayName} avatarUrl={participant.avatarUrl} size="xs" />}
        <span title={participant.displayName} className="max-w-24 truncate">{label}</span>
        <span className="text-muted-foreground tabular-nums">{money ? <Money cents={money.itemsCents} /> : "—"}</span>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverTitle>{participant.displayName}</PopoverTitle>
        {money && <PopoverDescription>{money.lineCount} {money.lineCount === 1 ? "item" : "itens"} · <Money cents={money.itemsCents} /></PopoverDescription>}
        {participant.ordinal !== 0 && removable && (
          <Button variant="ghost" size="sm" className="mt-2 h-9 w-full rounded-lg bg-destructive/10 text-xs font-semibold text-destructive-text hover:bg-destructive/15" disabled={disabled} onClick={() => { onRemove(participant.id); setOpen(false); }}>
            <span>{money && money.lineCount > 0 ? <>Remover · libera <Money cents={money.itemsCents} /></> : "Remover da sala"}</span>
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
