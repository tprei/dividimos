"use client";

import { Fragment } from "react";
import { ChevronDown, Equal } from "lucide-react";
import { AvatarStack, type AvatarStackPerson } from "@/components/shared/avatar-stack";
import { Money } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ItemDivisionEditor } from "@/components/bill/item-division-editor";
import type { ItemDivisionParticipant } from "@/components/bill/item-division-editor";
import { divisionForItem, equalDivision, isItemAssigned, type ItemDivisionValue } from "@/lib/item-division";
import { cn } from "@/lib/utils";
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
  onToggleItem: (itemId: string) => void;
  onSaveDivision: (itemId: string, value: ItemDivisionValue) => void;
  onCloseDivision: () => void;
}

function participantEntries(participants: User[], guests: Guest[]): ItemDivisionParticipant[] {
  return [
    ...participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      handle: participant.handle,
      avatarUrl: participant.avatarUrl ?? null,
      isGuest: false,
    })),
    ...guests.map((guest) => ({
      id: guest.id,
      name: guest.name,
      handle: null,
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

export function SplitSection({
  items,
  participants,
  guests,
  splits,
  serviceFeeCents,
  fixedFees,
  grandTotal,
  expandedId,
  onToggleItem,
  onSaveDivision,
  onCloseDivision,
}: SplitSectionProps) {
  const people = participantEntries(participants, guests);
  const peopleIds = new Set(people.map((person) => person.id));
  const unassignedCount = items.filter((item) => !isItemAssigned(item, splits, peopleIds)).length;

  function divideAllEqually() {
    for (const item of items) {
      const division = equalDivision(people.map((person) => person.id), item.totalPriceCents);
      if (division) onSaveDivision(item.id, division);
    }
  }

  return (
    <div className="px-4 py-3">
      <h2 className="text-sm leading-5 font-semibold">Quem consumiu</h2>
      <Button
        type="button"
        variant="outline"
        onClick={divideAllEqually}
        disabled={people.length === 0 || items.length === 0}
        className="mt-2 min-h-11 w-full"
      >
        <Equal className="size-4 shrink-0" aria-hidden="true" />
        Dividir tudo igualmente
      </Button>
      {unassignedCount > 0 && (
        <p className="mt-2 text-xs leading-4 text-muted-foreground">
          {unassignedCount === 1 ? "1 item sem divisão" : `${unassignedCount} de ${items.length} itens sem divisão`}
        </p>
      )}
      <div className="mt-4 divide-y divide-border rounded-2xl border bg-card">
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
                <span className="min-w-0 flex-1 text-[15px] font-semibold">
                  {item.description || "Item sem nome"}
                </span>
                <Money cents={item.totalPriceCents} className="shrink-0 text-sm" />
                {isItemAssigned(item, splits, peopleIds) ? (
                  <AvatarStack people={assignees} />
                ) : (
                  <Badge variant="secondary" className="shrink-0">
                    Pendente
                  </Badge>
                )}
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    expanded && "rotate-180",
                  )}
                />
              </button>
              {expanded && (
                <ItemDivisionEditor
                  itemId={item.id}
                  itemName={item.description || "Item sem nome"}
                  itemCents={item.totalPriceCents}
                  participants={people}
                  value={division}
                  onSave={(value) => onSaveDivision(item.id, value)}
                  onClose={onCloseDivision}
                />
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

