"use client";

import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { haptics } from "@/hooks/use-haptics";
import { formatBRL } from "@/lib/currency";
import { displayNames } from "@/lib/people";
import { cn } from "@/lib/utils";
import {
  PendingOperationNotice,
  usePendingOperation,
} from "@/components/chat/pending-operation";

export type GroupPaymentStatus = "idle" | "confirming" | "error";

export interface GroupPaymentPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface GroupPaymentCounterparty extends GroupPaymentPerson {
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
  currentUser: GroupPaymentPerson;
  counterparties: GroupPaymentCounterparty[];
  initialPayerIsSelf?: boolean;
  onConfirm: (result: GroupPaymentResult) => void;
  onDismiss: () => void;
  onLeavePending: () => void;
  status?: GroupPaymentStatus;
  errorMessage?: string;
}

/** The member you have the most open money with, in either direction. */
function largestBalanceId(counterparties: GroupPaymentCounterparty[]): string | null {
  let best: GroupPaymentCounterparty | null = null;
  for (const member of counterparties) {
    const open = Math.max(member.owedByMeCents, member.owedToMeCents);
    if (best === null || open > Math.max(best.owedByMeCents, best.owedToMeCents)) {
      best = member;
    }
  }
  return best?.id ?? null;
}

/**
 * When only one side of the pair owes, that side is almost certainly the
 * one paying; otherwise keep whatever direction the user already had.
 */
function directionWithDebt(
  member: GroupPaymentCounterparty | null,
  payerIsSelf: boolean,
): boolean {
  if (!member) return payerIsSelf;
  if (member.owedByMeCents > 0 && member.owedToMeCents === 0) return true;
  if (member.owedToMeCents > 0 && member.owedByMeCents === 0) return false;
  return payerIsSelf;
}

/** WAI-ARIA radio pattern movements; every key wraps around the group. */
const RADIO_MOVES: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

/**
 * Roving-tabindex keyboard support for a radio group: arrows and Home/End
 * select the neighbouring radio and move focus to it.
 */
function handleRadioNav(
  event: KeyboardEvent<HTMLButtonElement>,
  onPick: (index: number) => void,
) {
  const move = RADIO_MOVES[event.key];
  if (!move) return;
  const group = event.currentTarget.closest<HTMLElement>('[role="radiogroup"]');
  if (!group) return;
  const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const current = radios.indexOf(event.currentTarget);
  if (current < 0) return;
  event.preventDefault();
  const nextIndex = move(current, radios.length);
  const next = radios.at(nextIndex);
  if (!next) return;
  next.focus();
  onPick(nextIndex);
}

