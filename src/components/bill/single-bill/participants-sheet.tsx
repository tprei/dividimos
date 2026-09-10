"use client";

import { ParticipantsStep } from "@/components/bill/wizard/participants-step";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Me, UserProfile } from "@/types/ledger";
import type { User } from "@/types";

export interface SingleBillParticipantsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: Me;
  participants: User[];
  guests: { id: string; name: string }[];
  onAddParticipant: (profile: UserProfile) => void;
  onRemoveParticipant: (id: string) => void;
  onAddGuest: (name: string, phone?: string) => void;
  onRemoveGuest: (id: string) => void;
  hasContactPicker: boolean;
  onPickContacts: () => Promise<void>;
}

export function SingleBillParticipantsSheet({
  open,
  onOpenChange,
  me,
  participants,
  guests,
  onAddParticipant,
  onRemoveParticipant,
  onAddGuest,
  onRemoveGuest,
  hasContactPicker,
  onPickContacts,
}: SingleBillParticipantsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92dvh] overflow-y-auto px-4 pb-8">
        <SheetHeader className="px-0">
          <SheetTitle>Participantes</SheetTitle>
          <SheetDescription>Adicione quem participa desta conta.</SheetDescription>
        </SheetHeader>
        <ParticipantsStep
          me={me}
          participants={participants}
          guests={guests}
          selectedGroupId={null}
          groups={[]}
          createGroup={{ enabled: false, name: "" }}
          onToggleCreateGroup={() => undefined}
          onCreateGroupName={() => undefined}
          onSelectGroup={() => undefined}
          onAddParticipant={onAddParticipant}
          onRemoveParticipant={onRemoveParticipant}
          onAddGuest={onAddGuest}
          onRemoveGuest={onRemoveGuest}
          hasContactPicker={hasContactPicker}
          onPickContacts={onPickContacts}
          showGroupPicker={false}
        />
        <Button type="button" className="mt-4 w-full" onClick={() => onOpenChange(false)}>
          Concluir
        </Button>
      </SheetContent>
    </Sheet>
  );
}
