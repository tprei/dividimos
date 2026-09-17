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
      <DialogContent className="gap-3 p-4">
        <DialogHeader className="shrink-0">
          <DialogTitle>Participantes</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <ParticipantsStep {...participants} showGroupPicker={false} />
        </div>
        <Button type="button" className="min-h-11 w-full shrink-0" onClick={() => onOpenChange(false)}>
          Concluir
        </Button>
      </DialogContent>
    </Dialog>
  );
}
