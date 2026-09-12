"use client";

import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Banknote, Check, Loader2, X } from "lucide-react";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { PersonLabel } from "@/components/shared/person-label";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { formatBRL } from "@/lib/currency";
import { useBackHandler } from "@/hooks/use-back-handler";

export type GroupPaymentStatus = "idle" | "confirming" | "confirmed" | "error";

export interface GroupPaymentCounterparty {
  id: string;
  name: string;
  handle: string;
  owedByMeCents: number;
  owedToMeCents: number;
}

export interface GroupPaymentResult {
  counterpartyId: string;
  payerIsSelf: boolean;
  amountCents: number;
  allowOverpay: boolean;
}

interface GroupRegisterPaymentSheetProps {
  currentUserHandle: string;
  counterparties: GroupPaymentCounterparty[];
  initialPayerIsSelf?: boolean;
  onConfirm: (result: GroupPaymentResult) => void;
  onDismiss: () => void;
  status?: GroupPaymentStatus;
  errorMessage?: string;
}

export function GroupRegisterPaymentSheet({
  currentUserHandle,
  counterparties,
  initialPayerIsSelf = true,
  onConfirm,
  onDismiss,
  status = "idle",
  errorMessage,
}: GroupRegisterPaymentSheetProps) {
  useBackHandler(true, onDismiss);
  const [amountCents, setAmountCents] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(
    counterparties[0]?.id ?? null,
  );
  const [payerIsSelf, setPayerIsSelf] = useState(initialPayerIsSelf);

  const counterparty = useMemo(
    () =>
      counterparties.find((member) => member.id === selectedId) ??
      counterparties[0] ??
      null,
    [counterparties, selectedId],
  );

  const [allowOverpay, setAllowOverpay] = useState(false);

  const capCents = counterparty
    ? payerIsSelf
      ? counterparty.owedByMeCents
      : counterparty.owedToMeCents
    : 0;
  const capped = !allowOverpay;

  // Snap the amount down when the cap itself changes (direction flip,
  // counterparty change, or locking the override back to the debt).
  const capKey = capped ? String(capCents) : "unlocked";
  const [prevCapKey, setPrevCapKey] = useState(capKey);
  if (capKey !== prevCapKey) {
    setPrevCapKey(capKey);
    if (capped && amountCents > capCents) setAmountCents(capCents);
  }

  const isConfirming = status === "confirming";
  const isConfirmed = status === "confirmed";
  const isDisabled = isConfirming || isConfirmed || amountCents <= 0 || !counterparty;

  const handleConfirm = useCallback(() => {
    if (!counterparty || amountCents <= 0 || isConfirming || isConfirmed) return;
    onConfirm({ counterpartyId: counterparty.id, payerIsSelf, amountCents, allowOverpay });
  }, [amountCents, counterparty, isConfirmed, isConfirming, onConfirm, payerIsSelf, allowOverpay]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="rounded-2xl border bg-card p-4"
      data-testid="group-payment-sheet"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Banknote className="h-4 w-4 text-primary" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            Registrar pagamento
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Fechar"
          data-testid="group-payment-dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 text-xs text-muted-foreground">Com quem?</div>
        <div className="flex flex-wrap gap-2">
          {counterparties.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => setSelectedId(member.id)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                counterparty?.id === member.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:border-primary/30"
              }`}
              data-testid={`group-payment-member-${member.id}`}
            >
              <PersonLabel name={member.name} handle={member.handle} nameClassName="text-sm" />
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 text-center">
        <div className="mb-1 text-xs text-muted-foreground">
          {counterparty
            ? payerIsSelf
              ? `Você pagou para ${counterparty.name}`
              : `${counterparty.name} pagou para você`
            : "Selecione um membro"}
        </div>
        <div className="flex items-center justify-center gap-1">
          <span className="text-lg font-bold text-muted-foreground">R$</span>
          <CurrencyInput
            valueCents={amountCents}
            onChangeCents={setAmountCents}
            maxCents={capped ? capCents : undefined}
            className="w-32 text-3xl font-bold"
            autoFocus
            aria-label="Valor do pagamento"
            data-testid="group-payment-amount"
          />
        </div>
        {amountCents > 0 && (
          <div className="mt-1 text-xs text-muted-foreground" data-testid="group-payment-preview">
            {formatBRL(amountCents)}
          </div>
        )}
        {capped && capCents > 0 && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="text-muted-foreground">
              Dívida atual: {formatBRL(capCents)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-full px-3"
              onClick={() => setAmountCents(capCents)}
              data-testid="group-payment-settle-all"
            >
              Quitar tudo
            </Button>
          </div>
        )}
        {capped && capCents === 0 && (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="group-payment-settled">
            Vocês estão quitados nesse grupo.
          </p>
        )}
        {capped ? (
          <button
            type="button"
            onClick={() => setAllowOverpay(true)}
            className="mt-2 text-xs font-semibold text-primary underline-offset-2 hover:underline"
            data-testid="group-payment-allow-overpay"
          >
            {capCents === 0 ? "Registrar pagamento mesmo assim" : "Registrar outro valor"}
          </button>
        ) : (
          <div className="mt-2 rounded-xl border border-warning/30 bg-warning/10 p-2 text-xs text-warning-foreground">
            <p className="font-semibold">Sem limite de dívida.</p>
            <p>O que passar da dívida vira crédito pra quem recebeu.</p>
            <button
              type="button"
              onClick={() => setAllowOverpay(false)}
              className="mt-1 font-semibold text-primary underline-offset-2 hover:underline"
              data-testid="group-payment-limit-to-debt"
            >
              Limitar à dívida
            </button>
          </div>
        )}
      </div>

      {!(capped && capCents === 0) && (
        <div className="mb-3 flex justify-center">
          <AmountQuickAdd
            valueCents={amountCents}
            onChangeCents={setAmountCents}
            maxCents={capped ? capCents : undefined}
          />
        </div>
      )}

      <div className="mb-4">
        <div className="mb-1.5 text-xs text-muted-foreground">Quem pagou?</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPayerIsSelf(true)}
            className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
              payerIsSelf
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:border-primary/30"
            }`}
            data-testid="group-payment-payer-self"
          >
            <PersonLabel name="Eu" handle={currentUserHandle} nameClassName="text-sm" />
          </button>
          {counterparty && (
            <button
              type="button"
              onClick={() => setPayerIsSelf(false)}
              className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                !payerIsSelf
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:border-primary/30"
              }`}
              data-testid="group-payment-payer-other"
            >
              <PersonLabel name={counterparty.name} handle={counterparty.handle} nameClassName="text-sm" />
            </button>
          )}
        </div>
      </div>

      {status === "error" && errorMessage && (
        <div
          className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          data-testid="group-payment-error"
        >
          {errorMessage}
        </div>
      )}

      <Button
        size="sm"
        className="w-full"
        onClick={handleConfirm}
        disabled={isDisabled}
        data-testid="group-payment-confirm"
      >
        {isConfirming ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="mr-1.5 h-3.5 w-3.5" />
        )}
        {isConfirming ? "Registrando…" : "Registrar"}
      </Button>
    </motion.div>
  );
}
