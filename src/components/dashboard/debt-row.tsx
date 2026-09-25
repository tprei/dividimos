"use client";

import { ListRow } from "@/components/ui/list-row";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Chip } from "@/components/ui/chip";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatBRL } from "@/lib/currency";
import type { DebtRow } from "@/lib/ledger/debt-rows";

export interface DebtRowButtonProps {
  row: DebtRow;
  displayName?: string;
  onSelect: (row: DebtRow, anchor: HTMLButtonElement) => void;
}

export function DebtRowButton({
  row,
  displayName,
  onSelect,
}: DebtRowButtonProps) {
  const group = row.isDm ? "Conversa" : row.groupName;
  const direction = row.direction === "owes" ? "você deve" : "te deve";

  return (
    <button
      type="button"
      className="block w-full min-w-0 rounded-xl text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring motion-safe:transition-transform motion-safe:active:scale-[0.97]"
      aria-label={`${
        displayName ?? row.counterpartyName
      }, ${direction} ${formatBRL(row.amountCents)}, ${group}`}
      onClick={(event) => onSelect(row, event.currentTarget)}
    >
      <ListRow
        title={displayName ?? row.counterpartyName}
        subtitle={group}
        leading={
          row.counterpartyKind === "guest" ? (
            <GuestAvatar
              id={row.counterpartyId}
              name={row.counterpartyName}
              size="sm"
            />
          ) : (
            <UserAvatar
              id={row.counterpartyId}
              name={row.counterpartyName}
              avatarUrl={row.counterpartyAvatarUrl}
              size="sm"
            />
          )
        }
        trailing={
          <span className="flex flex-col items-end gap-1">
            <Money
              cents={row.amountCents}
              size="sm"
              tone={row.direction === "owes" ? "negative" : "positive"}
            />
            {row.counterpartyKind === "guest" && (
              <Chip tone="guest">Convidado</Chip>
            )}
          </span>
        }
      />
    </button>
  );
}
