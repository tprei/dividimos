"use client";

import { useState } from "react";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL } from "@/lib/currency";
import {
  allocateByBasisPoints,
  allocateEvenly,
  parseExpenseCentsText,
  parseAllocationPercentText,
} from "@/lib/expense-money";
import { cn } from "@/lib/utils";

import { GUEST_MARIA, ITEMIZED_PARTICIPANT_IDS, firstName, personById } from "../fixtures";
import type { ItemFixture } from "../fixtures";
import { GuestAvatar } from "./guest-avatar";
import { Money } from "./money";

export interface ItemDivisionValue {
  mode: "equal" | "percent" | "fixed";
  shares: { participantId: string; cents: number; basisPoints?: number }[];
}

export interface ItemDivisionProps {
  item: ItemFixture;
  value?: ItemDivisionValue;
  onSave: (value: ItemDivisionValue) => void;
  onCancel: () => void;
}

type DivisionMode = ItemDivisionValue["mode"];

const MODE_OPTIONS: { key: DivisionMode; label: string }[] = [
  { key: "equal", label: "Igual" },
  { key: "percent", label: "Percentual" },
  { key: "fixed", label: "Fixo" },
];

const FULL_PERCENT_BASIS_POINTS = 10_000;

type DivisionComputation =
  | { ok: true; centsById: Record<string, number>; basisPointsById?: Record<string, number> }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "invalid_input" }
  | { ok: false; reason: "total"; remainder: number };

function percentText(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2).replace(".", ",");
}

function centsText(cents: number): string {
  return `${Math.floor(cents / 100)},${(cents % 100).toString().padStart(2, "0")}`;
}

function ParticipantAvatar({ id, className }: { id: string; className?: string }) {
  if (id === GUEST_MARIA.id) return <GuestAvatar size="xs" className={className} />;
  const person = personById(id);
  return <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="xs" className={className} />;
}

function computeDivision(
  itemCents: number,
  mode: DivisionMode,
  selectedIds: string[],
  percentTexts: Record<string, string>,
  fixedTexts: Record<string, string>,
): DivisionComputation {
  if (selectedIds.length === 0) return { ok: false, reason: "empty" };
  if (mode === "equal") {
    const allocated = allocateEvenly(itemCents, selectedIds.length);
    if (!allocated.ok) return { ok: false, reason: "invalid_input" };
    const centsById: Record<string, number> = {};
    selectedIds.forEach((id, index) => {
      centsById[id] = allocated.value[index];
    });
    return { ok: true, centsById };
  }
  if (mode === "percent") {
    const weights: number[] = [];
    const basisPointsById: Record<string, number> = {};
    for (const id of selectedIds) {
      const parsed = parseAllocationPercentText(percentTexts[id] ?? "");
      if (!parsed.ok) return { ok: false, reason: "invalid_input" };
      weights.push(parsed.value);
      basisPointsById[id] = parsed.value;
    }
    const remainder = FULL_PERCENT_BASIS_POINTS - weights.reduce((sum, weight) => sum + weight, 0);
    if (remainder !== 0) return { ok: false, reason: "total", remainder };
    const allocated = allocateByBasisPoints(itemCents, weights);
    if (!allocated.ok) return { ok: false, reason: "invalid_input" };
    const centsById: Record<string, number> = {};
    selectedIds.forEach((id, index) => {
      centsById[id] = allocated.value[index];
    });
    return { ok: true, centsById, basisPointsById };
  }
  const centsById: Record<string, number> = {};
  let sum = 0;
  for (const id of selectedIds) {
    const parsed = parseExpenseCentsText(fixedTexts[id] ?? "", { format: "plain_decimal", zeroPolicy: "allow" });
    if (!parsed.ok) return { ok: false, reason: "invalid_input" };
    centsById[id] = parsed.value;
    sum += parsed.value;
  }
  const remainder = itemCents - sum;
  if (remainder !== 0) return { ok: false, reason: "total", remainder };
  return { ok: true, centsById };
}

export function equalDivision(participantIds: string[], cents: number): ItemDivisionValue | null {
  const shares = allocateEvenly(cents, participantIds.length);
  if (!shares.ok) return null;
  return {
    mode: "equal",
    shares: participantIds.map((participantId, index) => ({ participantId, cents: shares.value[index] })),
  };
}

export function isDivisionValid(value: ItemDivisionValue, cents: number): boolean {
  return value.shares.reduce((sum, share) => sum + share.cents, 0) === cents;
}

export function divisionForItem(item: ItemFixture, divisions: Record<string, ItemDivisionValue>): ItemDivisionValue | null {
  const saved = divisions[item.id];
  if (saved) return isDivisionValid(saved, item.cents) ? saved : null;
  if (item.assigneeIds.length === 0) return null;
  return equalDivision(item.assigneeIds, item.cents);
}

