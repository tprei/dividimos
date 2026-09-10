"use client";

import { Users } from "lucide-react";
import { GroupSelect } from "@/components/bill/group-select";
import { SingleBillParticipantsSheet } from "@/components/bill/single-bill/participants-sheet";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import type { Guest } from "@/stores/bill-store";
import type { ExpensePayer, User } from "@/types";
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
  payers: ExpensePayer[];
  participantCount: number;
  hasPayer: boolean;
  participantsOpen: boolean;
  hasContactPicker: boolean;
  onTotalChange: (cents: number) => void;
  onTitleChange: (title: string) => void;
  onOccurredOnChange: (date: string) => void;
  onGroupSelect: (value: string | null) => void;
  onCreateGroupNameChange: (name: string) => void;
  onToggleCreateGroup: (enabled: boolean) => void;
  onPayerSelect: (userId: string) => void;
  onParticipantsOpenChange: (open: boolean) => void;
  onAddParticipant: (profile: UserProfile) => void;
  onRemoveParticipant: (id: string) => void;
  onAddGuest: (name: string, phone?: string) => void;
  onRemoveGuest: (id: string) => void;
  onPickContacts: () => Promise<void>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-bold">{label}</span>
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
  payers,
  participantCount,
  hasPayer,
  participantsOpen,
  hasContactPicker,
  onTotalChange,
  onTitleChange,
  onOccurredOnChange,
  onGroupSelect,
  onCreateGroupNameChange,
  onToggleCreateGroup,
  onPayerSelect,
  onParticipantsOpenChange,
  onAddParticipant,
  onRemoveParticipant,
  onAddGuest,
  onRemoveGuest,
  onPickContacts,
}: SingleBillDetailsProps) {
  return (
    <>
      <div className="px-4 pb-2">
        <label className="flex items-center justify-center rounded-xl border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <span className="sr-only">Valor total</span>
          <span className="pl-3 text-lg font-bold text-muted-foreground">R$</span>
          <CurrencyInput
            valueCents={totalCents}
            onChangeCents={onTotalChange}
            className="h-14 flex-1 text-4xl font-semibold"
          />
        </label>
        {totalCents <= 0 && <p className="pt-1 text-xs text-destructive">Informe o valor da conta.</p>}
      </div>
      <div className="space-y-5 px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome">
            <Input
              aria-label="Nome"
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              className="h-11 rounded-xl"
            />
          </Field>
          <Field label="Data">
            <Input
              aria-label="Data"
              type="date"
              value={occurredOn}
              onChange={(event) => onOccurredOnChange(event.target.value)}
              className="h-11 rounded-xl"
            />
          </Field>
        </div>
        {!title.trim() && <p className="text-xs text-destructive">Informe o nome da conta.</p>}
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
        <section className="space-y-2">
          <h2 className="text-xs font-bold">Quem pagou</h2>
          <div className="flex flex-wrap gap-2">
            {participants.map((participant) => {
              const selected = payers.some((payer) => payer.userId === participant.id && payer.amountCents > 0);
              return (
                <button
                  key={participant.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onPayerSelect(participant.id)}
                  className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors ${
                    selected
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-card text-foreground"
                  }`}
                >
                  <UserAvatar name={participant.name} avatarUrl={participant.avatarUrl} size="xs" />
                  <span className="max-w-28 truncate">{participant.name.split(" ")[0]}</span>
                </button>
              );
            })}
          </div>
          {!hasPayer && <p className="text-xs text-destructive">Selecione quem pagou.</p>}
        </section>
        <div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full justify-between rounded-xl px-4"
            onClick={() => onParticipantsOpenChange(true)}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Users className="size-4" />
              Participantes
            </span>
            <Badge variant="secondary">{participantCount}</Badge>
          </Button>
          {participantCount < 2 && <p className="pt-2 text-xs text-destructive">Adicione pelo menos uma pessoa.</p>}
        </div>
      </div>
      <SingleBillParticipantsSheet
        open={participantsOpen}
        onOpenChange={onParticipantsOpenChange}
        me={me}
        participants={participants}
        guests={guests}
        onAddParticipant={onAddParticipant}
        onRemoveParticipant={onRemoveParticipant}
        onAddGuest={onAddGuest}
        onRemoveGuest={onRemoveGuest}
        hasContactPicker={hasContactPicker}
        onPickContacts={onPickContacts}
      />
    </>
  );
}
