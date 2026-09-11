"use client";

import { useEffect, useMemo, useState } from "react";
import { DivisionModePills } from "@/components/bill/division-mode-pills";
import { DivisionSlider } from "@/components/bill/division-slider";
import { FixedAmountHelpers } from "@/components/bill/fixed-amount-helpers";
import { PercentHelpers } from "@/components/bill/percent-helpers";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { SectionHeading } from "@/components/shared/section-heading";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useInvitedUserIds } from "@/hooks/use-invited-user-ids";
import { allocateEvenly, parseAllocationPercentText, parseExpenseCentsText } from "@/lib/expense-money";
import { formatBRL } from "@/lib/currency";
import {
  centsText,
  computeDivision,
  FULL_PERCENT_BASIS_POINTS,
  percentText,
  type DivisionComputation,
  type ItemDivisionMode,
} from "@/lib/item-division";
import type { Guest } from "@/stores/bill-store";
import type { User } from "@/types";

export interface SingleBillDivisionProps {
  totalCents: number;
  participants: User[];
  guests: Guest[];
  splitBillEqually: (userIds: string[]) => void;
  splitBillByBasisPoints: (assignments: { userId: string; basisPoints: number }[]) => void;
  splitBillByFixed: (assignments: { userId: string; amountCents: number }[]) => void;
  onValidityChange: (valid: boolean) => void;
  mode: ItemDivisionMode;
  onModeChange: (mode: ItemDivisionMode) => void;
  percentTexts: Record<string, string>;
  onPercentTextChange: (userId: string, value: string) => void;
  fixedTexts: Record<string, string>;
  onFixedTextChange: (userId: string, value: string) => void;
}

interface DivisionPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
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

function percentSliderValue(text: string): number {
  const parsed = parseAllocationPercentText(text);
  return parsed.ok ? Math.round(parsed.value / 100) : 0;
}

function fixedSliderValue(text: string): number {
  const parsed = parseExpenseCentsText(text, { format: "plain_decimal", zeroPolicy: "allow" });
  return parsed.ok ? parsed.value : 0;
}

