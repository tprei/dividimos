"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Split, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/currency";
import type { User } from "@/types";

interface PayerStepProps {
  participants: User[];
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
  const [localAmounts, setLocalAmounts] = useState<Map<string, string>>(new Map());
  const initialized = useRef(false);

  useEffect(() => {
    if (payers.length > 1 && !initialized.current) {
      const m = new Map<string, string>();
      for (const p of payers) {
        if (p.amountCents > 0) {
          m.set(p.userId, (p.amountCents / 100).toFixed(2).replace(".", ","));
        }
      }
      setLocalAmounts(m);
      initialized.current = true;
    }
  }, [payers]);

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
                onClick={() => onSetPayerFull(user.id)}
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

          {participants.map((user) => {
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
                        onChange={(e) => handleLocalChange(user.id, e.target.value)}
                        onBlur={() => handleBlur(user.id)}
                      />
                    </div>
                  )}
                </div>
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
                      onSetPayerAmount(user.id, cents);
                    }}
                    className="mt-2 w-full h-2 rounded-full appearance-none bg-muted cursor-pointer accent-primary [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md"
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
            Dividiu igualmente
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
        </div>
      )}
    </div>
  );
}
