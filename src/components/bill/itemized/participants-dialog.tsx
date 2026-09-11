"use client";

import { ParticipantsStep, type ParticipantsStepProps } from "@/components/bill/wizard/participants-step";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface ParticipantsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: string;
  participants: Omit<ParticipantsStepProps, "showGroupPicker">;
}

export function ParticipantsDialog({ open, onOpenChange, description, participants }: ParticipantsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[85dvh] grid-rows-[auto_1fr_auto] gap-3 p-4">
        <DialogHeader>
          <DialogTitle>Participantes</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1">
          <ParticipantsStep {...participants} showGroupPicker={false} />
        </div>
        <Button type="button" className="min-h-11 w-full" onClick={() => onOpenChange(false)}>
          Concluir
        </Button>
      </DialogContent>
    </Dialog>
  );
}
