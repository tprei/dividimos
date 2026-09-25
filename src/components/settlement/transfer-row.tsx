"use client";

import { ArrowRight, ChevronRight } from "lucide-react";
import { GuestAvatar, GuestBadge } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { PersonLabel } from "@/components/shared/person-label";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Chip } from "@/components/ui/chip";
import { formatBRL } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { Transfer } from "@/types/ledger";
import type { SettlementPerson } from "./consolidated-balance-card";

interface TransferRowProps {
  transfer: Transfer;
  from: SettlementPerson;
  to: SettlementPerson;
  meId: string;
  highlighted: boolean;
  onPay: () => void;
  onCollect: () => void;
}

export function TransferRow({
  transfer,
  from,
  to,
  meId,
  highlighted,
  onPay,
  onCollect,
}: TransferRowProps) {
  const pendingCounterparty =
    (transfer.fromId === meId && to.isPending) || (transfer.toId === meId && from.isPending);
  const guestInvolved = from.isGuest || to.isGuest;
  const iPay = transfer.fromId === meId && !to.isPending && !guestInvolved;
  const iReceive = transfer.toId === meId && transfer.fromKind === "user" && !from.isPending;
  const actionable = iPay || iReceive;
  let statusLabel = "Outro acerto";
  if (iPay) statusLabel = "Você paga";
  else if (iReceive) statusLabel = "Cobrar";
  else if (guestInvolved && (transfer.fromId === meId || transfer.toId === meId))
    statusLabel = "Combinar fora do app";
  else if (pendingCounterparty) statusLabel = "Aguardando o convite";
  const rowLabel = `${statusLabel}: ${from.name} paga ${formatBRL(transfer.amountCents)} para ${to.name}`;
  const content = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          {from.isGuest ? (
            <GuestAvatar size="xs" />
          ) : (
            <UserAvatar name={from.name} avatarUrl={from.avatarUrl} size="xs" />
          )}
          <PersonLabel name={from.name} handle={from.handle} nameClassName="min-w-0 text-[15px]" />
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          {to.isGuest ? (
            <GuestAvatar size="xs" />
          ) : (
            <UserAvatar name={to.name} avatarUrl={to.avatarUrl} size="xs" />
          )}
          <PersonLabel name={to.name} handle={to.handle} nameClassName="min-w-0 text-[15px]" />
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {(from.isGuest || to.isGuest) && <GuestBadge />}
          {(from.isPending || to.isPending) && (
            <Chip tone="warning" className="shrink-0">
              Convite pendente
            </Chip>
          )}
        </span>
        <span className="block text-xs text-muted-foreground">{statusLabel}</span>
      </span>
      <Money
        cents={transfer.amountCents}
        className={cn("mt-1 shrink-0 self-start text-sm font-semibold", iPay && "text-destructive")}
      />
      {actionable && <ChevronRight className="mt-1 size-4 shrink-0 self-start text-muted-foreground" aria-hidden="true" />}
    </>
  );
  const rowClass = cn(
    "flex min-h-14 w-full items-start gap-3 px-4 py-2 text-left",
    highlighted && "bg-primary/5",
  );
  if (!actionable) {
    return (
      <div
        id={`transfer-${transfer.fromId}-${transfer.toId}`}
        className={rowClass}
        aria-label={rowLabel}
      >
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      id={`transfer-${transfer.fromId}-${transfer.toId}`}
      className={cn(rowClass, "cursor-pointer transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none")}
      aria-label={rowLabel}
      onClick={iPay ? onPay : onCollect}
    >
      {content}
    </button>
  );
}