export function GroupRegisterPaymentSheet({
  currentUser,
  counterparties,
  initialPayerIsSelf = true,
  onConfirm,
  onDismiss,
  onLeavePending,
  status = "idle",
  errorMessage,
}: GroupRegisterPaymentSheetProps) {
  const people = [currentUser, ...counterparties];
  const labels = displayNames(people, { style: "full", viewerId: currentUser.id });
  const shortLabels = displayNames(people, { style: "short", viewerId: currentUser.id });
  const [amountCents, setAmountCents] = useState(0);
  const [selectedId, setSelectedId] = useState(() => largestBalanceId(counterparties));
  const [payerIsSelf, setPayerIsSelf] = useState(() =>
    directionWithDebt(
      counterparties.find((member) => member.id === selectedId) ?? null,
      initialPayerIsSelf,
    ),
  );
  // Debt-derived direction only applies until the user picks one themselves.
  const [directionTouched, setDirectionTouched] = useState(false);

  const counterparty = useMemo(
    () =>
      counterparties.find((member) => member.id === selectedId) ??
      counterparties[0] ??
      null,
    [counterparties, selectedId],
  );

  const [allowOverpay, setAllowOverpay] = useState(false);

  const { showPending, guardedDismiss } = usePendingOperation(status, () => {
    if (amountCents > 0 && !window.confirm("Descartar este pagamento?")) return;
    onDismiss();
  });

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

  const pickCounterparty = (member: GroupPaymentCounterparty) => {
    if (member.id === counterparty?.id) return;
    haptics.selectionChanged();
    setSelectedId(member.id);
    // The overpay override belongs to the pair, not the sheet.
    setAllowOverpay(false);
    if (!directionTouched) {
      setPayerIsSelf(directionWithDebt(member, payerIsSelf));
    }
  };
  const pickDirection = (next: boolean) => {
    if (next === payerIsSelf) return;
    haptics.selectionChanged();
    setDirectionTouched(true);
    setPayerIsSelf(next);
  };

  const counterpartyShort = counterparty
    ? (shortLabels.get(counterparty.id) ?? counterparty.name)
    : "";
  const counterpartyFull = counterparty
    ? (labels.get(counterparty.id) ?? counterparty.name)
    : "";
  const selectedPersonIndex = counterparties.findIndex(
    (member) => member.id === counterparty?.id,
  );
  const personFocusIndex = Math.max(selectedPersonIndex, 0);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Every dismissal path goes through the pending-operation guard, so a
        // tap outside can never abandon a confirming ledger write.
        if (!next) guardedDismiss();
      }}
    >
      <DialogContent
        aria-busy={isConfirming}
        aria-describedby={undefined}
        data-testid="group-payment-sheet"
        className="gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 px-4 pt-4 pb-1">
          <DialogTitle className="text-base">Registrar pagamento</DialogTitle>
        </DialogHeader>

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-2 pb-3 transition-opacity keyboard:gap-3",
            isConfirming && "pointer-events-none opacity-60",
          )}
        >
          <section aria-labelledby="group-payment-who">
            <h3 id="group-payment-who" className="mb-2 text-xs font-medium text-muted-foreground">
              Com quem?
            </h3>
            <div
              role="radiogroup"
              aria-labelledby="group-payment-who"
              className="-mx-4 flex snap-x gap-1 overflow-x-auto px-3 pt-1 pb-1 [scrollbar-width:none]"
            >
              {counterparties.map((member, index) => {
                const selected = member.id === counterparty?.id;
                return (
                  <button
                    key={member.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={labels.get(member.id) ?? member.name}
                    tabIndex={index === personFocusIndex ? 0 : -1}
                    disabled={isConfirming}
                    onClick={() => pickCounterparty(member)}
                    onKeyDown={(event) =>
                      handleRadioNav(event, (nextIndex) => {
                        const next = counterparties[nextIndex];
                        if (next) pickCounterparty(next);
                      })
                    }
                    className="flex w-17 shrink-0 snap-start flex-col items-center gap-1.5 rounded-xl px-1 py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span
                      className={cn(
                        "relative rounded-full ring-offset-2 ring-offset-card transition-shadow",
                        selected ? "ring-2 ring-primary" : "ring-0",
                      )}
                    >
                      <UserAvatar id={member.id} name={member.name} avatarUrl={member.avatarUrl} size="md" />
                      {selected && (
                        <span
                          aria-hidden="true"
                          className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground"
                        >
                          <Check className="size-3" strokeWidth={3} />
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "w-full truncate text-center text-xs",
                        selected ? "font-semibold text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {shortLabels.get(member.id) ?? member.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {counterparty && (
            <div
              role="radiogroup"
              aria-label="Quem pagou?"
              className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1"
            >
              <DirectionOption
                selected={payerIsSelf}
                disabled={isConfirming}
                onSelect={() => pickDirection(true)}
                onRadioNav={(index) => pickDirection(index === 0)}
                label={`Você pagou para ${counterpartyFull}`}
                from={currentUser}
                to={counterparty}
                testId="group-payment-payer-self"
              />
              <DirectionOption
                selected={!payerIsSelf}
                disabled={isConfirming}
                onSelect={() => pickDirection(false)}
                onRadioNav={(index) => pickDirection(index === 0)}
                label={`${counterpartyFull} pagou para você`}
                from={counterparty}
                to={currentUser}
                testId="group-payment-payer-other"
              />
            </div>
          )}

          <div className="flex flex-col items-center gap-1.5 text-center">
            <p className="max-w-full truncate text-xs text-muted-foreground">
              {payerIsSelf
                ? `Você pagou para ${counterpartyShort}`
                : `${counterpartyShort} pagou para você`}
            </p>
            <div className="flex items-baseline justify-center gap-1.5">
              <span className="text-xl font-bold text-muted-foreground">R$</span>
              <CurrencyInput
                valueCents={amountCents}
                onChangeCents={setAmountCents}
                maxCents={capped ? capCents : undefined}
                disabled={isConfirming}
                className={cn(
                  "h-12 w-40 rounded-none border-0 border-b-2 border-border bg-transparent px-1 text-4xl font-bold focus-visible:border-primary focus-visible:ring-0 md:text-4xl",
                  amountCents === 0 && "text-muted-foreground/70",
                )}
                autoFocus
                aria-label="Valor do pagamento"
                data-testid="group-payment-amount"
              />
            </div>
            <StatusLine
              capped={capped}
              capCents={capCents}
              disabled={isConfirming}
              onSettleAll={() => setAmountCents(capCents)}
              onAllowOverpay={() => setAllowOverpay(true)}
              onLimitToDebt={() => setAllowOverpay(false)}
            />
          </div>

          {!(capped && capCents === 0) && (
            <div className="flex justify-center keyboard:hidden">
              <AmountQuickAdd
                valueCents={amountCents}
                onChangeCents={setAmountCents}
                maxCents={capped ? capCents : undefined}
                disabled={isConfirming}
              />
            </div>
          )}

          {status === "error" && errorMessage && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive-text"
              data-testid="group-payment-error"
            >
              {errorMessage}
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 pt-2 pb-4">
          <PendingOperationNotice
            show={showPending && isConfirming}
            body="A conexão está demorando. Se o pagamento tiver sido registrado, ele aparece aqui na conversa. Sair agora não duplica nada."
            onLeave={onLeavePending}
            testId="group-payment-pending"
          />
          <Button
            className={cn(
              "min-h-12 w-full rounded-xl text-base",
              isConfirming && "bg-primary/70 text-primary-foreground opacity-100 disabled:opacity-100",
            )}
            onClick={handleConfirm}
            disabled={isDisabled}
            data-testid="group-payment-confirm"
          >
            {isConfirming ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" />
                Registrando…
              </>
            ) : (
              <>
                Registrar
                {amountCents > 0 && (
                  <span className="tabular-nums" data-testid="group-payment-preview">
                    {formatBRL(amountCents)}
                  </span>
                )}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DirectionOption({
  selected,
  disabled,
  onSelect,
  onRadioNav,
  label,
  from,
  to,
  testId,
}: {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRadioNav: (index: number) => void;
  label: string;
  from: GroupPaymentPerson;
  to: GroupPaymentPerson;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onSelect}
      onKeyDown={(event) => handleRadioNav(event, onRadioNav)}
      tabIndex={selected ? 0 : -1}
      data-testid={testId}
      className={cn(
        "flex min-h-11 items-center justify-center gap-1.5 rounded-lg outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "bg-card shadow-sm ring-1 ring-primary/40" : "opacity-60 hover:opacity-90",
      )}
    >
      <UserAvatar id={from.id} name={from.name} avatarUrl={from.avatarUrl} size="sm" />
      <ArrowRight
        aria-hidden="true"
        className={cn("size-4", selected ? "text-primary-text" : "text-muted-foreground")}
        strokeWidth={2.5}
      />
      <UserAvatar id={to.id} name={to.name} avatarUrl={to.avatarUrl} size="sm" />
    </button>
  );
}

function StatusLine({
  capped,
  capCents,
  disabled,
  onSettleAll,
  onAllowOverpay,
  onLimitToDebt,
}: {
  capped: boolean;
  capCents: number;
  disabled: boolean;
  onSettleAll: () => void;
  onAllowOverpay: () => void;
  onLimitToDebt: () => void;
}) {
  // Visually a text link; the pseudo-element keeps the tap target at 44px
  // without spending that height on the line.
  const link =
    "relative px-1 text-xs font-semibold text-primary-text underline-offset-2 after:absolute after:inset-x-0 after:-inset-y-3.5 hover:underline disabled:opacity-50";

  if (!capped) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="group-payment-overpay-note">
        Sem limite: o que passar da dívida vira crédito.{" "}
        <button
          type="button"
          onClick={onLimitToDebt}
          disabled={disabled}
          className={link}
          data-testid="group-payment-limit-to-debt"
        >
          Limitar à dívida
        </button>
      </p>
    );
  }

  if (capCents === 0) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-1 text-xs">
        <span className="text-muted-foreground" data-testid="group-payment-settled">
          Vocês estão em dia nesse grupo.
        </span>
        <button
          type="button"
          onClick={onAllowOverpay}
          disabled={disabled}
          className={link}
          data-testid="group-payment-allow-overpay"
        >
          Registrar pagamento mesmo assim
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 text-xs">
      <span className="text-muted-foreground tabular-nums">Dívida: {formatBRL(capCents)}</span>
      <button
        type="button"
        onClick={onSettleAll}
        disabled={disabled}
        className={link}
        data-testid="group-payment-settle-all"
      >
        Quitar tudo
      </button>
      <button
        type="button"
        onClick={onAllowOverpay}
        disabled={disabled}
        className={link}
        data-testid="group-payment-allow-overpay"
      >
        Outro valor
      </button>
    </div>
  );
}
