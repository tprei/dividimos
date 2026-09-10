"use client";

import { useEffect, useMemo, useState } from "react";
import { GuestAvatar, GuestBadge } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { SectionHeading } from "@/components/shared/section-heading";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Input } from "@/components/ui/input";
import { allocateEvenly } from "@/lib/expense-money";
import { formatBRL } from "@/lib/currency";
import {
  centsText,
  computeDivision,
  percentText,
  type DivisionComputation,
  type ItemDivisionMode,
} from "@/lib/item-division";
import type { AmountSplit, Guest } from "@/stores/bill-store";
import type { User } from "@/types";

export interface SingleBillDivisionProps {
  totalCents: number;
  participants: User[];
  guests: Guest[];
  billSplits: AmountSplit[];
  splitBillEqually: (userIds: string[]) => void;
  splitBillByBasisPoints: (assignments: { userId: string; basisPoints: number }[]) => void;
  splitBillByFixed: (assignments: { userId: string; amountCents: number }[]) => void;
  onValidityChange: (valid: boolean) => void;
}

const MODE_OPTIONS: { key: ItemDivisionMode; label: string }[] = [
  { key: "equal", label: "Igual" },
  { key: "percent", label: "Percentual" },
  { key: "fixed", label: "Fixo" },
];

interface DivisionPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
}

function initialMode(billSplits: AmountSplit[]): ItemDivisionMode {
  const splitType = billSplits[0]?.splitType;
  if (splitType === "percentage") return "percent";
  return splitType === "fixed" ? "fixed" : "equal";
}

function initialPercentTexts(billSplits: AmountSplit[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const split of billSplits) {
    if (split.splitType === "percentage") {
      values[split.userId] = percentText(Math.round(split.value * 100));
    }
  }
  return values;
}

function initialFixedTexts(billSplits: AmountSplit[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const split of billSplits) {
    if (split.splitType === "fixed") values[split.userId] = centsText(split.computedAmountCents);
  }
  return values;
}
function statusText(
  division: DivisionComputation,
  mode: ItemDivisionMode,
): string {
  if (division.ok) return "";
  if (division.reason !== "total") return "Preencha os valores";
  if (mode === "percent") {
    return division.remainder > 0
      ? `falta ${percentText(division.remainder)}%`
      : `excede ${percentText(Math.abs(division.remainder))}%`;
  }
  const amount = formatBRL(Math.abs(division.remainder));
  return division.remainder > 0 ? `falta ${amount}` : `excede ${amount}`;
}

function fallbackValues(totalCents: number, count: number): number[] {
  if (count === 0) return [];
  const result = allocateEvenly(totalCents, count);
  return result.ok ? [...result.value] : [];
}

export function SingleBillDivision({
  totalCents,
  participants,
  guests,
  billSplits,
  splitBillEqually,
  splitBillByBasisPoints,
  splitBillByFixed,
  onValidityChange,
}: SingleBillDivisionProps) {
  const [mode, setMode] = useState<ItemDivisionMode>(() => initialMode(billSplits));
  const [percentTexts, setPercentTexts] = useState<Record<string, string>>(() => initialPercentTexts(billSplits));
  const [fixedTexts, setFixedTexts] = useState<Record<string, string>>(() => initialFixedTexts(billSplits));

  const people = useMemo<DivisionPerson[]>(
    () => [
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
    ],
    [participants, guests],
  );
  const ids = useMemo(() => people.map((person) => person.id), [people]);
  const percentValues = useMemo(() => {
    const values: Record<string, string> = {};
    const fallback = fallbackValues(10_000, ids.length);
    ids.forEach((id, index) => {
      values[id] = percentTexts[id] ?? percentText(fallback[index] ?? 0);
    });
    return values;
  }, [ids, percentTexts]);
  const fixedValues = useMemo(() => {
    const values: Record<string, string> = {};
    const fallback = fallbackValues(totalCents, ids.length);
    ids.forEach((id, index) => {
      values[id] = fixedTexts[id] ?? centsText(fallback[index] ?? 0);
    });
    return values;
  }, [fixedTexts, ids, totalCents]);
  const division = useMemo(
    () => computeDivision(totalCents, mode, ids, percentValues, fixedValues),
    [fixedValues, ids, mode, percentValues, totalCents],
  );
  const status = statusText(division, mode);

  useEffect(() => {
    onValidityChange(division.ok);
    if (!division.ok) return;
    if (mode === "equal") {
      splitBillEqually(ids);
      return;
    }
    if (mode === "percent") {
      splitBillByBasisPoints(
        ids.map((userId) => ({
          userId,
          basisPoints: division.basisPointsById?.[userId] ?? 0,
        })),
      );
      return;
    }
    splitBillByFixed(
      ids.map((userId) => ({
        userId,
        amountCents: division.centsById[userId] ?? 0,
      })),
    );
  }, [division, ids, mode, onValidityChange, splitBillByBasisPoints, splitBillByFixed, splitBillEqually]);

  return (
    <section>
      <SectionHeading
        title="Divisão"
        trailing={
          <div className="flex flex-wrap justify-end gap-1.5" role="radiogroup" aria-label="Modo de divisão">
            {MODE_OPTIONS.map((option) => {
              const selected = option.key === mode;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMode(option.key)}
                  className={`min-h-11 rounded-full border px-3 text-xs font-semibold transition-colors ${
                    selected
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-card text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        }
      />
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="divide-y divide-border">
          {people.map((person) => {
            const shareCents = division.ok ? division.centsById[person.id] : null;
            return (
              <div key={person.id} className="flex min-h-14 min-w-0 items-center gap-3 px-3 py-2 sm:px-4">
                {person.isGuest ? (
                  <GuestAvatar size="sm" />
                ) : (
                  <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="sm" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{person.name}</p>
                  {person.isGuest && <GuestBadge />}
                </div>
                {mode === "equal" ? (
                  <Money cents={shareCents ?? 0} className="shrink-0 text-sm" />
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      value={mode === "percent" ? percentValues[person.id] : fixedValues[person.id]}
                      onChange={(event) => {
                        if (mode === "percent") {
                          setPercentTexts((current) => ({ ...current, [person.id]: event.target.value }));
                        } else {
                          setFixedTexts((current) => ({ ...current, [person.id]: event.target.value }));
                        }
                      }}
                      inputMode="decimal"
                      aria-label={mode === "percent" ? `Percentual de ${person.name}` : `Valor de ${person.name}`}
                      className="h-9 w-24 rounded-lg bg-card text-right font-mono"
                      placeholder="0,00"
                    />
                    {shareCents === null ? (
                      <span className="w-[4.5rem] text-right text-sm text-muted-foreground">—</span>
                    ) : (
                      <Money cents={shareCents} className="w-[4.5rem] shrink-0 text-right text-sm" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p
        id="single-bill-division-status"
        aria-live="polite"
        className={status ? "pt-2 text-xs font-semibold text-destructive" : "sr-only"}
      >
        {status}
      </p>
    </section>
  );
}
