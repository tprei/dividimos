"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Equal,
  Hash,
  Loader2,
  Percent,
  Receipt,
} from "lucide-react";
import { Money } from "@/components/shared/money";
import { PersonLabel } from "@/components/shared/person-label";
import { displayNames } from "@/lib/people";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { popIn } from "@/lib/animations";
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

  const participants = useMemo(() => {
    const people = [{ id: currentUserId, name: "Você", handle: currentUserHandle }, counterparty];
    const labels = displayNames(people, { style: "short", viewerId: currentUserId });
    return people.map((person) => ({ id: person.id, name: labels.get(person.id) ?? person.name }));
  }, [currentUserId, currentUserHandle, counterparty]);

  const isConfirming = status === "confirming";
  const isConfirmed = status === "confirmed";
  const isDisabled = isConfirming || isConfirmed;
  const dirty = open && !isConfirmed && (title.trim().length > 0 || totalCents > 0);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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
    if ((title.trim() || totalCents > 0) && !window.confirm("Descartar esta conta?")) return;
    onClose();
  };


  if (!open) return null;

  return (
    <Dialog open={open} dismissable={!isDisabled} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <DialogContent showCloseButton={false} data-testid="quick-split-sheet">
        <DialogTitle>Dividir conta</DialogTitle>
        <div className="min-h-0 overflow-y-auto">

          <div className="space-y-4">
            <div>
              <Input
                type="text"
                placeholder="O que estão dividindo?"
                aria-label="Nome da conta"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isDisabled}
                className="text-base md:text-sm"
                data-testid="quick-split-title"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Valor total
              </label>
              <div className="flex h-11 items-center rounded-[0.75rem] border border-input bg-card focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-[input[aria-invalid]]:border-destructive has-[input[aria-invalid]]:ring-3 has-[input[aria-invalid]]:ring-destructive/20">
                <span className="pl-3 text-base leading-6 font-bold text-muted-foreground">R$</span>
                <CurrencyInput
                  valueCents={totalCents}
                  onChangeCents={setTotalCents}
                  onValidityChange={setIsAmountValid}
                  aria-label="Valor total"
                  disabled={isDisabled}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent pl-1.5 text-left text-lg font-bold focus-visible:ring-0 md:text-lg"
                  data-testid="quick-split-amount"
                />
              </div>
              {!isAmountValid && (
                <p className="mt-1 text-xs text-destructive-text">
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
                  className={`min-h-11 min-w-0 flex-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                    payerId === currentUserId
                      ? "border-primary bg-primary/10 text-primary-text"
                      : "border-border bg-background text-muted-foreground hover:border-primary/30"
                  }`}
                  data-testid="quick-split-payer-self"
                >
                  <PersonLabel name="Você" nameClassName="text-sm truncate" />
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={payerId === counterparty.id}
                  onClick={() => setPayerId(counterparty.id)}
                  disabled={isDisabled}
                  className={`min-h-11 min-w-0 flex-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                    payerId === counterparty.id
                      ? "border-primary bg-primary/10 text-primary-text"
                      : "border-border bg-background text-muted-foreground hover:border-primary/30"
                  }`}
                  data-testid="quick-split-payer-other"
                >
                  <PersonLabel name={participants[1].name} nameClassName="text-sm truncate" />
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
                variants={popIn} initial="hidden" animate="visible"
                className="space-y-2"
                data-testid="quick-split-preview"
              >
                {splitMethod === "equal" && (
                  <div className="rounded-xl border bg-card/50 p-3 min-h-[88px] flex flex-col justify-center">
                    {isAmountValid && shares ? (
                      participants.map((p, i) => (
                        <div key={p.id} className="flex items-center justify-between py-1 text-sm">
                          <span>{p.name}</span>
                          <Money cents={shares[i].shareAmountCents} size="sm" />
                        </div>
                      ))
                    ) : (
                      <p className="text-center text-xs text-destructive-text">
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
                          aria-label="Sua porcentagem"
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
                        <Money cents={shares[0].shareAmountCents} size="sm" className="w-20 text-right" />
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
                        <Money cents={shares[1].shareAmountCents} size="sm" className="w-20 text-right" />
                      )}
                    </div>
                    {!isAmountValid && (
                      <p className="text-xs text-destructive-text">
                        Valor inválido. Escreva assim: 10,50
                      </p>
                    )}
                    {percentageWarning && (
                      <p className="text-xs text-destructive-text" id="quick-split-percent-error">
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
                          className="h-11 w-full text-right text-base rounded-lg border border-input bg-transparent px-2.5 py-1 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          data-testid="quick-split-my-fixed"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">{participants[1].name}</span>
                      <Money cents={Math.max(0, totalCents - myFixedCents)} size="sm" />
                    </div>
                    {fixedWarning && (
                      <p className="text-xs text-warning-text">{fixedWarning}</p>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            <AnimatePresence mode="wait">
              {status === "error" && errorMessage && (
                <motion.p
                  key="error"
                  variants={popIn} initial="hidden" animate="visible" exit="exit"
                  className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive-text"
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
