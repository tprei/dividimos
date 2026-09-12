"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Hash, Percent, Split, Users } from "lucide-react";
import { startTransition, useState } from "react";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { PersonLabel } from "@/components/shared/person-label";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { haptics } from "@/hooks/use-haptics";
import { formatBRL } from "@/lib/currency";
import {
  allocateByBasisPoints,
  allocateEvenly,
  parseAllocationPercentText,
} from "@/lib/expense-money";
import { FULL_PERCENT_BASIS_POINTS, percentText } from "@/lib/item-division";
import type { UserProfile } from "@/types";

function percentBasisPoints(text: string | undefined): number {
  const parsed = parseAllocationPercentText(text ?? "");
  return parsed.ok ? parsed.value : 0;
}

function percentLabel(basisPoints: number): string {
  return basisPoints % 100 === 0 ? String(basisPoints / 100) : percentText(basisPoints);
}

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
  const [localAmounts, setLocalAmounts] = useState<Map<string, number>>(() => {
    if (payers.length > 1) {
      const m = new Map<string, number>();
      for (const p of payers) {
        if (p.amountCents > 0) {
          m.set(p.userId, p.amountCents);
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

  const handleLocalChange = (userId: string, cents: number) => {
    const next = new Map(localAmounts);
    next.set(userId, cents);
    setLocalAmounts(next);
    if (cents > 0) {
      onSetPayerAmount(userId, cents);
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
      const next = new Map(localAmounts);
      next.set(userId, remaining);
      setLocalAmounts(next);
      onSetPayerAmount(userId, remaining);
    }
  };

  // Percentages only produce payer amounts when they sum to exactly 100%; while
  // they do not, the store must hold no payer set rather than a stale one.
  const applyPercentages = (next: Map<string, string>) => {
    setLocalPercentages(next);
    const weights = participants.map((p) => percentBasisPoints(next.get(p.id)));
    const allocated = allocateByBasisPoints(grandTotal, weights);
    startTransition(() => {
      if (!allocated.ok) {
        participants.forEach((p) => onRemovePayerEntry(p.id));
        return;
      }
      participants.forEach((p, index) => {
        const cents = allocated.value[index];
        if (cents > 0) {
          onSetPayerAmount(p.id, cents);
        } else {
          onRemovePayerEntry(p.id);
        }
      });
    });
  };

  const setPercentage = (userId: string, text: string) => {
    const next = new Map(localPercentages);
    next.set(userId, text);
    applyPercentages(next);
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
                  <PersonLabel name={user.name} handle={user.handle} nameClassName="text-sm font-medium" />
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
            const basisPointsByUser = participants.map((user) =>
              percentBasisPoints(localPercentages.get(user.id)),
            );
            const totalBasisPoints = basisPointsByUser.reduce((sum, bp) => sum + bp, 0);
            const remainingBasisPoints = FULL_PERCENT_BASIS_POINTS - totalBasisPoints;
            const allocated = allocateByBasisPoints(grandTotal, basisPointsByUser);
            const amounts = allocated.ok ? allocated.value : null;
            return (
              <div className="space-y-3">
                {participants.map((user, index) => {
                  const basisPoints = basisPointsByUser[index];
                  const showFillRemaining =
                    basisPoints === 0 && remainingBasisPoints > 0 && totalBasisPoints > 0;
                  return (
                    <div
                      key={user.id}
                      className={`rounded-xl border p-3 transition-all ${
                        basisPoints > 0 ? "border-primary/30 bg-primary/5" : "bg-card"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                            {user.name.charAt(0)}
                          </span>
                          <PersonLabel name={user.name} handle={user.handle} nameClassName="text-sm font-medium" />
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold tabular-nums text-primary">
                            {percentLabel(basisPoints)}%
                          </span>
                          <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                            {amounts ? formatBRL(amounts[index]) : "—"}
                          </span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={Math.round(basisPoints / 100)}
                        aria-label={`Percentual pago por ${user.name}`}
                        onChange={(e) => {
                          setPercentage(user.id, percentText(Number(e.target.value) * 100));
                        }}
                        className="mt-2 w-full"
                      />
                      {showFillRemaining && (
                        <button
                          onClick={() => {
                            setPercentage(user.id, percentText(remainingBasisPoints));
                          }}
                          className="mt-1.5 text-xs font-medium text-primary"
                        >
                          Preencher restante ({percentLabel(remainingBasisPoints)}%)
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
                    const even = allocateEvenly(FULL_PERCENT_BASIS_POINTS, participants.length);
                    if (!even.ok) return;
                    const next = new Map<string, string>();
                    participants.forEach((p, i) => next.set(p.id, percentText(even.value[i])));
                    applyPercentages(next);
                  }}
                >
                  <Users className="h-4 w-4" />
                  Dividir igualmente
                </Button>
                {totalBasisPoints > 0 && remainingBasisPoints !== 0 && (
                  <div className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                    Total: {percentLabel(totalBasisPoints)}% —{" "}
                    {remainingBasisPoints > 0
                      ? `faltam ${percentLabel(remainingBasisPoints)}% para completar 100%`
                      : `excede 100% em ${percentLabel(-remainingBasisPoints)}%`}
                  </div>
                )}
              </div>
            );
          })()}

          {paymentInputMode === "fixed" && <div className="space-y-3">{participants.map((user) => {
            const userCents = localAmounts.get(user.id) || 0;
            const storeAmount = payerMap.get(user.id) || 0;
            const hasValue = userCents > 0 || storeAmount > 0;
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
                  <PersonLabel name={user.name} handle={user.handle} className="flex-1" nameClassName="text-sm font-medium" />
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
                      <CurrencyInput
                        valueCents={userCents}
                        onChangeCents={(cents) => handleLocalChange(user.id, cents)}
                        maxCents={grandTotal}
                        className="h-8 w-24 text-right text-sm rounded-lg border border-input bg-transparent px-2.5 py-1 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                    </div>
                  )}
                </div>
                {!showFillRemaining && (
                  <div className="mt-2">
                    <AmountQuickAdd
                      increments={[5, 10, 50, 100]}
                      valueCents={userCents}
                      onChangeCents={(cents) => handleLocalChange(user.id, cents)}
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
                      handleLocalChange(user.id, cents);
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
                const perPerson = Math.round(grandTotal / participants.length);
                const m = new Map<string, number>();
                participants.forEach((p) => m.set(p.id, perPerson));
                setLocalAmounts(m);
              }}
            >
              <Users className="h-4 w-4" />
              Dividir igualmente
            </Button>

            <AnimatePresence>
              {remaining !== 0 && totalPaid > 0 && (
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
