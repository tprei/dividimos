"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Hash, Percent, Split, Users } from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { GUEST_PAYER_NOTICE } from "@/components/bill/payer-copy";
import { PersonLabel } from "@/components/shared/person-label";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { haptics } from "@/hooks/use-haptics";
import { Money } from "@/components/shared/money";
import { tapScale } from "@/lib/animations";
import { formatBRL } from "@/lib/currency";
import {
  allocateByBasisPoints,
  allocateByWeights,
  allocateEvenly,
  parseAllocationPercentText,
} from "@/lib/expense-money";
import { centsToBasisPoints, FULL_PERCENT_BASIS_POINTS, percentText } from "@/lib/item-division";
import { cn } from "@/lib/utils";

function percentBasisPoints(text: string | undefined): number {
  const parsed = parseAllocationPercentText(text ?? "");
  return parsed.ok ? parsed.value : 0;
}

function percentLabel(basisPoints: number): string {
  return basisPoints % 100 === 0 ? String(basisPoints / 100) : percentText(basisPoints);
}

/**
 * Minimal participant identity the payer step renders; both bill profiles and
 * room participants satisfy it. The handle is optional because room guests
 * have none.
 */
export interface PayerStepParticipant {
  id: string;
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
}

interface PayerStepProps {
  participants: readonly PayerStepParticipant[];
  payers: { userId: string; amountCents: number }[];
  grandTotal: number;
  onSetPayerFull: (userId: string) => void;
  onSplitPaymentEqually: (userIds: string[]) => void;
  onSetPayerAmount: (userId: string, amountCents: number) => void;
  onRemovePayerEntry: (userId: string) => void;
  hasGuests?: boolean;
  onValidityChange?: (valid: boolean) => void;
}


