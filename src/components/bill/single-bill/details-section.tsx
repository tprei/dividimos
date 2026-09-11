"use client";

import { Users } from "lucide-react";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { AvatarStack, type AvatarStackPerson } from "@/components/shared/avatar-stack";
import { GroupSelect } from "@/components/bill/group-select";
import { ParticipantsDialog } from "@/components/bill/itemized/participants-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import type { Guest } from "@/stores/bill-store";
import type { User } from "@/types";
import type { GroupSnapshot, Me, UserProfile } from "@/types/ledger";

export interface SingleBillDetailsProps {
  me: Me;
  groups: GroupSnapshot[];
  totalCents: number;
  title: string;
  occurredOn: string;
  groupSelection: string | null;
  createGroupName: string;
  createGroupEnabled: boolean;
  defaultGroupName: string;
  dmEligible: boolean;
  participants: User[];
  guests: Guest[];
  participantCount: number;
  participantsOpen: boolean;
  hasContactPicker: boolean;
  onTotalChange: (cents: number) => void;
  onTitleChange: (title: string) => void;
  onOccurredOnChange: (date: string) => void;
  onGroupSelect: (value: string | null) => void;
  onCreateGroupNameChange: (name: string) => void;
  onToggleCreateGroup: (enabled: boolean) => void;
  onParticipantsOpenChange: (open: boolean) => void;
  onAddParticipant: (profile: UserProfile) => void;
  onRemoveParticipant: (id: string) => void;
  onAddGuest: (name: string, phone?: string) => void;
  onRemoveGuest: (id: string) => void;
  onPickContacts: () => Promise<void>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <span className="text-sm leading-5 font-semibold">{label}</span>
      {children}
    </label>
  );
}

export function SingleBillDetails({
  me,
  groups,
  totalCents,
  title,
  occurredOn,
  groupSelection,
  createGroupName,
  createGroupEnabled,
  defaultGroupName,
  dmEligible,
  participants,
  guests,
  participantCount,
  participantsOpen,
  hasContactPicker,
  onTotalChange,
  onTitleChange,
  onOccurredOnChange,
  onGroupSelect,
  onCreateGroupNameChange,
  onToggleCreateGroup,
  onParticipantsOpenChange,
  onAddParticipant,
  onRemoveParticipant,
  onAddGuest,
  onRemoveGuest,
  onPickContacts,
}: SingleBillDetailsProps) {
  const people: AvatarStackPerson[] = [
    ...participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      avatarUrl: participant.avatarUrl ?? null,
    })),
    ...guests.map((guest) => ({
      id: guest.id,
      name: guest.name,
      avatarUrl: null,
      isGuest: true,
    })),
  ];
  const participantSummary = people
    .map((person) => (person.id === me.id ? "Você" : person.name.split(" ")[0]))
    .join(", ");
  const selectedGroup = groups.find((snapshot) => snapshot.group.id === groupSelection);
  const inviteeNames = selectedGroup
    ? participants
        .filter(
          (participant) =>
            participant.id !== me.id &&
            !selectedGroup.members.some((member) => member.userId === participant.id),
        )
        .map((participant) => participant.name.split(" ")[0])
    : [];

  return (
    <>
      <div className="flex flex-col gap-6 px-4 pb-4">
        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-center rounded-xl border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <span className="sr-only">Valor total</span>
            <span className="pl-4 text-lg font-bold text-muted-foreground">R$</span>
            <CurrencyInput
              valueCents={totalCents}
              onChangeCents={onTotalChange}
              className="h-14 min-w-0 flex-1 text-4xl font-semibold font-mono tabular-nums"
            />
          </label>
          <AmountQuickAdd valueCents={totalCents} onChangeCents={onTotalChange} />
          {totalCents <= 0 && (
            <p className="text-xs leading-4 text-destructive">Informe o valor da conta.</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nome">
              <Input
                aria-label="Nome"
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
                className="h-11 rounded-xl"
              />
            </Field>
            <Field label="Data">
              <DateField
                label="Data"
                value={occurredOn}
                onChange={onOccurredOnChange}
              />
            </Field>
          </div>
          {!title.trim() && (
            <p className="text-xs leading-4 text-destructive">Informe o nome da conta.</p>
          )}
        </div>
        <Field label="Grupo">
          <GroupSelect
            value={groupSelection}
            groups={groups}
            onSelect={onGroupSelect}
            createValue={createGroupName || defaultGroupName}
            onCreateValueChange={onCreateGroupNameChange}
            createGroupEnabled={createGroupEnabled}
            onToggleCreateGroup={onToggleCreateGroup}
            dmEligible={dmEligible}
          />
        </Field>
        <div>
          <Button
            type="button"
            variant="outline"
            className="min-h-14 w-full justify-between rounded-xl px-4"
            aria-label={`Participantes: ${participantSummary || "nenhum"}`}
            onClick={() => onParticipantsOpenChange(true)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Users className="size-4 shrink-0" />
              <span className="min-w-0 truncate text-sm font-semibold">
                {participantSummary || "Quem participa?"}
              </span>
            </span>
            {people.length > 0 ? (
              <AvatarStack people={people} />
            ) : (
              <Badge variant="secondary">{participantCount}</Badge>
            )}
          </Button>
          <div className="min-h-5 pt-1">
            {participantCount < 2 ? (
              <p className="text-xs leading-4 text-destructive">Adicione pelo menos uma pessoa.</p>
            ) : inviteeNames.length > 0 ? (
              <p className="text-xs leading-4 text-muted-foreground">
                {inviteeNames.join(", ")} {inviteeNames.length > 1 ? "serão convidados" : "será convidado"} ao grupo.
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <ParticipantsDialog
        open={participantsOpen}
        onOpenChange={onParticipantsOpenChange}
        description="Adicione quem participa desta conta."
        participants={{
          me,
          participants,
          guests,
          selectedGroupId: null,
          groups: [],
          createGroup: { enabled: false, name: "" },
          onToggleCreateGroup: () => undefined,
          onCreateGroupName: () => undefined,
          onSelectGroup: () => undefined,
          onAddParticipant,
          onRemoveParticipant,
          onAddGuest,
          onRemoveGuest,
          hasContactPicker,
          onPickContacts,
        }}
      />
    </>
  );
}