export function recomputeDivisionShares(value: ItemDivisionValue, cents: number): ItemDivisionValue {
  const participantIds = value.shares.map((share) => share.participantId);
  if (participantIds.length === 0 || value.mode === "fixed") return value;
  if (value.mode === "percent") {
    const weights = value.shares.map((share) => share.basisPoints ?? 0);
    const allocated = allocateByBasisPoints(cents, weights);
    if (allocated.ok) {
      return {
        mode: value.mode,
        shares: participantIds.map((participantId, index) => ({
          participantId,
          cents: allocated.value[index],
          basisPoints: weights[index],
        })),
      };
    }
  }
  const equal = allocateEvenly(cents, participantIds.length);
  if (!equal.ok) return value;
  return { mode: value.mode, shares: participantIds.map((participantId, index) => ({ participantId, cents: equal.value[index] })) };
}

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

export function ItemDivision({ item, value, onSave, onCancel }: ItemDivisionProps) {
  const [mode, setMode] = useState<DivisionMode>(value?.mode ?? "equal");
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (value) {
      const saved = new Set(value.shares.map((share) => share.participantId));
      return ITEMIZED_PARTICIPANT_IDS.filter((id) => saved.has(id));
    }
    return ITEMIZED_PARTICIPANT_IDS.filter((id) => item.assigneeIds.includes(id));
  });
  const [percentTexts, setPercentTexts] = useState<Record<string, string>>(() => {
    const texts: Record<string, string> = {};
    for (const share of value?.shares ?? []) {
      if (share.basisPoints !== undefined) {
        texts[share.participantId] = (share.basisPoints / 100).toFixed(2).replace(".", ",");
      }
    }
    return texts;
  });
  const [fixedTexts, setFixedTexts] = useState<Record<string, string>>(() => {
    const texts: Record<string, string> = {};
    for (const share of value?.shares ?? []) {
      texts[share.participantId] = `${Math.floor(share.cents / 100)},${(share.cents % 100).toString().padStart(2, "0")}`;
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
    const seeded = allocateEvenly(item.cents, selectedIds.length);
    if (seeded.ok) {
      selectedIds.forEach((id, index) => {
        fixedValues[id] = fixedTexts[id] ?? centsText(seeded.value[index]);
      });
    }
  }
  const division = computeDivision(item.cents, mode, selectedIds, percentValues, fixedValues);

  const toggleParticipant = (id: string) =>
    setSelectedIds((ids) =>
      ids.includes(id)
        ? ids.filter((other) => other !== id)
        : ITEMIZED_PARTICIPANT_IDS.filter((member) => member === id || ids.includes(member)),
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

  let status: string;
  if (division.ok) {
    status = "Totais conferem com o valor do item.";
  } else if (division.reason === "empty") {
    status = "Selecione quem divide este item.";
  } else if (division.reason === "invalid_input") {
    status = mode === "percent"
      ? "Informe percentuais de 0 a 100 com até duas casas decimais."
      : "Informe valores em reais com até duas casas decimais.";
  } else if (mode === "percent") {
    const text = (Math.abs(division.remainder) / 100).toFixed(2).replace(".", ",");
    status = division.remainder > 0
      ? `Faltam ${text}% para fechar 100%.`
      : `Excede ${text}% do valor do item.`;
  } else {
    const money = formatBRL(Math.abs(division.remainder));
    status = division.remainder > 0
      ? `Faltam ${money} para fechar o item.`
      : `Excede ${money} do valor do item.`;
  }

  return (
    <div className="space-y-3 rounded-2xl border border-input bg-background p-3">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <p className="min-w-0 truncate text-base font-bold">{item.name}</p>
        <Money cents={item.cents} className="text-base" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`modo-divisao-${item.id}`}>Modo de divisão</Label>
        <select
          id={`modo-divisao-${item.id}`}
          aria-label={`Modo de divisão de ${item.name}`}
          value={mode}
          onChange={(event) => setMode(event.target.value as DivisionMode)}
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
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds([...ITEMIZED_PARTICIPANT_IDS])}>
            Todos
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
            Nenhum
          </Button>
        </div>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-input bg-card">
        {ITEMIZED_PARTICIPANT_IDS.map((id) => {
          const name = id === GUEST_MARIA.id ? GUEST_MARIA.name : firstName(personById(id));
          const selected = selectedIds.includes(id);
          return (
            <div key={id} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={selected}
                onChange={() => toggleParticipant(id)}
                aria-label={`Incluir ${name} em ${item.name}`}
              />
              <ParticipantAvatar id={id} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
              <ShareCell
                shareCents={selected && division.ok ? division.centsById[id] : null}
                percentInput={mode === "percent" && selected ? percentValues[id] ?? "" : null}
                fixedInput={mode === "fixed" && selected ? fixedValues[id] ?? "" : null}
                inputLabel={
                  mode === "percent"
                    ? `Percentual de ${name} em ${item.name}`
                    : `Valor fixo de ${name} em ${item.name}`
                }
                onPercentChange={(next) => setPercentTexts((prev) => ({ ...prev, [id]: next }))}
                onFixedChange={(next) => setFixedTexts((prev) => ({ ...prev, [id]: next }))}
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
