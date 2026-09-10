"use client";

import { useState } from "react";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { allocateEvenly } from "@/lib/expense-money";
import {
  FULL_PERCENT_BASIS_POINTS,
  centsText,
  computeDivision,
  divisionStatusText,
  percentText,
  type ItemDivisionMode,
  type ItemDivisionValue,
} from "@/lib/item-division";
import { cn } from "@/lib/utils";

export interface ItemDivisionParticipant {
  id: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
}

export interface ItemDivisionEditorProps {
  itemId: string;
  itemName: string;
  itemCents: number;
  participants: ItemDivisionParticipant[];
  value: ItemDivisionValue | null;
  onSave: (value: ItemDivisionValue) => void;
  onCancel: () => void;
}

const MODE_OPTIONS: { key: ItemDivisionMode; label: string }[] = [
  { key: "equal", label: "Igual" },
  { key: "percent", label: "Percentual" },
  { key: "fixed", label: "Fixo" },
];

function ShareCell({
  shareCents,
  percentInput,
  fixedInput,
  inputLabel,
  onPercentChange,
  onFixedChange,
}: {
  shareCents: number | null;
  percentInput: string | null;
  fixedInput: string | null;
  inputLabel: string;
  onPercentChange: (value: string) => void;
  onFixedChange: (value: string) => void;
}) {
  if (percentInput !== null) {
    return (
      <Input
        value={percentInput}
        onChange={(event) => onPercentChange(event.target.value)}
        inputMode="decimal"
        aria-label={inputLabel}
        className="h-9 w-24 bg-card text-right font-mono"
      />
    );
  }
  if (fixedInput !== null) {
    return (
      <Input
        value={fixedInput}
        onChange={(event) => onFixedChange(event.target.value)}
        inputMode="decimal"
        aria-label={inputLabel}
        className="h-9 w-24 bg-card text-right font-mono"
      />
    );
  }
  if (shareCents === null) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return <Money cents={shareCents} className="text-sm" />;
}

export function ItemDivisionEditor({
  itemId,
  itemName,
  itemCents,
  participants,
  value,
  onSave,
  onCancel,
}: ItemDivisionEditorProps) {
  const participantIds = participants.map((participant) => participant.id);
  const [mode, setMode] = useState<ItemDivisionMode>(value?.mode ?? "equal");
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (!value) return [];
    const saved = new Set(value.shares.map((share) => share.participantId));
    return participantIds.filter((id) => saved.has(id));
  });
  const [percentTexts, setPercentTexts] = useState<Record<string, string>>(() => {
    const texts: Record<string, string> = {};
    for (const share of value?.shares ?? []) {
      if (share.basisPoints !== undefined) texts[share.participantId] = percentText(share.basisPoints);
    }
    return texts;
  });
  const [fixedTexts, setFixedTexts] = useState<Record<string, string>>(() => {
    const texts: Record<string, string> = {};
    for (const share of value?.shares ?? []) {
      texts[share.participantId] = centsText(share.cents);
    }
    return texts;
  });

  const percentValues: Record<string, string> = {};
  if (mode === "percent" && selectedIds.length > 0) {
    const seeded = allocateEvenly(FULL_PERCENT_BASIS_POINTS, selectedIds.length);
    if (seeded.ok) {
      selectedIds.forEach((id, index) => {
        percentValues[id] = percentTexts[id] ?? percentText(seeded.value[index]);
      });
    }
  }
  const fixedValues: Record<string, string> = {};
  if (mode === "fixed" && selectedIds.length > 0) {
    const seeded = allocateEvenly(itemCents, selectedIds.length);
    if (seeded.ok) {
      selectedIds.forEach((id, index) => {
        fixedValues[id] = fixedTexts[id] ?? centsText(seeded.value[index]);
      });
    }
  }
  const division = computeDivision(itemCents, mode, selectedIds, percentValues, fixedValues);

  const toggleParticipant = (id: string) =>
    setSelectedIds((ids) =>
      ids.includes(id)
        ? ids.filter((other) => other !== id)
        : participantIds.filter((member) => member === id || ids.includes(member)),
    );

  const handleSave = () => {
    if (!division.ok) return;
    onSave({
      mode,
      shares: selectedIds.map((id) => ({
        participantId: id,
        cents: division.centsById[id],
        ...(division.basisPointsById ? { basisPoints: division.basisPointsById[id] } : {}),
      })),
    });
  };

  const status = divisionStatusText(division, mode);

  return (
    <div className="space-y-3 rounded-2xl border border-input bg-background p-3">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <p className="min-w-0 truncate text-base font-bold">{itemName}</p>
        <Money cents={itemCents} className="text-base" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`modo-divisao-${itemId}`}>Modo de divisão</Label>
        <select
          id={`modo-divisao-${itemId}`}
          aria-label={`Modo de divisão de ${itemName}`}
          value={mode}
          onChange={(event) => setMode(event.target.value as ItemDivisionMode)}
          className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm font-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {MODE_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Pessoas</p>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds([...participantIds])}>
            Todos
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
            Nenhum
          </Button>
        </div>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-input bg-card">
        {participants.map((participant) => {
          const selected = selectedIds.includes(participant.id);
          return (
            <div key={participant.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={selected}
                onChange={() => toggleParticipant(participant.id)}
                aria-label={`Incluir ${participant.name} em ${itemName}`}
              />
              {participant.isGuest ? (
                <GuestAvatar size="sm" />
              ) : (
                <UserAvatar name={participant.name} avatarUrl={participant.avatarUrl} size="sm" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{participant.name}</span>
              <ShareCell
                shareCents={selected && division.ok ? division.centsById[participant.id] : null}
                percentInput={mode === "percent" && selected ? percentValues[participant.id] ?? "" : null}
                fixedInput={mode === "fixed" && selected ? fixedValues[participant.id] ?? "" : null}
                inputLabel={
                  mode === "percent"
                    ? `Percentual de ${participant.name} em ${itemName}`
                    : `Valor fixo de ${participant.name} em ${itemName}`
                }
                onPercentChange={(next) => setPercentTexts((prev) => ({ ...prev, [participant.id]: next }))}
                onFixedChange={(next) => setFixedTexts((prev) => ({ ...prev, [participant.id]: next }))}
              />
            </div>
          );
        })}
      </div>
      <p
        aria-live="polite"
        className={cn("text-xs font-semibold", division.ok ? "text-muted-foreground" : "text-destructive")}
      >
        {status}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="ghost" className="h-11" onClick={onCancel}>
          Cancelar
        </Button>
        <Button className="h-11 flex-1" disabled={!division.ok} onClick={handleSave}>
          Salvar
        </Button>
      </div>
    </div>
  );
}
