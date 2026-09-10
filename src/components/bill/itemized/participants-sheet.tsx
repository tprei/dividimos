"use client";

import { ParticipantsStep, type ParticipantsStepProps } from "@/components/bill/wizard/participants-step";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export interface ParticipantsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participants: ParticipantsStepProps;
}

export function ParticipantsSheet({ open, onOpenChange, participants }: ParticipantsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Participantes</SheetTitle>
          <SheetDescription>Escolha quem divide esta conta.</SheetDescription>
        </SheetHeader>
        <ParticipantsStep {...participants} showGroupPicker={false} />
      </SheetContent>
    </Sheet>
  );
}
