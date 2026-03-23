"use client";

import { motion } from "framer-motion";
import { Equal, Hash, Percent, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/currency";
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
    parseFloat(totalInput.replace(",", ".") || "0") * 100,
  );

  useEffect(() => {
    if (totalCents !== totalAmountInput && totalCents > 0) {
      onSetTotal(totalCents);
    }
  }, [totalCents, totalAmountInput, onSetTotal]);

  useEffect(() => {
    if (totalCents <= 0 || participants.length === 0) return;

    if (method === "equal") {
      onSplitEqually(participants.map((p) => p.id));
    }
  }, [method, totalCents, participants, onSplitEqually]);

  const perPerson = participants.length > 0 ? totalCents / participants.length : 0;

  const handlePercentageChange = (userId: string, val: string) => {
    const next = new Map(percentages);
    next.set(userId, val);
    setPercentages(next);
  };

  const applyPercentages = () => {
    const assignments = participants.map((p) => ({
      userId: p.id,
      percentage: parseFloat(percentages.get(p.id)?.replace(",", ".") || "0"),
    }));
    onSplitByPercentage(assignments);
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
          onChange={(e) => setTotalInput(e.target.value)}
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
              onClick={() => setMethod(m.key)}
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
            <div className="space-y-3">
              {participants.map((user) => (
                <div key={user.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {user.name.charAt(0)}
                  </span>
                  <span className="flex-1 text-sm font-medium">
                    {user.name.split(" ")[0]}
                  </span>
                  <div className="flex items-center gap-1 w-24">
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      className="h-8 text-right text-sm"
                      value={percentages.get(user.id) || ""}
                      onChange={(e) => handlePercentageChange(user.id, e.target.value)}
                      onBlur={applyPercentages}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
              ))}
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
                <p className="text-xs text-warning-foreground">
                  Total: {percentTotal.toFixed(1)}% (deve ser 100%)
                </p>
              )}
            </div>
          )}

          {method === "fixed" && (
            <div className="space-y-3">
              {participants.map((user) => (
                <div key={user.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {user.name.charAt(0)}
                  </span>
                  <span className="flex-1 text-sm font-medium">
                    {user.name.split(" ")[0]}
                  </span>
                  <div className="flex items-center gap-1 w-28">
                    <span className="text-sm text-muted-foreground">R$</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      className="h-8 text-right text-sm"
                      value={fixedAmounts.get(user.id) || ""}
                      onChange={(e) => handleFixedChange(user.id, e.target.value)}
                      onBlur={applyFixed}
                    />
                  </div>
                </div>
              ))}
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
              {Math.abs(fixedTotal - totalCents) > 1 && fixedTotal > 0 && (
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
