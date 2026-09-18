"use client";

import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Banknote, Loader2, X } from "lucide-react";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { PersonLabel } from "@/components/shared/person-label";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { formatBRL } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useBackHandler } from "@/hooks/use-back-handler";
import {
  PendingOperationNotice,
  usePendingOperation,
} from "@/components/chat/pending-operation";

export type GroupPaymentStatus = "idle" | "confirming" | "error";

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
  onLeavePending: () => void;
  status?: GroupPaymentStatus;
  errorMessage?: string;
}

export function GroupRegisterPaymentSheet({
  currentUserHandle,
  counterparties,
  initialPayerIsSelf = true,
  onConfirm,
  onDismiss,
  onLeavePending,
  status = "idle",
  errorMessage,
}: GroupRegisterPaymentSheetProps) {
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

  const { showPending, guardedDismiss } = usePendingOperation(status, onDismiss);
  useBackHandler(true, guardedDismiss);

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
  const isDisabled = isConfirming || amountCents <= 0 || !counterparty;

  const handleConfirm = useCallback(() => {
    if (!counterparty || amountCents <= 0 || isConfirming) return;
    onConfirm({ counterpartyId: counterparty.id, payerIsSelf, amountCents, allowOverpay });
  }, [amountCents, counterparty, isConfirming, onConfirm, payerIsSelf, allowOverpay]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="max-h-[60dvh] overflow-y-auto overscroll-contain rounded-2xl border bg-card p-4"
      aria-busy={status === "confirming"}
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
          onClick={guardedDismiss}
          disabled={status === "confirming"}
          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Fechar"
          data-testid="group-payment-dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        className={cn(
          "transition-opacity",
          isConfirming && "pointer-events-none opacity-60",
        )}
      >
      <div className="mb-3">
        <div className="mb-1.5 text-xs text-muted-foreground">Com quem?</div>
        <div className="flex flex-wrap gap-2">
          {counterparties.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => setSelectedId(member.id)}
              disabled={isConfirming}
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
            disabled={isConfirming}
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
              disabled={isConfirming}
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
            disabled={isConfirming}
            className="mt-2 text-xs font-semibold text-primary-text underline-offset-2 hover:underline"
            data-testid="group-payment-allow-overpay"
          >
            {capCents === 0 ? "Registrar pagamento mesmo assim" : "Registrar outro valor"}
          </button>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="group-payment-overpay-note">
            Sem limite: o que passar da dívida vira crédito.{" "}
            <button
              type="button"
              onClick={() => setAllowOverpay(false)}
              disabled={isConfirming}
              className="font-semibold text-primary-text underline-offset-2 hover:underline"
              data-testid="group-payment-limit-to-debt"
            >
              Limitar à dívida
            </button>
          </p>
        )}
      </div>

      {!(capped && capCents === 0) && (
        <div className="mb-3 flex justify-center">
          <AmountQuickAdd
            valueCents={amountCents}
            onChangeCents={setAmountCents}
            maxCents={capped ? capCents : undefined}
            disabled={isConfirming}
          />
        </div>
      )}

      <div className="mb-4">
        <div className="mb-1.5 text-xs text-muted-foreground">Quem pagou?</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPayerIsSelf(true)}
            disabled={isConfirming}
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
              disabled={isConfirming}
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

      </div>

      {status === "error" && errorMessage && (
        <div
          className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          data-testid="group-payment-error"
        >
          {errorMessage}
        </div>
      )}
      <PendingOperationNotice
        show={showPending && status === "confirming"}
        body="A conexão está demorando. Se o pagamento tiver sido registrado, ele aparece aqui na conversa. Sair agora não duplica nada."
        onLeave={onLeavePending}
        testId="group-payment-pending"
      />

      <Button
        className={cn(
          "min-h-11 w-full rounded-lg transition-colors",
          isConfirming && "bg-primary/70 text-primary-foreground opacity-100 disabled:opacity-100",
        )}
        onClick={handleConfirm}
        disabled={isDisabled}
        data-testid="group-payment-confirm"
      >
        {isConfirming ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Registrando…
          </>
        ) : (
          "Registrar"
        )}
      </Button>
    </motion.div>
  );
}
