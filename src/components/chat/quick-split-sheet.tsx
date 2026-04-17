"use client";

import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Equal,
  Hash,
  Loader2,
  Percent,
  Receipt,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  distributeEvenly,
  distributeProportionally,
  formatBRL,
  sanitizeDecimalInput,
} from "@/lib/currency";
import type { SplitType, UserProfile } from "@/types";

export type QuickSplitStatus = "idle" | "confirming" | "confirmed" | "error";

export interface QuickSplitResult {
  title: string;
  amountCents: number;
  splitType: SplitType;
  shares: Array<{ userId: string; shareAmountCents: number }>;
  payerId: string;
}

interface QuickSplitSheetProps {
  open: boolean;
  onClose: () => void;
  currentUserId: string;
  counterparty: UserProfile;
  onConfirm: (result: QuickSplitResult) => void;
  status?: QuickSplitStatus;
  errorMessage?: string;
}

const SPLIT_METHODS: { key: SplitType; icon: React.ElementType; label: string }[] = [
  { key: "equal", icon: Equal, label: "Igual" },
  { key: "percentage", icon: Percent, label: "%" },
  { key: "fixed", icon: Hash, label: "Fixo" },
];

export function QuickSplitSheet({
  open,
  onClose,
  currentUserId,
  counterparty,
  onConfirm,
  status = "idle",
  errorMessage,
}: QuickSplitSheetProps) {
  const [title, setTitle] = useState("");
  const [totalCents, setTotalCents] = useState(0);
  const [splitMethod, setSplitMethod] = useState<SplitType>("equal");
  const [myPercentage, setMyPercentage] = useState("50");
  const [myFixedCents, setMyFixedCents] = useState(0);

  const participants = useMemo(
    () => [
      { id: currentUserId, name: "Você" },
      { id: counterparty.id, name: counterparty.name.split(" ")[0] },
    ],
    [currentUserId, counterparty],
  );

  const isConfirming = status === "confirming";
  const isConfirmed = status === "confirmed";
  const isDisabled = isConfirming || isConfirmed;

  const computeShares = useCallback((): Array<{ userId: string; shareAmountCents: number }> | null => {
    if (totalCents <= 0) return null;

    if (splitMethod === "equal") {
      const amounts = distributeEvenly(totalCents, participants.length);
      return participants.map((p, i) => ({
        userId: p.id,
        shareAmountCents: amounts[i],
      }));
    }

    if (splitMethod === "percentage") {
      const myPct = parseFloat(myPercentage.replace(",", ".")) || 0;
      const otherPct = 100 - myPct;
      if (myPct < 0 || myPct > 100) return null;
      const amounts = distributeProportionally(totalCents, [myPct, otherPct]);
      return [
        { userId: currentUserId, shareAmountCents: amounts[0] },
        { userId: counterparty.id, shareAmountCents: amounts[1] },
      ];
    }

    if (splitMethod === "fixed") {
      const otherAmount = totalCents - myFixedCents;
      if (myFixedCents < 0 || otherAmount < 0) return null;
      return [
        { userId: currentUserId, shareAmountCents: myFixedCents },
        { userId: counterparty.id, shareAmountCents: otherAmount },
      ];
    }

    return null;
  }, [totalCents, splitMethod, participants, myPercentage, myFixedCents, currentUserId, counterparty.id]);

  const shares = computeShares();

  const isValid = useMemo(() => {
    if (!title.trim() || totalCents <= 0 || !shares) return false;
    const sum = shares.reduce((s, sh) => s + sh.shareAmountCents, 0);
    return Math.abs(sum - totalCents) <= 1;
  }, [title, totalCents, shares]);

  const percentageWarning = useMemo(() => {
    if (splitMethod !== "percentage") return null;
    const pct = parseFloat(myPercentage.replace(",", ".")) || 0;
    if (pct < 0 || pct > 100) return "Porcentagem deve estar entre 0% e 100%";
    return null;
  }, [splitMethod, myPercentage]);

  const fixedWarning = useMemo(() => {
    if (splitMethod !== "fixed" || totalCents <= 0) return null;
    if (myFixedCents > totalCents) return "Valor excede o total";
    return null;
  }, [splitMethod, totalCents, myFixedCents]);

  const handleConfirm = () => {
    if (!isValid || !shares) return;
    onConfirm({
      title: title.trim(),
      amountCents: totalCents,
      splitType: splitMethod,
      shares,
      payerId: currentUserId,
    });
  };

  const handleClose = () => {
    if (isDisabled) return;
    onClose();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-end justify-center backdrop-blur-sm bg-black/40 sm:items-center"
        onClick={handleClose}
        data-testid="quick-split-backdrop"
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          drag="y"
          dragConstraints={{ top: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.y > 100 || info.velocity.y > 500) {
              handleClose();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-t-3xl bg-card p-6 pb-24 sm:pb-6 sm:rounded-3xl"
          data-testid="quick-split-sheet"
        >
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted/80 sm:hidden" />

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <Receipt className="h-4 w-4 text-primary" />
              </div>
              <h2 className="text-lg font-bold">Dividir conta</h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={isDisabled}
              className="rounded-full p-1.5 text-muted-foreground hover:bg-muted transition-colors"
              data-testid="quick-split-close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <Input
                type="text"
                placeholder="O que estão dividindo?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isDisabled}
                className="text-sm"
                data-testid="quick-split-title"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Valor total (R$)
              </label>
              <div className="flex items-center justify-center rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 h-14">
                <span className="pl-3 text-lg font-bold text-muted-foreground">R$</span>
                <CurrencyInput
                  valueCents={totalCents}
                  onChangeCents={setTotalCents}
                  disabled={isDisabled}
                  className="flex-1 text-2xl font-bold h-14"
                  data-testid="quick-split-amount"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Como dividir?
              </label>
              <div className="flex rounded-xl bg-muted/50 p-1" data-testid="quick-split-method-selector">
                {SPLIT_METHODS.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setSplitMethod(m.key)}
                    disabled={isDisabled}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-all ${
                      splitMethod === m.key
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid={`split-method-${m.key}`}
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
                className="space-y-2"
                data-testid="quick-split-preview"
              >
                {splitMethod === "equal" && shares && (
                  <div className="rounded-xl border bg-card/50 p-3">
                    {participants.map((p, i) => (
                      <div key={p.id} className="flex items-center justify-between py-1 text-sm">
                        <span>{p.name}</span>
                        <span className="font-semibold tabular-nums">
                          {formatBRL(shares[i].shareAmountCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {splitMethod === "percentage" && (
                  <div className="rounded-xl border bg-card/50 p-3 space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm flex-1">Você</span>
                      <div className="flex items-center gap-1 w-20">
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="50"
                          value={myPercentage}
                          onChange={(e) => setMyPercentage(sanitizeDecimalInput(e.target.value))}
                          disabled={isDisabled}
                          className="h-8 text-right text-sm"
                          data-testid="quick-split-my-percentage"
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                      {shares && (
                        <span className="text-xs text-muted-foreground tabular-nums w-20 text-right">
                          {formatBRL(shares[0].shareAmountCents)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm flex-1">{participants[1].name}</span>
                      <span className="text-sm tabular-nums w-20 text-right">
                        {(100 - (parseFloat(myPercentage.replace(",", ".")) || 0)).toFixed(0)}%
                      </span>
                      {shares && (
                        <span className="text-xs text-muted-foreground tabular-nums w-20 text-right">
                          {formatBRL(shares[1].shareAmountCents)}
                        </span>
                      )}
                    </div>
                    {percentageWarning && (
                      <p className="text-xs text-warning-foreground">{percentageWarning}</p>
                    )}
                  </div>
                )}

                {splitMethod === "fixed" && (
                  <div className="rounded-xl border bg-card/50 p-3 space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm flex-1">Você</span>
                      <div className="flex items-center gap-1 w-28">
                        <span className="text-sm text-muted-foreground">R$</span>
                        <CurrencyInput
                          valueCents={myFixedCents}
                          onChangeCents={setMyFixedCents}
                          disabled={isDisabled}
                          className="h-8 w-full text-right text-sm rounded-lg border border-input bg-transparent px-2.5 py-1 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          data-testid="quick-split-my-fixed"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">{participants[1].name}</span>
                      <span className="text-sm font-semibold tabular-nums">
                        {formatBRL(Math.max(0, totalCents - myFixedCents))}
                      </span>
                    </div>
                    {fixedWarning && (
                      <p className="text-xs text-warning-foreground">{fixedWarning}</p>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            <AnimatePresence mode="wait">
              {status === "error" && errorMessage && (
                <motion.p
                  key="error"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
                  data-testid="quick-split-error"
                >
                  {errorMessage}
                </motion.p>
              )}
            </AnimatePresence>

            <div className="flex gap-2 pt-1">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={handleClose}
                disabled={isDisabled}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleConfirm}
                disabled={!isValid || isDisabled}
                data-testid="quick-split-confirm"
              >
                {isConfirming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isConfirmed ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Receipt className="h-4 w-4" />
                )}
                {isConfirming ? "Dividindo…" : isConfirmed ? "Dividido!" : "Dividir"}
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
