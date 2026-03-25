"use client";

import { motion } from "framer-motion";
import { Equal, Hash, Percent, Users } from "lucide-react";
import { startTransition, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL, sanitizeDecimalInput } from "@/lib/currency";
import type { SplitType, User } from "@/types";

interface SingleAmountStepProps {
  participants: User[];
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
  totalAmountInput,
  onSetTotal,
  onSplitEqually,
  onSplitByPercentage,
  onSplitByFixed,
}: SingleAmountStepProps) {
  const [method, setMethod] = useState<SplitType>("equal");
  const [totalInput, setTotalInput] = useState(
    totalAmountInput > 0 ? (totalAmountInput / 100).toFixed(2).replace(".", ",") : "",
  );
  const [percentages, setPercentages] = useState<Map<string, string>>(new Map());
  const [fixedAmounts, setFixedAmounts] = useState<Map<string, string>>(new Map());

  const totalCents = Math.round(
    (parseFloat(totalInput.replace(",", ".")) || 0) * 100,
  );

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
    if (totalCents <= 0 || participants.length === 0) return;

    if (method === "equal") {
      onSplitEquallyRef.current(participants.map((p) => p.id));
    } else if (method === "percentage") {
      const assignments = participants.map((p) => ({
        userId: p.id,
        percentage: parseFloat(percentages.get(p.id)?.replace(",", ".") || "0"),
      }));
      onSplitByPercentageRef.current(assignments);
    } else if (method === "fixed") {
      const assignments = participants.map((p) => ({
        userId: p.id,
        amountCents: Math.round(
          parseFloat(fixedAmounts.get(p.id)?.replace(",", ".") || "0") * 100,
        ),
      }));
      onSplitByFixedRef.current(assignments);
    }
  }, [method, totalCents, participants, percentages, fixedAmounts]);

  const perPerson = participants.length > 0 ? totalCents / participants.length : 0;

  const handlePercentageChange = (userId: string, val: string) => {
    const next = new Map(percentages);
    next.set(userId, val);
    setPercentages(next);
  };

  const handleFixedChange = (userId: string, val: string) => {
    const next = new Map(fixedAmounts);
    next.set(userId, val);
    setFixedAmounts(next);
  };

  const applyFixed = () => {
    const assignments = participants.map((p) => ({
      userId: p.id,
      amountCents: Math.round(
        parseFloat(fixedAmounts.get(p.id)?.replace(",", ".") || "0") * 100,
      ),
    }));
    onSplitByFixed(assignments);
  };

  const percentTotal = Array.from(percentages.values()).reduce(
    (s, v) => s + (parseFloat(v.replace(",", ".")) || 0),
    0,
  );
  const fixedTotal = Array.from(fixedAmounts.values()).reduce(
    (s, v) => s + Math.round(parseFloat(v.replace(",", ".") || "0") * 100),
    0,
  );

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium">
          Valor total (R$)
        </label>
        <Input
          type="text"
          inputMode="decimal"
          placeholder="0,00"
          value={totalInput}
          onChange={(e) => setTotalInput(sanitizeDecimalInput(e.target.value))}
          className="text-2xl font-bold h-14 text-center"
          autoFocus
        />
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
                {participants.length} pessoas × {formatBRL(Math.floor(perPerson))}
              </p>
              <div className="mt-3 space-y-2">
                {participants.map((user) => (
                  <div key={user.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                        {user.name.charAt(0)}
                      </span>
                      <span>{user.name.split(" ")[0]}</span>
                    </div>
                    <span className="font-medium tabular-nums">
                      {formatBRL(Math.floor(perPerson))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {method === "percentage" && (
            <div className="space-y-4">
              {participants.map((user) => {
                const pct = parseFloat(percentages.get(user.id)?.replace(",", ".") || "0");
                const amountForUser = Math.round((totalCents * pct) / 100);
                const remainingPct = 100 - percentTotal;
                const showFillRemaining = pct === 0 && remainingPct > 0 && percentTotal > 0;

                return (
                  <div key={user.id} className="rounded-xl border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {user.name.charAt(0)}
                        </span>
                        <span className="text-sm font-medium">{user.name.split(" ")[0]}</span>
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
                        handlePercentageChange(user.id, e.target.value);
                        const assignments = participants.map((p) => ({
                          userId: p.id,
                          percentage: p.id === user.id
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
                          handlePercentageChange(user.id, val);
                          const assignments = participants.map((p) => ({
                            userId: p.id,
                            percentage: p.id === user.id
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
                  const eq = (100 / participants.length).toFixed(1);
                  const next = new Map<string, string>();
                  participants.forEach((p) => next.set(p.id, eq));
                  setPercentages(next);
                  onSplitByPercentage(
                    participants.map((p) => ({
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
              {participants.map((user) => {
                const userVal = fixedAmounts.get(user.id) || "";
                const othersTotal = Array.from(fixedAmounts.entries())
                  .filter(([id]) => id !== user.id)
                  .reduce((s, [, v]) => s + Math.round(parseFloat(v.replace(",", ".") || "0") * 100), 0);
                const userRemaining = totalCents - othersTotal;
                const showFillRemaining = !userVal && othersTotal > 0 && userRemaining > 0;

                return (
                  <div key={user.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {user.name.charAt(0)}
                    </span>
                    <span className="flex-1 text-sm font-medium">
                      {user.name.split(" ")[0]}
                    </span>
                    {showFillRemaining ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs gap-1 text-primary border-primary/30"
                        onClick={() => {
                          const formatted = (userRemaining / 100).toFixed(2).replace(".", ",");
                          handleFixedChange(user.id, formatted);
                          setTimeout(applyFixed, 0);
                        }}
                      >
                        Restante ({formatBRL(userRemaining)})
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1 w-28">
                        <span className="text-sm text-muted-foreground">R$</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          className="h-8 text-right text-sm"
                          value={userVal}
                          onChange={(e) => handleFixedChange(user.id, e.target.value)}
                          onBlur={applyFixed}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => {
                  const eq = (totalCents / 100 / participants.length).toFixed(2);
                  const next = new Map<string, string>();
                  participants.forEach((p) => next.set(p.id, eq));
                  setFixedAmounts(next);
                  onSplitByFixed(
                    participants.map((p) => ({
                      userId: p.id,
                      amountCents: Math.round(parseFloat(eq) * 100),
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
