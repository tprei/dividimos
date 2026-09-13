"use client";

import { Fragment, useState } from "react";
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
  onAssignSelected: (itemIds: string[], personIds: string[]) => void;
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
  onAssignSelected,
}: SplitSectionProps) {
  const people = participantEntries(participants, guests);
  const peopleIds = new Set(people.map((person) => person.id));
  const unassignedCount = items.filter((item) => !isItemAssigned(item, splits, peopleIds)).length;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchPeopleIds, setBatchPeopleIds] = useState<string[]>([]);

  const selected = new Set(selectedIds);
  const batchPeople = new Set(batchPeopleIds);
  const allSelected = items.length > 0 && selectedIds.length === items.length;

  function divideAllEqually(): void {
    for (const item of items) {
      const division = equalDivision(people.map((person) => person.id), item.totalPriceCents);
      if (division) onSaveDivision(item.id, division);
    }
  }

  function toggleSelected(itemId: string): void {
    setSelectedIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId],
    );
  }

  function togglePerson(personId: string): void {
    setBatchPeopleIds((prev) =>
      prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId],
    );
  }

  function applyBatch(): void {
    onAssignSelected(selectedIds, batchPeopleIds);
    setSelectedIds([]);
  }

  return (
    <div className="space-y-3 px-4 py-3">
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
      <div className="rounded-2xl border bg-card p-3">
        <div className="flex items-center justify-between gap-3">
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelectedIds(allSelected ? [] : items.map((item) => item.id))}
              className="size-4 accent-primary"
            />
            Selecionar todos
          </label>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {selectedIds.length} de {items.length} selecionados
          </span>
        </div>

        {selectedIds.length > 0 && (
          <div className="mt-3 space-y-3 border-t pt-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Dividir itens selecionados entre">
              {people.map((person) => {
                const active = batchPeople.has(person.id);
                return (
                  <button
                    key={person.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => togglePerson(person.id)}
                    className={`min-h-11 rounded-full border px-3 text-xs font-semibold transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-transparent text-foreground"
                    }`}
                  >
                    {person.name}
                    {person.isGuest ? " (convidado)" : ""}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={applyBatch}
                disabled={batchPeopleIds.length === 0}
              >
                Dividir {selectedIds.length} {selectedIds.length === 1 ? "item" : "itens"} igualmente
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setSelectedIds([])}>
                Limpar seleção
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="divide-y divide-border rounded-2xl border bg-card">
        {items.map((item) => {
          const expanded = expandedId === item.id;
          const division = divisionForItem(item, splits);
          const assignees = assigneePeople(item, splits, people);
          const name = item.description || "Item sem nome";
          return (
            <Fragment key={item.id}>
              <div className="flex min-h-14 w-full min-w-0 items-center gap-2 px-4 py-2">
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleSelected(item.id)}
                  aria-label={`Selecionar ${name}`}
                  className="size-4 shrink-0 accent-primary"
                />
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => onToggleItem(item.id)}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                    {name}
                  </span>
                  <Money cents={item.totalPriceCents} className="shrink-0 text-sm" />
                  {isItemAssigned(item, splits, peopleIds) ? (
                    <>
                      <AvatarStack people={assignees} />
                      <span className="sr-only">
                        Dividido entre {assignees.map((person) => person.name).join(", ")}
                      </span>
                    </>
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
              </div>
              {expanded && (
                <ItemDivisionEditor
                  itemId={item.id}
                  itemName={name}
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

