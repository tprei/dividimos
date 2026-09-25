"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { PersonLabel } from "@/components/shared/person-label";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Popover, PopoverContent, PopoverTitle } from "@/components/ui/popover";
import { SelectField } from "@/components/ui/select-field";
import { formatBRL } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { displayNames } from "@/lib/people";
import { useAppViewport } from "@/hooks/use-app-viewport";
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
  /** Control the form is positioned against. */
  anchor: HTMLElement | null;
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
  anchor,
}: GroupRegisterPaymentSheetProps) {
  const people = [{ id: currentUserHandle, name: currentUserHandle }, ...counterparties];
  const labels = displayNames(people, { style: "full", viewerId: currentUserHandle });
  const shortLabels = displayNames(people, { style: "short", viewerId: currentUserHandle });
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
  const { keyboardOpen } = useAppViewport();

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
    <Popover
      open
      onOpenChange={(next) => {
        // Every dismissal path goes through the pending-operation guard, so a
        // tap outside can never abandon a confirming ledger write.
        if (!next) guardedDismiss();
      }}
    >
      <PopoverContent
        anchor={anchor}
        side="top"
        align="center"
        aria-busy={status === "confirming"}
        data-testid="group-payment-sheet"
      >
        <div className="flex items-center justify-between gap-2">
          <PopoverTitle>Registrar pagamento</PopoverTitle>
          <button
            type="button"
            onClick={guardedDismiss}
            disabled={status === "confirming"}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Fechar"
            data-testid="group-payment-dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className={cn(
            "flex flex-col gap-3 transition-opacity",
            isConfirming && "pointer-events-none opacity-60",
          )}
        >
          <SelectField
            label="Com quem?"
            value={counterparty?.id ?? ""}
            onChange={setSelectedId}
            disabled={isConfirming}
            options={counterparties.map((member) => ({
              value: member.id,
              label: labels.get(member.id) ?? member.name,
            }))}
          />
          <div className="text-center">
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

          {/* Quick-add collapses with the keyboard up: direct entry stays
              available and the amount plus Registrar must remain visible. */}
          {!(capped && capCents === 0) && !keyboardOpen && (
            <div className="flex justify-center">
              <AmountQuickAdd
                valueCents={amountCents}
                onChangeCents={setAmountCents}
                maxCents={capped ? capCents : undefined}
                disabled={isConfirming}
              />
            </div>
          )}

          <div>
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
            <PersonLabel name={labels.get(currentUserHandle) ?? "Você"} nameClassName="text-sm" />
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
              <PersonLabel name={counterparty.name} overrideName={shortLabels.get(counterparty.id)} nameClassName="text-sm" />
            </button>
          )}
            </div>
          </div>
        </div>

        {status === "error" && errorMessage && (
          <div
            className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
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
      </PopoverContent>
    </Popover>
  );
}
