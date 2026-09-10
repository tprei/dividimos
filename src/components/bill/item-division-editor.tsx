"use client";

import { Coins, Equal, Percent, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { DivisionSlider } from "@/components/bill/division-slider";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInvitedUserIds } from "@/hooks/use-invited-user-ids";
import { allocateEvenly, parseAllocationPercentText, parseExpenseCentsText } from "@/lib/expense-money";
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

const MODE_OPTIONS: { key: ItemDivisionMode; label: string; name: string; icon: LucideIcon }[] = [
  { key: "equal", label: "Igual", name: "Igual", icon: Equal },
  { key: "percent", label: "%", name: "Percentual", icon: Percent },
  { key: "fixed", label: "R$", name: "Fixo", icon: Coins },
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
        className="h-11 w-24 bg-card text-right font-mono"
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
        className="h-11 w-24 bg-card text-right font-mono"
      />
    );
  }
  if (shareCents === null) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return <Money cents={shareCents} className="text-sm" />;
}

function percentSliderValue(text: string): number {
  const parsed = parseAllocationPercentText(text);
  return parsed.ok ? parsed.value : 0;
}

function fixedSliderValue(text: string): number {
  const parsed = parseExpenseCentsText(text, { format: "plain_decimal", zeroPolicy: "allow" });
  return parsed.ok ? parsed.value : 0;
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
  const [rawSelectedIds, setSelectedIds] = useState<string[]>(() => {
    if (!value) return [];
    const saved = new Set(value.shares.map((share) => share.participantId));
    return participantIds.filter((id) => saved.has(id));
  });
  const selectedIds = rawSelectedIds.filter((id) => participantIds.includes(id));
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
  const percentSliderValues: Record<string, number> = {};
  for (const id of selectedIds) percentSliderValues[id] = percentSliderValue(percentValues[id] ?? "");
  const fixedSliderValues: Record<string, number> = {};
  for (const id of selectedIds) fixedSliderValues[id] = fixedSliderValue(fixedValues[id] ?? "");
  let fixedSum = 0;
  for (const id of selectedIds) fixedSum += fixedSliderValues[id] ?? 0;
  const fixedRemainingById: Record<string, number> = {};
  for (const id of selectedIds) {
    fixedRemainingById[id] = Math.max(0, itemCents - (fixedSum - (fixedSliderValues[id] ?? 0)));
  }

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
  const invitedUserIds = useInvitedUserIds();

  return (
    <div className="space-y-3 border-t border-dashed border-border bg-muted/30 px-4 pt-3 pb-4">
      <div
        role="radiogroup"
        id={`modo-divisao-${itemId}`}
        aria-label={`Modo de divisão de ${itemName}`}
        className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
      >
        {MODE_OPTIONS.map((option) => {
          const active = mode === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.name}
              onClick={() => setMode(option.key)}
              className={cn(
                "flex min-h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors",
                active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              <option.icon className="size-4" aria-hidden="true" />
              {option.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Pessoas</p>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setSelectedIds([...participantIds])}>
            Todos
          </Button>
          <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setSelectedIds([])}>
            Nenhum
          </Button>
        </div>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-input bg-card">
        {participants.map((participant) => {
          const selected = selectedIds.includes(participant.id);
          return (
            <div key={participant.id} className="flex min-h-12 min-w-0 flex-wrap items-center gap-3 px-3 py-2">
              <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={selected}
                  onChange={() => toggleParticipant(participant.id)}
                  aria-label={`Incluir ${participant.name} em ${itemName}`}
                />
              </label>
              {participant.isGuest ? (
                <GuestAvatar size="sm" />
              ) : (
                <UserAvatar name={participant.name} avatarUrl={participant.avatarUrl} size="sm" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{participant.name}</span>
              {!participant.isGuest && invitedUserIds.has(participant.id) && (
                <Badge variant="secondary" className="shrink-0">
                  Convite pendente
                </Badge>
              )}
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
              {selected && mode !== "equal" && (
                <DivisionSlider
                  ariaLabel={
                    mode === "percent"
                      ? `Percentual deslizante de ${participant.name} em ${itemName}`
                      : `Valor deslizante de ${participant.name} em ${itemName}`
                  }
                  className="basis-full"
                  min={0}
                  max={mode === "percent" ? FULL_PERCENT_BASIS_POINTS : fixedRemainingById[participant.id] ?? 0}
                  value={
                    mode === "percent"
                      ? percentSliderValues[participant.id] ?? 0
                      : fixedSliderValues[participant.id] ?? 0
                  }
                  onChange={(next) => {
                    if (mode === "percent") {
                      setPercentTexts((prev) => ({ ...prev, [participant.id]: percentText(next) }));
                    } else {
                      setFixedTexts((prev) => ({ ...prev, [participant.id]: centsText(next) }));
                    }
                  }}
                />
              )}
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
