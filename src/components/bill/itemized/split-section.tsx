"use client";

import { useState } from "react";
import { Equal } from "lucide-react";
import { ItemDivisionEditor } from "@/components/bill/item-division-editor";
import type { ItemDivisionParticipant } from "@/components/bill/item-division-editor";
import { PersonShareButton, PersonToggle } from "@/components/bill/person-toggle";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { formatBRL } from "@/lib/currency";
import { formatExpenseQuantity, type ExpenseQuantity } from "@/lib/expense-quantity";
import {
  divisionForItem,
  equalDivision,
  isItemAssigned,
  shareArcs,
  sharePercentText,
  type ItemDivisionValue,
} from "@/lib/item-division";
import { displayNames } from "@/lib/people";
import type { ExpenseSplit, Guest } from "@/stores/bill-store";
import type { ExpenseItem, User } from "@/types";

/** Above this many items, tapping every row is the slow way. */
const DENSE_ITEM_THRESHOLD = 6;
export interface SplitSectionProps {
  viewerId: string;
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
  onUnassign: (itemId: string, personId: string) => void;
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

export function SplitSection({
  viewerId,
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
  onUnassign,
  onCloseDivision,
  onAssignSelected,
}: SplitSectionProps) {
  const people = participantEntries(participants, guests);
  const peopleIds = new Set(people.map((person) => person.id));
  const labels = displayNames(people, { style: "short", viewerId });
  const unassignedCount = items.filter((item) => !isItemAssigned(item, splits, peopleIds)).length;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchPeopleIds, setBatchPeopleIds] = useState<string[]>([]);

  const selected = new Set(selectedIds);
  const allSelected = items.length > 0 && selectedIds.length === items.length;

  function divideAllEqually(): void {
    for (const item of items) {
      const division = equalDivision(people.map((person) => person.id), item.totalPriceCents);
      if (division) onSaveDivision(item.id, division);
    }
  }

  function toggleConsumer(item: ExpenseItem, current: readonly string[], personId: string): void {
    const next = current.includes(personId)
      ? current.filter((id) => id !== personId)
      : people.map((person) => person.id).filter((id) => id === personId || current.includes(id));
    if (next.length === 0) {
      onUnassign(item.id, personId);
      return;
    }
    const division = equalDivision(next, item.totalPriceCents);
    if (division) onSaveDivision(item.id, division);
  }

  function applyBatch(): void {
    onAssignSelected(selectedIds, batchPeopleIds);
    setSelectedIds([]);
  }

  // Short receipts are quicker to tap through than to select; the batch
  // controls only earn their space once a receipt is long enough that
  // opening every row is the slow way.
  const dense = items.length > DENSE_ITEM_THRESHOLD;

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex min-h-9 items-center justify-between gap-3 px-1">
        <p className="min-w-0 text-xs text-muted-foreground">
          {unassignedCount === 0
            ? null
            : unassignedCount === 1
              ? "1 item sem divisão"
              : `${unassignedCount} de ${items.length} itens sem divisão`}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={divideAllEqually}
          disabled={people.length === 0 || items.length === 0}
          className="shrink-0"
        >
          <Equal aria-hidden="true" />
          Dividir tudo igualmente
        </Button>
      </div>
      {dense && (
        <div className="space-y-2 rounded-[0.75rem] border bg-card px-3 py-2">
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
            <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {selectedIds.length} de {items.length} selecionados
            </span>
          </div>
          {selectedIds.length > 0 && (
            <div className="space-y-2 border-t pt-2">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Dividir itens selecionados entre">
                {people.map((person) => (
                  <PersonToggle
                    key={person.id}
                    id={person.id}
                    label={labels.get(person.id) ?? person.name}
                    name={person.name}
                    avatarUrl={person.avatarUrl}
                    isGuest={person.isGuest}
                    selected={batchPeopleIds.includes(person.id)}
                    onToggle={() =>
                      setBatchPeopleIds((prev) =>
                        prev.includes(person.id) ? prev.filter((id) => id !== person.id) : [...prev, person.id],
                      )
                    }
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={applyBatch} disabled={batchPeopleIds.length === 0}>
                  Dividir {selectedIds.length} {selectedIds.length === 1 ? "item" : "itens"} igualmente
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
                  Limpar seleção
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <ul className="divide-y divide-border overflow-hidden rounded-[0.75rem] border bg-card">
        {items.map((item) => {
          const expanded = expandedId === item.id;
          const division = divisionForItem(item, splits);
          const assigned = isItemAssigned(item, splits, peopleIds);
          const consumers = (division?.shares ?? [])
            .map((share) => share.participantId)
            .filter((id) => peopleIds.has(id));
          const custom = assigned && division !== null && division.mode !== "equal";
          const arcs = shareArcs(
            people.map((person) => person.id),
            assigned ? division : null,
          );
          const name = item.description || "Item sem nome";
          return (
            <li key={item.id}>
              <div className="space-y-2 px-3 py-2.5">
                <div className="flex min-h-8 min-w-0 items-center gap-2">
                  {dense && (
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() =>
                        setSelectedIds((prev) =>
                          prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id],
                        )
                      }
                      aria-label={`Selecionar ${name}`}
                      className="size-4 shrink-0 accent-primary"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" title={name}>{name}</p>
                    {item.quantity !== 1000 && (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatExpenseQuantity(item.quantity as ExpenseQuantity)} × {formatBRL(item.unitPriceCents)}
                      </p>
                    )}
                  </div>
                  {!assigned && <Chip tone="warning">Pendente</Chip>}
                  <Money cents={item.totalPriceCents} className="shrink-0 text-sm" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={expanded}
                    aria-label={`Ajustar divisão de ${name}`}
                    onClick={() => onToggleItem(item.id)}
                    className="shrink-0 px-2"
                  >
                    {expanded ? "Fechar" : "Ajustar"}
                  </Button>
                </div>
                {!expanded && (
                  <div role="group" aria-label={`Quem consumiu ${name}`} className="flex flex-wrap gap-2">
                    {people.map((person, index) => {
                      const arc = arcs[index];
                      const shortName = labels.get(person.id) ?? person.name;
                      const selected = consumers.includes(person.id);
                      const personProps = {
                        id: person.id,
                        label: arc.consumed
                          ? `${shortName}: ${sharePercentText(arc.basisPoints)} · ${formatBRL(arc.cents)}`
                          : shortName,
                        name: person.name,
                        avatarUrl: person.avatarUrl,
                        isGuest: person.isGuest,
                        selected,
                        arc,
                      };
                      return custom ? (
                        <PersonShareButton key={person.id} {...personProps} onOpen={() => onToggleItem(item.id)} />
                      ) : (
                        <PersonToggle
                          key={person.id}
                          {...personProps}
                          onToggle={() => toggleConsumer(item, consumers, person.id)}
                        />
                      );
                    })}
                  </div>
                )}
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
            </li>
          );
        })}
      </ul>
      <dl className="space-y-1 px-1 text-sm">
        <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
          <dt>Taxa de serviço</dt>
          <dd><Money cents={serviceFeeCents} className="text-sm" /></dd>
        </div>
        {fixedFees > 0 && (
          <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
            <dt>Taxas fixas</dt>
            <dd><Money cents={fixedFees} className="text-sm" /></dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-3 font-bold">
          <dt>Total</dt>
          <dd><Money cents={grandTotal} className="text-sm font-bold" /></dd>
        </div>
      </dl>
    </div>
  );
}
