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
import { Money } from "@/components/shared/money";
import { PersonLabel } from "@/components/shared/person-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { formatBRL } from "@/lib/currency";
import { allocateByWeights, allocateEvenly, parseAllocationPercentText } from "@/lib/expense-money";
import { FULL_PERCENT_BASIS_POINTS, percentText } from "@/lib/item-division";
import type { SplitType } from "@/types";
import type { UserProfile } from "@/types/ledger";

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
  currentUserHandle?: string;
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
  currentUserHandle,
  counterparty,
  onConfirm,
  status = "idle",
  errorMessage,
}: QuickSplitSheetProps) {
  const [title, setTitle] = useState("");
  const [totalCents, setTotalCents] = useState(0);
  const [isAmountValid, setIsAmountValid] = useState(true);
  const [splitMethod, setSplitMethod] = useState<SplitType>("equal");
  const [myPercentage, setMyPercentage] = useState("50");
  const [myFixedCents, setMyFixedCents] = useState(0);
  const [payerId, setPayerId] = useState<string>(currentUserId);

  // The sheet stays mounted, so every open resets to the documented default payer.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPayerId(currentUserId);
  }

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

  const percentageBasisPoints = useMemo((): number | null => {
    if (splitMethod !== "percentage") return null;
    if (myPercentage === "") return 0;
    const parsed = parseAllocationPercentText(myPercentage);
    return parsed.ok ? parsed.value : null;
  }, [splitMethod, myPercentage]);

  const computeShares = useCallback((): Array<{ userId: string; shareAmountCents: number }> | null => {
    if (totalCents <= 0) return null;

    if (splitMethod === "equal") {
      const amountsRes = allocateEvenly(totalCents, participants.length);
      if (!amountsRes.ok) return null;
      const amounts = amountsRes.value;
      return participants.map((p, i) => ({
        userId: p.id,
        shareAmountCents: amounts[i],
      }));
    }

    if (splitMethod === "percentage") {
      if (percentageBasisPoints === null) return null;
      const amountsRes = allocateByWeights(totalCents, [
        percentageBasisPoints,
        FULL_PERCENT_BASIS_POINTS - percentageBasisPoints,
      ]);
      if (!amountsRes.ok) return null;
      const amounts = amountsRes.value;
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
  }, [totalCents, splitMethod, participants, percentageBasisPoints, myFixedCents, currentUserId, counterparty.id]);

  const shares = computeShares();
  const myShareCents = shares?.find((s) => s.userId === currentUserId)?.shareAmountCents ?? 0;
  const otherShareCents = shares?.find((s) => s.userId === counterparty.id)?.shareAmountCents ?? 0;

  const isValid = useMemo(() => {
    if (!title.trim() || totalCents <= 0 || !shares || !isAmountValid) return false;
    const sum = shares.reduce((s, sh) => s + sh.shareAmountCents, 0);
    return Math.abs(sum - totalCents) <= 1;
  }, [title, totalCents, shares, isAmountValid]);

  const percentageWarning = useMemo(() => {
    if (splitMethod !== "percentage" || percentageBasisPoints !== null) return null;
    const parsed = parseAllocationPercentText(myPercentage);
    return parsed.ok === false && parsed.issue.code === "out_of_range"
      ? "Use de 0% a 100%"
      : "Use de 0% a 100%, com até duas casas";
  }, [splitMethod, percentageBasisPoints, myPercentage]);

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
      payerId,
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
          className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-card p-6 pb-8 sm:pb-6 sm:rounded-3xl"
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
                Valor total
              </label>
              <div className="flex items-center justify-center rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-[input[aria-invalid]]:border-destructive has-[input[aria-invalid]]:ring-3 has-[input[aria-invalid]]:ring-destructive/20 h-14">
                <span className="pl-3 text-lg font-bold text-muted-foreground">R$</span>
                <CurrencyInput
                  valueCents={totalCents}
                  onChangeCents={setTotalCents}
                  onValidityChange={setIsAmountValid}
                  aria-label="Valor total"
                  disabled={isDisabled}
                  className="min-w-0 flex-1 text-2xl font-bold h-14"
                  data-testid="quick-split-amount"
                />
              </div>
              {!isAmountValid && (
                <p className="mt-1 text-xs text-destructive">
                  Valor inválido. Escreva assim: 10,50
                </p>
              )}
            </div>

            <div>
              <div className="mb-1.5 block text-xs font-medium text-muted-foreground">Quem pagou?</div>
              <div role="radiogroup" aria-label="Quem pagou?" className="flex gap-2">
                <button
                  type="button"
                  role="radio"
                  aria-checked={payerId === currentUserId}
                  onClick={() => setPayerId(currentUserId)}
                  disabled={isDisabled}
                  className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                    payerId === currentUserId
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/30"
                  }`}
                  data-testid="quick-split-payer-self"
                >
                  <PersonLabel name="Você" handle={currentUserHandle} nameClassName="text-sm truncate" />
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={payerId === counterparty.id}
                  onClick={() => setPayerId(counterparty.id)}
                  disabled={isDisabled}
                  className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                    payerId === counterparty.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/30"
                  }`}
                  data-testid="quick-split-payer-other"
                >
                  <PersonLabel name={participants[1].name} handle={counterparty.handle} nameClassName="text-sm truncate" />
                </button>
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

            {(totalCents > 0 || !isAmountValid) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-2"
                data-testid="quick-split-preview"
              >
                {splitMethod === "equal" && (
                  <div className="rounded-xl border bg-card/50 p-3 min-h-[88px] flex flex-col justify-center">
                    {isAmountValid && shares ? (
                      participants.map((p, i) => (
                        <div key={p.id} className="flex items-center justify-between py-1 text-sm">
                          <span>{p.name}</span>
                          <span className="font-semibold tabular-nums">
                            {formatBRL(shares[i].shareAmountCents)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-center text-xs text-destructive">
                        Valor inválido. Escreva assim: 10,50
                      </p>
                    )}
                  </div>
                )}

                {splitMethod === "percentage" && (
                  <div className="rounded-xl border bg-card/50 p-3 space-y-3 min-h-[88px]">
                    <div className="flex items-center gap-3">
                      <span className="text-sm flex-1">Você</span>
                      <div className="flex items-center gap-1 w-24">
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="50"
                          value={myPercentage}
                          onChange={(e) => setMyPercentage(e.target.value)}
                          disabled={isDisabled}
                          className="h-11 text-right text-base"
                          aria-invalid={percentageWarning ? true : undefined}
                          aria-describedby="quick-split-percent-error"
                          data-testid="quick-split-my-percentage"
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                      {shares && isAmountValid && (
                        <span className="text-sm font-semibold tabular-nums w-20 text-right">
                          {formatBRL(shares[0].shareAmountCents)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm flex-1">{participants[1].name}</span>
                      <div className="flex items-center gap-1 w-24">
                        <span className="w-full text-right text-sm tabular-nums">
                          {percentageBasisPoints === null
                            ? "—"
                            : percentText(FULL_PERCENT_BASIS_POINTS - percentageBasisPoints).replace(/,00$/, "")}
                        </span>
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                      {shares && isAmountValid && (
                        <span className="text-sm font-semibold tabular-nums w-20 text-right">
                          {formatBRL(shares[1].shareAmountCents)}
                        </span>
                      )}
                    </div>
                    {!isAmountValid && (
                      <p className="text-xs text-destructive">
                        Valor inválido. Escreva assim: 10,50
                      </p>
                    )}
                    {percentageWarning && (
                      <p className="text-xs text-destructive" id="quick-split-percent-error">
                        {percentageWarning}
                      </p>
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
                          aria-label="Seu valor fixo"
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
            {shares && (
              <div
                className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs font-medium text-foreground"
                data-testid="quick-split-debt-summary"
              >
                {payerId === currentUserId ? (
                  <>
                    {counterparty.name} deve <Money cents={otherShareCents} /> para você
                  </>
                ) : (
                  <>
                    Você deve <Money cents={myShareCents} /> para {counterparty.name}
                  </>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="ghost"
                className="min-h-11 flex-1"
                onClick={handleClose}
                disabled={isDisabled}
              >
                Cancelar
              </Button>
              <Button
                className="min-h-11 flex-1 gap-2"
                onClick={handleConfirm}
                disabled={!isValid || isDisabled}
                aria-busy={isConfirming}
                data-testid="quick-split-confirm"
              >
                {isConfirming ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : isConfirmed ? (
                  <Check className="mr-1.5 h-4 w-4" />
                ) : (
                  <Receipt className="mr-1.5 h-4 w-4" />
                )}
                {isConfirming ? "Dividindo…" : isConfirmed ? "Dividido!" : "Dividir conta"}
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