export function SingleBillDivision({
  totalCents,
  participants,
  guests,
  splitBillEqually,
  splitBillByBasisPoints,
  splitBillByFixed,
  onValidityChange,
  mode,
  onModeChange,
  percentTexts,
  onPercentTextChange,
  fixedTexts,
  onFixedTextChange,
}: SingleBillDivisionProps) {
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
    const fallback = fallbackValues(FULL_PERCENT_BASIS_POINTS / 100, ids.length);
    ids.forEach((id, index) => {
      values[id] = percentTexts[id] ?? percentText((fallback[index] ?? 0) * 100);
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
  const percentSliderValues = useMemo(() => {
    const values: Record<string, number> = {};
    for (const id of ids) values[id] = percentSliderValue(percentValues[id]);
    return values;
  }, [ids, percentValues]);
  const percentRemainingBasisPoints = useMemo(() => {
    let sum = 0;
    for (const id of ids) sum += percentSliderValues[id] ?? 0;
    return Math.max(0, FULL_PERCENT_BASIS_POINTS - sum * 100);
  }, [ids, percentSliderValues]);
  const fixedSliderValues = useMemo(() => {
    const values: Record<string, number> = {};
    for (const id of ids) values[id] = fixedSliderValue(fixedValues[id]);
    return values;
  }, [fixedValues, ids]);
  const fixedRemaining = useMemo(() => {
    let sum = 0;
    for (const id of ids) sum += fixedSliderValues[id] ?? 0;
    const byId: Record<string, number> = {};
    for (const id of ids) {
      byId[id] = Math.max(0, totalCents - (sum - (fixedSliderValues[id] ?? 0)));
    }
    return { byId, total: Math.max(0, totalCents - sum) };
  }, [fixedSliderValues, ids, totalCents]);
  const [lastTouchedId, setLastTouchedId] = useState<string | null>(null);
  const helpersTargetId =
    lastTouchedId !== null && ids.includes(lastTouchedId) ? lastTouchedId : ids.length > 0 ? ids[0] : null;
  const division = useMemo(
    () => computeDivision(totalCents, mode, ids, percentValues, fixedValues),
    [fixedValues, ids, mode, percentValues, totalCents],
  );
  const status = statusText(division, mode);
  const invitedUserIds = useInvitedUserIds();

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
        title="Quem consumiu"
        trailing={
          <DivisionModePills
            value={mode}
            onChange={onModeChange}
            groupLabel="Modo de divisão"
            idPrefix="single-bill-division-mode"
          />
        }
      />
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="divide-y divide-border">
          {people.map((person) => {
            const shareCents = division.ok ? division.centsById[person.id] : null;
            return (
              <div key={person.id} className="flex min-h-14 min-w-0 flex-wrap items-center gap-3 px-4 py-2">
                {person.isGuest ? (
                  <GuestAvatar size="sm" />
                ) : (
                  <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="sm" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm leading-5 font-semibold">{person.name.split(" ")[0]}</p>
                  {person.isGuest && <Badge variant="secondary">Convidado</Badge>}
                  {!person.isGuest && invitedUserIds.has(person.id) && (
                    <Badge variant="secondary" className="shrink-0">
                      Convite pendente
                    </Badge>
                  )}
                </div>
                {mode === "equal" ? (
                  <Money cents={shareCents ?? 0} className="shrink-0 text-sm" />
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      value={mode === "percent" ? percentValues[person.id] : fixedValues[person.id]}
                      onChange={(event) => {
                        if (mode === "percent") {
                          onPercentTextChange(person.id, event.target.value.replace(/\D/g, ""));
                        } else {
                          onFixedTextChange(person.id, event.target.value);
                        }
                      }}
                      onFocus={() => setLastTouchedId(person.id)}
                      inputMode={mode === "percent" ? "numeric" : "decimal"}
                      aria-label={mode === "percent" ? `Percentual de ${person.name}` : `Valor de ${person.name}`}
                      className="h-11 w-24 rounded-lg bg-card text-right font-mono tabular-nums"
                      placeholder={mode === "percent" ? "0" : "0,00"}
                    />
                    {shareCents === null ? (
                      <span className="w-[4.5rem] text-right text-sm text-muted-foreground">—</span>
                    ) : (
                      <Money cents={shareCents} className="w-[4.5rem] shrink-0 text-right text-sm" />
                    )}
                  </div>
                )}
                {mode !== "equal" && (
                  <DivisionSlider
                    ariaLabel={
                      mode === "percent"
                        ? `Percentual deslizante de ${person.name}`
                        : `Valor deslizante de ${person.name}`
                    }
                    className="basis-full"
                    min={0}
                    max={mode === "percent" ? FULL_PERCENT_BASIS_POINTS / 100 : fixedRemaining.byId[person.id] ?? 0}
                    step={mode === "percent" ? 1 : "any"}
                    snap={mode === "percent" ? { step: 5, threshold: 2 } : undefined}
                    value={
                      mode === "percent"
                        ? percentSliderValues[person.id] ?? 0
                        : fixedSliderValues[person.id] ?? 0
                    }
                    onChange={(next) => {
                      setLastTouchedId(person.id);
                      if (mode === "percent") {
                        onPercentTextChange(person.id, percentText(next * 100));
                      } else {
                        onFixedTextChange(person.id, centsText(next));
                      }
                    }}
                  />
                )}
                {mode === "fixed" && person.id === helpersTargetId && (
                  <div className="basis-full">
                    <FixedAmountHelpers
                      totalCents={totalCents}
                      remainingCents={fixedRemaining.total}
                      onAdd={(deltaCents) => {
                        if (helpersTargetId === null) return;
                        const current = fixedSliderValues[helpersTargetId] ?? 0;
                        onFixedTextChange(helpersTargetId, centsText(current + deltaCents));
                      }}
                    />
                  </div>
                )}
                {mode === "percent" && person.id === helpersTargetId && (
                  <div className="basis-full">
                    <PercentHelpers
                      remainingBasisPoints={percentRemainingBasisPoints}
                      onAdd={(deltaBasisPoints) => {
                        if (helpersTargetId === null) return;
                        const current = (percentSliderValues[helpersTargetId] ?? 0) * 100;
                        onPercentTextChange(
                          helpersTargetId,
                          percentText(Math.min(FULL_PERCENT_BASIS_POINTS, current + deltaBasisPoints)),
                        );
                      }}
                    />
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
        className="min-h-6 pt-2 text-xs font-semibold text-destructive"
      >
        {status}
      </p>
    </section>
  );
}
