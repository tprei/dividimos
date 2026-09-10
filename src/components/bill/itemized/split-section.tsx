"use client";

import { Fragment } from "react";
import { ChevronDown, Users } from "lucide-react";
import { AvatarStack, type AvatarStackPerson } from "@/components/shared/avatar-stack";
import { Money } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ItemDivisionEditor } from "@/components/bill/item-division-editor";
import type { ItemDivisionParticipant } from "@/components/bill/item-division-editor";
import { divisionForItem, type ItemDivisionValue } from "@/lib/item-division";
import type { ExpenseSplit, Guest } from "@/stores/bill-store";
import type { ExpenseItem, User } from "@/types";
export interface SplitSectionProps {
  items: ExpenseItem[];
  participants: User[];
  guests: Guest[];
  splits: ExpenseSplit[];
  serviceFeeCents: number;
  fixedFees: number;
  grandTotal: number;
  expandedId: string | null;
  participantsOpen: boolean;
  onToggleItem: (itemId: string) => void;
  onSaveDivision: (itemId: string, value: ItemDivisionValue) => void;
  onCancelDivision: () => void;
  onOpenParticipants: () => void;
}

function participantEntries(participants: User[], guests: Guest[]): ItemDivisionParticipant[] {
  return [
    ...participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      avatarUrl: participant.avatarUrl ?? null,
      isGuest: false,
    })),
    ...guests.map((guest) => ({
      id: guest.id,
      name: guest.name,
      avatarUrl: null,
      isGuest: true,
    })),
  ];
}

function assigneePeople(
  item: ExpenseItem,
  splits: ExpenseSplit[],
  people: ItemDivisionParticipant[],
): AvatarStackPerson[] {
  const personById = new Map(people.map((person) => [person.id, person]));
  return splits
    .filter((split) => split.itemId === item.id)
    .map((split) => personById.get(split.userId))
    .filter((person): person is ItemDivisionParticipant => person !== undefined);
}

function ParticipantDisclosure({
  count,
  open,
  onOpen,
}: {
  count: number;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-expanded={open}
      onClick={onOpen}
      className="flex min-h-11 w-full items-center justify-between rounded-xl px-4"
    >
      <span className="flex items-center gap-2">
        <Users className="size-4" />
        Participantes
      </span>
      <span className="flex items-center gap-2">
        <Badge variant="secondary">{count}</Badge>
        <ChevronDown className="size-4 text-muted-foreground" />
      </span>
    </Button>
  );
}

export function SplitSection({
  items,
  participants,
  guests,
  splits,
  serviceFeeCents,
  fixedFees,
  grandTotal,
  expandedId,
  participantsOpen,
  onToggleItem,
  onSaveDivision,
  onCancelDivision,
  onOpenParticipants,
}: SplitSectionProps) {
  const people = participantEntries(participants, guests);

  return (
    <div className="space-y-3 px-4 py-3">
      <ParticipantDisclosure count={people.length} open={participantsOpen} onOpen={onOpenParticipants} />
      <div className="divide-y divide-border rounded-2xl border bg-card">
        {items.map((item) => {
          const expanded = expandedId === item.id;
          const division = divisionForItem(item, splits);
          const assignees = assigneePeople(item, splits, people);
          return (
            <Fragment key={item.id}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => onToggleItem(item.id)}
                className="flex min-h-14 w-full min-w-0 items-center gap-3 px-4 py-2 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                  {item.description || "Item sem nome"}
                </span>
                <Money cents={item.totalPriceCents} className="shrink-0 text-sm" />
                {division && assignees.length > 0 ? (
                  <AvatarStack people={assignees} />
                ) : (
                  <Badge variant="secondary" className="shrink-0">
                    Pendente
                  </Badge>
                )}
              </button>
              {expanded && (
                <div className="px-4 pb-4 pt-1">
                  <ItemDivisionEditor
                    itemId={item.id}
                    itemName={item.description || "Item sem nome"}
                    itemCents={item.totalPriceCents}
                    participants={people}
                    value={division}
                    onSave={(value) => onSaveDivision(item.id, value)}
                    onCancel={onCancelDivision}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
          <span className="text-sm text-muted-foreground">Taxa de serviço</span>
          <Money cents={serviceFeeCents} className="text-sm" />
        </div>
        {fixedFees > 0 && (
          <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
            <span className="text-sm text-muted-foreground">Taxas fixas</span>
            <Money cents={fixedFees} className="text-sm" />
          </div>
        )}
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
          <span className="text-sm font-bold">Total</span>
          <Money cents={grandTotal} className="text-sm font-bold" />
        </div>
      </div>
    </div>
  );
}

