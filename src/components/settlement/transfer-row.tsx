"use client";

import { ArrowRight } from "lucide-react";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { PersonLabel } from "@/components/shared/person-label";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { haptics } from "@/hooks/use-haptics";
import { formatBRL } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { Transfer } from "@/types/ledger";
import type { SettlementPerson } from "./consolidated-balance-card";

interface TransferRowProps {
  transfer: Transfer;
  from: SettlementPerson;
  to: SettlementPerson;
  fromLabel: string;
  toLabel: string;
  meId: string;
  highlighted: boolean;
  onPay: () => void;
  onCollect: () => void;
}

export function TransferRow({
  transfer,
  from,
  to,
  fromLabel,
  toLabel,
  meId,
  highlighted,
  onPay,
  onCollect,
}: TransferRowProps) {
  const pendingCounterparty =
    (transfer.fromId === meId && to.isPending) ||
    (transfer.toId === meId && from.isPending);
  const guestInvolved = from.isGuest || to.isGuest;
  const iPay = transfer.fromId === meId && !to.isPending && !guestInvolved;
  const iReceive =
    transfer.toId === meId && transfer.fromKind === "user" && !from.isPending;
  const actionable = iPay || iReceive;
  let statusLabel = "Outro pagamento";
  if (iPay) statusLabel = "Pagar";
  else if (iReceive) statusLabel = "Cobrar";
  else if (
    guestInvolved &&
    (transfer.fromId === meId || transfer.toId === meId)
  )
    statusLabel = "Combinar fora do app";
  else if (pendingCounterparty) statusLabel = "Aguardando o convite";
  const rowLabel = `${statusLabel}: ${from.name} paga ${formatBRL(
    transfer.amountCents
  )} para ${to.name}`;
  const actionLabel = iPay
    ? `Pagar ${formatBRL(transfer.amountCents)} para ${to.name}`
    : `Cobrar ${formatBRL(transfer.amountCents)} de ${from.name}`;
  let amountTone: "negative" | "positive" | "neutral" = "neutral";
  if (iPay) amountTone = "negative";
  else if (iReceive) amountTone = "positive";
  return (
    <div
      id={`transfer-${transfer.fromId}-${transfer.toId}`}
      aria-label={actionable ? undefined : rowLabel}
      className={cn(
        "flex min-h-11 items-center gap-2 px-3 py-2",
        !actionable && "text-muted-foreground",
        highlighted && "bg-primary/5"
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {from.isGuest ? (
          <GuestAvatar id={from.id} name={from.name} size="xs" />
        ) : (
          <UserAvatar
            id={from.id}
            name={from.name}
            avatarUrl={from.avatarUrl}
            size="xs"
          />
        )}
        <PersonLabel
          name={from.name}
          overrideName={fromLabel}
          nameClassName="text-sm"
        />
        <ArrowRight
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <PersonLabel
          name={to.name}
          overrideName={toLabel}
          nameClassName="text-sm"
        />
      </div>
      <Money cents={transfer.amountCents} size="sm" tone={amountTone} />
      {actionable && (
        <Button
          variant="ghost"
          size="sm"
          className="-mr-1 px-2 text-primary-text"
          aria-label={actionLabel}
          title={actionLabel}
          onClick={() => {
            haptics.tap();
            (iPay ? onPay : onCollect)();
          }}
        >
          {iPay ? "Pagar" : "Cobrar"}
        </Button>
      )}
      {!actionable && (guestInvolved || pendingCounterparty) && (
        <span className="max-w-24 shrink-0 text-right text-xs leading-tight">
          {statusLabel}
        </span>
      )}
    </div>
  );
}
