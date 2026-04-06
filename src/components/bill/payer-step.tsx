"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Hash, Percent, Split, Users } from "lucide-react";
import { startTransition, useState } from "react";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { haptics } from "@/hooks/use-haptics";
import { formatBRL, sanitizeDecimalInput } from "@/lib/currency";
import type { UserProfile } from "@/types";

interface PayerStepProps {
  participants: UserProfile[];
  payers: { userId: string; amountCents: number }[];
  grandTotal: number;
  onSetPayerFull: (userId: string) => void;
  onSplitPaymentEqually: (userIds: string[]) => void;
  onSetPayerAmount: (userId: string, amountCents: number) => void;
  onRemovePayerEntry: (userId: string) => void;
}

export function PayerStep({
  participants,
  payers,
  grandTotal,
  onSetPayerFull,
  onSplitPaymentEqually,
  onSetPayerAmount,
  onRemovePayerEntry,
}: PayerStepProps) {
  const [multiMode, setMultiMode] = useState(payers.length > 1);
  const [paymentInputMode, setPaymentInputMode] = useState<"fixed" | "percentage">("fixed");
  const [localAmounts, setLocalAmounts] = useState<Map<string, string>>(() => {
    if (payers.length > 1) {
      const m = new Map<string, string>();
      for (const p of payers) {
        if (p.amountCents > 0) {
          m.set(p.userId, (p.amountCents / 100).toFixed(2).replace(".", ","));
        }
      }
      return m;
    }
    return new Map();
  });
  const [localPercentages, setLocalPercentages] = useState<Map<string, string>>(new Map());

  const payerMap = new Map(payers.map((p) => [p.userId, p.amountCents]));
  const totalPaid = payers.reduce((sum, p) => sum + p.amountCents, 0);
  const remaining = grandTotal - totalPaid;

  const handleLocalChange = (userId: string, val: string) => {
    const next = new Map(localAmounts);
    next.set(userId, val);
    setLocalAmounts(next);
  };

  const handleBlur = (userId: string) => {
    const raw = localAmounts.get(userId) || "";
    const val = parseFloat(raw.replace(",", ".")) || 0;
    if (val > 0) {
      onSetPayerAmount(userId, Math.round(val * 100));
    } else {
      onRemovePayerEntry(userId);
    }
  };

  const handleFillRemaining = (userId: string) => {
    const othersTotal = payers
      .filter((p) => p.userId !== userId)
      .reduce((sum, p) => sum + p.amountCents, 0);
    const remaining = grandTotal - othersTotal;
    if (remaining > 0) {
      const formatted = (remaining / 100).toFixed(2).replace(".", ",");
      const next = new Map(localAmounts);
      next.set(userId, formatted);
      setLocalAmounts(next);
      onSetPayerAmount(userId, remaining);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Quem pagou a conta?
        </p>
        <div className="mt-2 rounded-xl bg-primary/5 px-4 py-3">
          <p className="text-xs text-muted-foreground">Total da conta</p>
          <p className="text-xl font-bold tabular-nums text-primary">
            {formatBRL(grandTotal)}
          </p>
        </div>
      </div>

      {!multiMode ? (
        <div className="space-y-2">
          {participants.map((user) => {
            const isSelected = payerMap.has(user.id) && payers.length <= 1;
            return (
              <motion.button
                key={user.id}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  haptics.selectionChanged();
                  onSetPayerFull(user.id);
                }}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                  isSelected
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "bg-card hover:border-primary/30"
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-primary/10 text-primary"
                  }`}
                >
                  {isSelected ? <Check className="h-4 w-4" /> : user.name.charAt(0)}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{user.name}</p>
                  {isSelected && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-xs text-primary"
                    >
                      Pagou tudo — {formatBRL(grandTotal)}
                    </motion.p>
                  )}
                </div>
                {isSelected && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    Pagou tudo
                  </span>
                )}
              </motion.button>
            );
          })}

          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 border-dashed"
            onClick={() => setMultiMode(true)}
          >
            <Split className="h-4 w-4" />
            Mais de uma pessoa pagou
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Dividir pagamento</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => {
                setMultiMode(false);
                if (payers.length > 0) {
                  onSetPayerFull(payers[0].userId);
                }
              }}
            >
              Voltar para um pagador
            </Button>
          </div>

          <div className="flex rounded-xl bg-muted/50 p-1">
            {([
              { key: "fixed" as const, icon: Hash, label: "Valor fixo" },
              { key: "percentage" as const, icon: Percent, label: "Porcentagem" },
            ]).map((m) => (
              <button
                key={m.key}
                onClick={() => {
                  haptics.selectionChanged();
                  setPaymentInputMode(m.key);
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-all ${
                  paymentInputMode === m.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <m.icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            ))}
          </div>

          {paymentInputMode === "percentage" && (() => {
            const totalPct = Array.from(localPercentages.values()).reduce(
              (s, v) => s + (parseFloat(v.replace(",", ".")) || 0), 0,
            );
            return (
              <div className="space-y-3">
                {participants.map((user) => {
                  const pct = parseFloat(localPercentages.get(user.id)?.replace(",", ".") || "0") || 0;
                  const amountForUser = Math.round((grandTotal * pct) / 100);
                  const remainingPct = 100 - totalPct;
                  const showFillRemaining = pct === 0 && remainingPct > 0 && totalPct > 0;
                  return (
                    <div
                      key={user.id}
                      className={`rounded-xl border p-3 transition-all ${
                        pct > 0 ? "border-primary/30 bg-primary/5" : "bg-card"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
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
                          const next = new Map(localPercentages);
                          next.set(user.id, e.target.value);
                          setLocalPercentages(next);
                          const cents = Math.round((grandTotal * parseFloat(e.target.value)) / 100);
                          startTransition(() => {
                            onSetPayerAmount(user.id, cents);
                          });
                        }}
                        className="mt-2 w-full"
                      />
                      {showFillRemaining && (
                        <button
                          onClick={() => {
                            const next = new Map(localPercentages);
                            next.set(user.id, remainingPct.toFixed(1));
                            setLocalPercentages(next);
                            const cents = Math.round((grandTotal * remainingPct) / 100);
                            onSetPayerAmount(user.id, cents);
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
                    setLocalPercentages(next);
                    onSplitPaymentEqually(participants.map((p) => p.id));
                  }}
                >
                  <Users className="h-4 w-4" />
                  Dividir igualmente
                </Button>
                {Math.abs(totalPct - 100) > 0.1 && totalPct > 0 && (
                  <div className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                    Total: {totalPct.toFixed(0)}% — faltam {(100 - totalPct).toFixed(0)}% para completar 100%
                  </div>
                )}
              </div>
            );
          })()}

          {paymentInputMode === "fixed" && <div className="space-y-3">{participants.map((user) => {
            const localVal = localAmounts.get(user.id) || "";
            const storeAmount = payerMap.get(user.id) || 0;
            const hasValue = localVal !== "" || storeAmount > 0;
            const othersFilled = participants.some(
              (p) => p.id !== user.id && (payerMap.get(p.id) || 0) > 0,
            );
            const showFillRemaining = !hasValue && othersFilled && remaining > 0;

            const sliderValue = storeAmount || 0;

            return (
              <div
                key={user.id}
                className={`rounded-xl border p-3 transition-all ${
                  hasValue ? "border-primary/30 bg-primary/5" : "bg-card"
                }`}
              >
                <div className="flex items-center gap-3">
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
                      onClick={() => handleFillRemaining(user.id)}
                    >
                      Restante ({formatBRL(remaining)})
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">R$</span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        className="h-8 w-24 text-right text-sm"
                        value={localVal}
                        onChange={(e) => handleLocalChange(user.id, sanitizeDecimalInput(e.target.value))}
                        onBlur={() => handleBlur(user.id)}
                      />
                    </div>
                  )}
                </div>
                {!showFillRemaining && (
                  <div className="mt-2">
                    <AmountQuickAdd
                      increments={[5, 10, 50, 100]}
                      currentValue={localVal}
                      onChange={(newVal) => {
                        handleLocalChange(user.id, newVal);
                        const cents = Math.round(parseFloat(newVal.replace(",", ".")) * 100);
                        startTransition(() => {
                          onSetPayerAmount(user.id, cents);
                        });
                      }}
                    />
                  </div>
                )}
                {!showFillRemaining && (
                  <input
                    type="range"
                    min="0"
                    max={grandTotal}
                    step={100}
                    value={sliderValue}
                    onChange={(e) => {
                      const cents = parseInt(e.target.value);
                      const formatted = (cents / 100).toFixed(2).replace(".", ",");
                      handleLocalChange(user.id, formatted);
                      startTransition(() => {
                        onSetPayerAmount(user.id, cents);
                      });
                    }}
                    className="mt-2 w-full"
                  />
                )}
              </div>
            );
          })}

            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={() => {
                onSplitPaymentEqually(participants.map((p) => p.id));
                const perPerson = grandTotal / participants.length;
                const m = new Map<string, string>();
                participants.forEach((p) =>
                  m.set(p.id, (perPerson / 100).toFixed(2).replace(".", ",")),
                );
                setLocalAmounts(m);
              }}
            >
              <Users className="h-4 w-4" />
              Dividir igualmente
            </Button>

            <AnimatePresence>
              {Math.abs(remaining) > 1 && totalPaid > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                    remaining > 0
                      ? "bg-warning/10 text-warning-foreground"
                      : "bg-destructive/10 text-destructive"
                  }`}
                >
                  <span>
                    {remaining > 0 ? "Falta atribuir" : "Excedente"}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatBRL(Math.abs(remaining))}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>}
        </div>
      )}
    </div>
  );
}
