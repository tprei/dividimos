"use client";

import { ChevronRight } from "lucide-react";
import { GuestAvatar, GuestBadge } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { PersonLabel } from "@/components/shared/person-label";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatBRL } from "@/lib/currency";
import type { DebtRow } from "@/lib/ledger/debt-rows";

export interface DebtRowButtonProps {
  row: DebtRow;
  onSelect: (row: DebtRow) => void;
}

export function DebtRowButton({ row, onSelect }: DebtRowButtonProps) {
  const group = row.isDm ? "Conversa direta" : row.groupName;
  const direction = row.direction === "owes" ? "você deve" : "te deve";
  const amountClass = row.direction === "owes" ? "text-destructive" : "text-success";

  return (
    <button
      type="button"
      className="flex min-h-14 w-full min-w-0 items-center gap-3 px-4 py-2 text-left"
      aria-label={`${row.counterpartyName}, ${direction} ${formatBRL(row.amountCents)}, ${group}`}
      onClick={() => onSelect(row)}
    >
      {row.counterpartyKind === "guest" ? (
        <GuestAvatar size="sm" />
      ) : (
        <UserAvatar
          name={row.counterpartyName}
          avatarUrl={row.counterpartyAvatarUrl}
          size="sm"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <PersonLabel name={row.counterpartyName} handle={row.counterpartyHandle} nameClassName="text-[15px]" />
          {row.counterpartyKind === "guest" && <GuestBadge />}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{group}</span>
      </span>
      <Money cents={row.amountCents} className={`shrink-0 text-sm ${amountClass}`} />
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