export function PayerStep({
  participants,
  payers,
  grandTotal,
  onSetPayerFull,
  onSplitPaymentEqually,
  onSetPayerAmount,
  onRemovePayerEntry,
  hasGuests,
  onValidityChange,
}: PayerStepProps) {
  const [multiMode, setMultiMode] = useState(payers.length > 1);
  const [paymentInputMode, setPaymentInputMode] = useState<"fixed" | "percentage">("fixed");
  const [choosingSinglePayer, setChoosingSinglePayer] = useState(false);
  const [localAmounts, setLocalAmounts] = useState<Map<string, number>>(() => {
    if (payers.length > 0) {
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
  const [invalidIds, setInvalidIds] = useState<string[]>([]);
  const inputsValid = !multiMode || paymentInputMode !== "fixed" || !invalidIds.some((id) => participants.some((person) => person.id === id));
  useEffect(() => { onValidityChange?.(inputsValid); }, [inputsValid, onValidityChange]);

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
  function changePaymentInputMode(next: "fixed" | "percentage"): void {
    if (next === paymentInputMode) return;
    if (next === "percentage") {
      const seed = new Map<string, string>();
      if (grandTotal > 0) {
        const amounts = participants.map((p) => payerMap.get(p.id) ?? 0);
        const paidSum = amounts.reduce((s, c) => s + c, 0);
        if (paidSum === grandTotal) {
          const bps = allocateByWeights(FULL_PERCENT_BASIS_POINTS, amounts); // exact case: deterministic apportion of 10000bp
          if (bps.ok) participants.forEach((p, i) => seed.set(p.id, percentText(bps.value[i])));
        } else {
          participants.forEach((p) => {           // partial/over: integer half-up bp, true sum preserved
            const c = payerMap.get(p.id) ?? 0;
            if (c > 0) seed.set(p.id, percentText(centsToBasisPoints(c, grandTotal)));
          });
        }
      } // grandTotal === 0 → empty fields, no division by zero
      setLocalPercentages(seed);
    } else {
      // While percentages were incomplete the store held no payer set, so
      // fall back to the amounts the user actually typed in fixed mode.
      const stored = payers.filter((p) => p.amountCents > 0).map((p) => [p.userId, p.amountCents] as const);
      setLocalAmounts(stored.length > 0 ? new Map(stored) : localAmounts);
    }
    setPaymentInputMode(next);
  }

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
      {hasGuests && (
        <p className="text-xs text-muted-foreground">{GUEST_PAYER_NOTICE}</p>
      )}

      {!multiMode ? (
        <div className="space-y-2">
          {participants.map((user) => {
            const isSelected = payerMap.has(user.id) && payers.length <= 1;
            return (
              <motion.button
                key={user.id}
                aria-pressed={isSelected}
                whileTap={{ scale: tapScale.card }}
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
                <span className="relative shrink-0">
                  <UserAvatar id={user.id} name={user.name} avatarUrl={user.avatarUrl} size="sm" />
                  {isSelected && (
                    <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card">
                      <Check className="size-3" aria-hidden="true" />
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <PersonLabel name={user.name} nameClassName="text-sm font-semibold" />
                  {isSelected && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-xs text-primary-text"
                    >
                      <Money cents={grandTotal} />
                    </motion.p>
                  )}
                </div>
              </motion.button>
            );
          })}

          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 border-dashed"
            onClick={() => { haptics.selectionChanged(); setMultiMode(true); }}
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
                setChoosingSinglePayer(true);
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
                  changePaymentInputMode(m.key);
                }}
                className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${
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
            // Display-only preview: the commit path below still refuses to
            // persist anything but an exact 100% split. When it is exact the
            // preview uses the same allocator, so the two never disagree.
            const exact =
              remainingBasisPoints === 0
                ? allocateByBasisPoints(grandTotal, basisPointsByUser)
                : null;
            const amounts: readonly number[] =
              exact?.ok === true
                ? exact.value
                : basisPointsByUser.map((bp) =>
                    Math.round((grandTotal * bp) / FULL_PERCENT_BASIS_POINTS),
                  );
            const allocatedTotal = amounts.reduce((sum, cents) => sum + cents, 0);
            const amountTone =
              remainingBasisPoints === 0
                ? "text-muted-foreground"
                : remainingBasisPoints < 0
                  ? "text-destructive-text"
                  : "text-warning-foreground";
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
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <UserAvatar id={user.id} name={user.name} avatarUrl={user.avatarUrl} size="sm" />
                          <PersonLabel name={user.name} nameClassName="text-sm font-semibold" />
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold tabular-nums text-primary-text">
                            {percentLabel(basisPoints)}%
                          </span>
                          <span className={cn("ml-2 text-xs tabular-nums", amountTone)}>
                            <Money cents={amounts[index]} />
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
                        aria-valuetext={`${Math.round(basisPoints / 100)}%`}
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
                          className="mt-1.5 min-h-11 text-sm font-semibold text-primary-text"
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
                {totalBasisPoints > 0 && (
                  <div
                    className={cn(
                      "rounded-lg px-3 py-2 text-xs",
                      remainingBasisPoints === 0
                        ? "bg-success/10 text-success-text"
                        : remainingBasisPoints < 0
                          ? "bg-destructive/10 text-destructive-text"
                          : "bg-warning/10 text-warning-foreground",
                    )}
                  >
                    Total: {percentLabel(totalBasisPoints)}% · {formatBRL(allocatedTotal)}
                    {remainingBasisPoints > 0
                      ? ` — faltam ${percentLabel(remainingBasisPoints)}% para completar 100%`
                      : remainingBasisPoints < 0
                        ? ` — excede 100% em ${percentLabel(-remainingBasisPoints)}%`
                        : ""}
                  </div>
                )}
              </div>
            );
          })()}

          {paymentInputMode === "fixed" && <div className="space-y-3">{participants.map((user) => {
            const storeAmount = payerMap.get(user.id) || 0;
            const userCents = localAmounts.get(user.id) ?? storeAmount;
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
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <UserAvatar id={user.id} name={user.name} avatarUrl={user.avatarUrl} size="sm" />
                  <PersonLabel name={user.name} className="min-w-0 flex-1" nameClassName="text-sm font-semibold" />
                  {showFillRemaining ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11 text-xs gap-1 text-primary-text border-primary/30"
                      onClick={() => handleFillRemaining(user.id)}
                    >
                      Restante ({formatBRL(remaining)})
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">R$</span>
                      <CurrencyInput
                        valueCents={localAmounts.get(user.id) ?? storeAmount}
                        onChangeCents={(cents) => handleLocalChange(user.id, cents)}
                        aria-label={`Valor pago por ${user.name}`}
                        onValidityChange={(valid) => setInvalidIds((ids) => {
                          if (valid === !ids.includes(user.id)) return ids;
                          return valid ? ids.filter((id) => id !== user.id) : [...ids, user.id];
                        })}
                        maxCents={grandTotal}
                        className="h-11 w-24 text-right text-base tabular-nums rounded-lg border border-input bg-transparent px-2.5 py-1 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
                    step={1}
                    value={sliderValue}
                    aria-label={`Valor pago por ${user.name}`}
                    aria-valuetext={formatBRL(sliderValue)}
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
                const even = allocateEvenly(grandTotal, participants.length);
                if (!even.ok) return;
                onSplitPaymentEqually(participants.map((p) => p.id));
                const m = new Map<string, number>();
                participants.forEach((p, index) => m.set(p.id, even.value[index]));
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
                      : "bg-destructive/10 text-destructive-text"
                  }`}
                >
                  <span>
                    {remaining > 0 ? "Falta atribuir" : "Excedente"}
                  </span>
                  <span className="font-semibold tabular-nums">
                    <Money cents={Math.abs(remaining)} />
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>}
          {choosingSinglePayer && (
            <div className="rounded-2xl border bg-card p-4 space-y-2">
              <p className="text-sm font-bold">Quem pagou tudo?</p>
              {participants.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => {
                    haptics.selectionChanged();
                    onSetPayerFull(user.id);
                    setMultiMode(false);
                    setChoosingSinglePayer(false);
                  }}
                  className="w-full flex items-center justify-between rounded-xl border p-3 hover:border-primary/50 text-left transition-colors"
                >
                  <span className="flex items-center gap-3">
                    <UserAvatar id={user.id} name={user.name} avatarUrl={user.avatarUrl} size="sm" />
                    <PersonLabel name={user.name} nameClassName="text-sm font-semibold" />
                  </span>
                  <span className="text-sm font-bold tabular-nums text-primary-text">
                    <Money cents={grandTotal} />
                  </span>
                </button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => setChoosingSinglePayer(false)}
              >
                Cancelar
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
