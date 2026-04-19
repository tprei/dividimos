"use client";

import { motion } from "framer-motion";
import { Equal, Hash, Percent, Users } from "lucide-react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { CurrencyInput } from "@/components/ui/currency-input";
import { haptics } from "@/hooks/use-haptics";
import { formatBRL } from "@/lib/currency";
import {
  getSliderStep,
  getSnapPoints,
  getSnapRadius,
  getSnapStep,
} from "@/lib/slider-snap";
import type { SplitType, UserProfile } from "@/types";

interface GuestEntry {
  id: string;
  name: string;
}

interface SingleAmountStepProps {
  participants: UserProfile[];
  guests?: GuestEntry[];
  totalAmountInput: number;
  onSetTotal: (cents: number) => void;
  onSplitEqually: (userIds: string[]) => void;
  onSplitByPercentage: (assignments: { userId: string; percentage: number }[]) => void;
  onSplitByFixed: (assignments: { userId: string; amountCents: number }[]) => void;
}

const methods: { key: SplitType; icon: React.ElementType; label: string }[] = [
  { key: "equal", icon: Equal, label: "Igual" },
  { key: "percentage", icon: Percent, label: "Porcentagem" },
  { key: "fixed", icon: Hash, label: "Valor fixo" },
];

export function SingleAmountStep({
  participants,
  guests = [],
  totalAmountInput,
  onSetTotal,
  onSplitEqually,
  onSplitByPercentage,
  onSplitByFixed,
}: SingleAmountStepProps) {
  const allPersons: { id: string; name: string }[] = useMemo(
    () => [...participants.map((p) => ({ id: p.id, name: p.name })), ...guests],
    [participants, guests],
  );
  const [method, setMethod] = useState<SplitType>("equal");
  const [totalCents, setTotalCents] = useState(totalAmountInput);
  const [percentages, setPercentages] = useState<Map<string, string>>(new Map());
  const [fixedAmounts, setFixedAmounts] = useState<Map<string, number>>(new Map());

  const onSetTotalRef = useRef(onSetTotal);
  useEffect(() => { onSetTotalRef.current = onSetTotal; });
  const onSplitEquallyRef = useRef(onSplitEqually);
  useEffect(() => { onSplitEquallyRef.current = onSplitEqually; });
  const onSplitByPercentageRef = useRef(onSplitByPercentage);
  useEffect(() => { onSplitByPercentageRef.current = onSplitByPercentage; });
  const onSplitByFixedRef = useRef(onSplitByFixed);
  useEffect(() => { onSplitByFixedRef.current = onSplitByFixed; });

  useEffect(() => {
    if (totalCents !== totalAmountInput && totalCents > 0) {
      onSetTotalRef.current(totalCents);
    }
  }, [totalCents, totalAmountInput]);

  useEffect(() => {
    if (totalCents <= 0 || allPersons.length === 0) return;

    if (method === "equal") {
      onSplitEquallyRef.current(allPersons.map((p) => p.id));
    } else if (method === "percentage") {
      const assignments = allPersons.map((p) => ({
        userId: p.id,
        percentage: parseFloat(percentages.get(p.id)?.replace(",", ".") || "0"),
      }));
      onSplitByPercentageRef.current(assignments);
    } else if (method === "fixed") {
      const assignments = allPersons.map((p) => ({
        userId: p.id,
        amountCents: fixedAmounts.get(p.id) || 0,
      }));
      onSplitByFixedRef.current(assignments);
    }
  }, [method, totalCents, allPersons, percentages, fixedAmounts]);

  const perPerson = allPersons.length > 0 ? totalCents / allPersons.length : 0;

  const handlePercentageChange = (userId: string, val: string) => {
    const next = new Map(percentages);
    next.set(userId, val);
    setPercentages(next);
  };

  const handleFixedChange = (userId: string, cents: number) => {
    const next = new Map(fixedAmounts);
    next.set(userId, cents);
    setFixedAmounts(next);
  };

  const percentTotal = Array.from(percentages.values()).reduce(
    (s, v) => s + (parseFloat(v.replace(",", ".")) || 0),
    0,
  );
  const fixedTotal = Array.from(fixedAmounts.values()).reduce(
    (s, v) => s + v,
    0,
  );

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium">
          Valor total (R$)
        </label>
        <div className="flex items-center justify-center rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 h-14">
          <span className="pl-3 text-lg font-bold text-muted-foreground">R$</span>
          <CurrencyInput
            valueCents={totalCents}
            onChangeCents={setTotalCents}
            className="flex-1 text-2xl font-bold h-14"
          />
        </div>
        <div className="mt-2">
          <AmountQuickAdd
            increments={[1, 5, 10, 50, 100]}
            valueCents={totalCents}
            onChangeCents={setTotalCents}
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          Como dividir?
        </label>
        <div className="flex rounded-xl bg-muted/50 p-1">
          {methods.map((m) => (
            <button
              key={m.key}
              onClick={() => {
                haptics.selectionChanged();
                setMethod(m.key);
                if (m.key !== "percentage") setPercentages(new Map());
                if (m.key !== "fixed") setFixedAmounts(new Map());
              }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-all ${
                method === m.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <m.icon className="h-3.5 w-3.5" />
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {totalCents > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          {method === "equal" && (
            <div className="rounded-2xl border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                {allPersons.length} pessoas × {formatBRL(Math.floor(perPerson))}
              </p>
              <div className="mt-3 space-y-2">
                {allPersons.map((person) => {
                  const isGuest = person.id.startsWith("guest_");
                  return (
                    <div key={person.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${isGuest ? "bg-muted text-muted-foreground border border-dashed border-muted-foreground/40" : "bg-primary/10 text-primary"}`}>
                          {person.name.charAt(0)}
                        </span>
                        <span>{person.name.split(" ")[0]}</span>
                        {isGuest && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">Convidado</span>
                        )}
                      </div>
                      <span className="font-medium tabular-nums">
                        {formatBRL(Math.floor(perPerson))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {method === "percentage" && (
            <div className="space-y-4">
              {allPersons.map((person) => {
                const pct = parseFloat(percentages.get(person.id)?.replace(",", ".") || "0");
                const amountForUser = Math.round((totalCents * pct) / 100);
                const remainingPct = 100 - percentTotal;
                const showFillRemaining = pct === 0 && remainingPct > 0 && percentTotal > 0;
                const isGuest = person.id.startsWith("guest_");

                return (
                  <div key={person.id} className="rounded-xl border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isGuest ? "bg-muted text-muted-foreground border border-dashed border-muted-foreground/40" : "bg-primary/10 text-primary"}`}>
                          {person.name.charAt(0)}
                        </span>
                        <span className="text-sm font-medium">{person.name.split(" ")[0]}</span>
                        {isGuest && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">Convidado</span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold tabular-nums text-primary">{pct.toFixed(0)}%</span>
                        <span className="ml-2 text-xs text-muted-foreground tabular-nums">{formatBRL(amountForUser)}</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={pct}
                      onChange={(e) => {
                        handlePercentageChange(person.id, e.target.value);
                        const assignments = allPersons.map((p) => ({
                          userId: p.id,
                          percentage: p.id === person.id
                            ? parseFloat(e.target.value)
                            : parseFloat(percentages.get(p.id)?.replace(",", ".") || "0"),
                        }));
                        startTransition(() => {
                          onSplitByPercentage(assignments);
                        });
                      }}
                      className="mt-2 w-full"
                    />
                    {showFillRemaining && (
                      <button
                        onClick={() => {
                          const val = remainingPct.toFixed(1);
                          handlePercentageChange(person.id, val);
                          const assignments = allPersons.map((p) => ({
                            userId: p.id,
                            percentage: p.id === person.id
                              ? remainingPct
                              : parseFloat(percentages.get(p.id)?.replace(",", ".") || "0"),
                          }));
                          onSplitByPercentage(assignments);
                        }}
                        className="mt-1.5 text-xs font-medium text-primary"
                      >
                        Preencher restante ({remainingPct.toFixed(0)}%)
                      </button>
                    )}
                  </div>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => {
                  const eq = (100 / allPersons.length).toFixed(1);
                  const next = new Map<string, string>();
                  allPersons.forEach((p) => next.set(p.id, eq));
                  setPercentages(next);
                  onSplitByPercentage(
                    allPersons.map((p) => ({
                      userId: p.id,
                      percentage: parseFloat(eq),
                    })),
                  );
                }}
              >
                <Users className="h-4 w-4" />
                Dividir igualmente
              </Button>
              {Math.abs(percentTotal - 100) > 0.1 && (
                <div className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                  Total: {percentTotal.toFixed(0)}% — faltam {(100 - percentTotal).toFixed(0)}% para completar 100%
                </div>
              )}
            </div>
          )}

          {method === "fixed" && (
            <div className="space-y-3">
              {allPersons.map((person) => {
                const isGuest = person.id.startsWith("guest_");
                const userCents = fixedAmounts.get(person.id) || 0;
                const othersTotal = Array.from(fixedAmounts.entries())
                  .filter(([id]) => id !== person.id)
                  .reduce((s, [, v]) => s + v, 0);
                const remainderToComplete = Math.max(0, totalCents - othersTotal);
                const equalShare = Math.round(totalCents / allPersons.length);

                return (
                  <FixedAmountRow
                    key={person.id}
                    name={person.name}
                    isGuest={isGuest}
                    userCents={userCents}
                    totalCents={totalCents}
                    equalShare={equalShare}
                    remainderToComplete={remainderToComplete}
                    onChange={(cents) => handleFixedChange(person.id, cents)}
                  />
                );
              })}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => {
                  const perPersonCents = Math.round(totalCents / allPersons.length);
                  const next = new Map<string, number>();
                  allPersons.forEach((p) => next.set(p.id, perPersonCents));
                  setFixedAmounts(next);
                  onSplitByFixed(
                    allPersons.map((p) => ({
                      userId: p.id,
                      amountCents: perPersonCents,
                    })),
                  );
                }}
              >
                <Users className="h-4 w-4" />
                Dividir igualmente
              </Button>
              {Math.abs(fixedTotal - totalCents) > 1 && (
                <p className="text-xs text-warning-foreground">
                  Total: {formatBRL(fixedTotal)} (deve ser {formatBRL(totalCents)})
                </p>
              )}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

interface FixedAmountRowProps {
  name: string;
  isGuest: boolean;
  userCents: number;
  totalCents: number;
  equalShare: number;
  remainderToComplete: number;
  onChange: (cents: number) => void;
}

function FixedAmountRow({
  name,
  isGuest,
  userCents,
  totalCents,
  equalShare,
  remainderToComplete,
  onChange,
}: FixedAmountRowProps) {
  const lastSnapRef = useRef<number | null>(null);
  const sliderMax = totalCents;
  const sliderMin = 0;
  const range = sliderMax - sliderMin;
  const sliderStep = getSliderStep(range);
  const snapStep = getSnapStep(range);
  const extras: number[] = [];
  if (equalShare > 0) extras.push(equalShare);
  if (remainderToComplete > 0 && remainderToComplete < sliderMax) {
    extras.push(remainderToComplete);
  }
  const snapPoints = getSnapPoints(sliderMin, sliderMax, extras);
  const snapRadius = getSnapRadius(snapStep, sliderStep);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = parseInt(e.target.value);

    let snapped = raw;
    for (const sp of snapPoints) {
      if (Math.abs(raw - sp) <= snapRadius) {
        snapped = sp;
        break;
      }
    }

    const nearestSnap = snapPoints.reduce<number | null>(
      (best, sp) =>
        best === null || Math.abs(raw - sp) < Math.abs(raw - best) ? sp : best,
      null,
    );
    if (nearestSnap !== null && nearestSnap !== lastSnapRef.current) {
      lastSnapRef.current = nearestSnap;
      haptics.selectionChanged();
    }

    onChange(snapped);
  };

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            isGuest
              ? "bg-muted text-muted-foreground border border-dashed border-muted-foreground/40"
              : "bg-primary/10 text-primary"
          }`}
        >
          {name.charAt(0)}
        </span>
        <span className="flex-1 text-sm font-medium">
          {name.split(" ")[0]}
          {isGuest && (
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
              Convidado
            </span>
          )}
        </span>
        <span className="text-sm font-bold tabular-nums text-primary">
          {formatBRL(userCents)}
        </span>
      </div>
      <input
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={sliderStep}
        value={Math.min(userCents, sliderMax)}
        onChange={handleSliderChange}
        className="mt-3 w-full"
        aria-label={`Valor de ${name.split(" ")[0]}`}
      />
      {snapPoints.length > 0 && (
        <div className="relative mx-[11px] h-2">
          {snapPoints.map((v) => (
            <div
              key={v}
              className="absolute top-0 w-0.5 h-1.5 rounded-full bg-muted-foreground/30"
              style={{
                left: `${((v - sliderMin) / (sliderMax - sliderMin)) * 100}%`,
              }}
            />
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {equalShare > 0 && (
          <button
            type="button"
            onClick={() => onChange(equalShare)}
            disabled={userCents === equalShare}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
              userCents === equalShare
                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary"
            } disabled:opacity-50`}
          >
            Igual: {formatBRL(equalShare)}
          </button>
        )}
        {remainderToComplete > 0 &&
          remainderToComplete <= sliderMax &&
          remainderToComplete !== equalShare && (
            <button
              type="button"
              onClick={() => onChange(remainderToComplete)}
              disabled={userCents === remainderToComplete}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                userCents === remainderToComplete
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary"
              } disabled:opacity-50`}
            >
              Restante: {formatBRL(remainderToComplete)}
            </button>
          )}
      </div>
    </div>
  );
}
