"use client";

import type { ReactNode, RefObject } from "react";
import { ChevronDown, Users } from "lucide-react";
import { GroupSelect } from "@/components/bill/group-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import type { GroupSnapshot } from "@/types/ledger";

export interface AccountSectionProps {
  title: string;
  occurredOn: string;
  groupValue: string | null;
  groups: GroupSnapshot[];
  createGroupName: string;
  createGroupEnabled: boolean;
  dmEligible: boolean;
  participantCount: number;
  participantsOpen: boolean;
  titleRef: RefObject<HTMLInputElement | null>;
  onTitleChange: (title: string) => void;
  onOccurredOnChange: (date: string) => void;
  onGroupSelect: (groupId: string | null) => void;
  onCreateGroupName: (name: string) => void;
  onToggleCreateGroup: (enabled: boolean) => void;
  onOpenParticipants: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-bold">{label}</span>
      {children}
    </label>
  );
}

export function AccountSection({
  title,
  occurredOn,
  groupValue,
  groups,
  createGroupName,
  createGroupEnabled,
  dmEligible,
  participantCount,
  participantsOpen,
  titleRef,
  onTitleChange,
  onOccurredOnChange,
  onGroupSelect,
  onCreateGroupName,
  onToggleCreateGroup,
  onOpenParticipants,
}: AccountSectionProps) {
  return (
    <div className="space-y-5 px-4 py-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome">
          <Input
            ref={titleRef}
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Nome da conta"
            aria-label="Nome"
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
      <Field label="Grupo">
        <GroupSelect
          value={groupValue}
          groups={groups}
          onSelect={onGroupSelect}
          createValue={createGroupName}
          onCreateValueChange={onCreateGroupName}
          createGroupEnabled={createGroupEnabled}
          onToggleCreateGroup={onToggleCreateGroup}
          dmEligible={dmEligible}
        />
      </Field>
      <Button
        type="button"
        variant="outline"
        aria-expanded={participantsOpen}
        onClick={onOpenParticipants}
        className="flex min-h-11 w-full items-center justify-between rounded-xl px-4"
      >
        <span className="flex items-center gap-2">
          <Users className="size-4" />
          Participantes
        </span>
        <span className="flex items-center gap-2">
          <Badge variant="secondary">{participantCount}</Badge>
          <ChevronDown className="size-4 text-muted-foreground" />
        </span>
      </Button>
    </div>
  );
}
