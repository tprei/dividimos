"use client";

import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatBRL } from "@/lib/currency";
import { attributeItem, type PayerAttribution } from "@/lib/expense-attribution";
import {
  formatExpenseQuantity,
  type ExpenseQuantity,
} from "@/lib/expense-quantity";
import type {
  ExpenseItemAssignmentPayload,
  ExpenseItemPayload,
} from "@/types/ledger";

interface ExpenseItemsProps {
  items: ExpenseItemPayload[];
  itemAssignments: ExpenseItemAssignmentPayload[] | null;
  payers: PayerAttribution[];
  participantName: (participantIndex: number) => string;
  participantAvatarUrl: (participantIndex: number) => string | null;
  participantIsGuest: (participantIndex: number) => boolean;
}

export function ExpenseItems({
  items,
  itemAssignments,
  payers,
  participantName,
  participantAvatarUrl,
  participantIsGuest,
}: ExpenseItemsProps) {
  const solePayerName =
    payers.length === 1 ? participantName(payers[0].participantIndex) : null;

  return (
    <section className="mt-5">
      <h2 className="mb-1 text-sm font-semibold">Itens</h2>
      <p className="mb-2 text-xs text-muted-foreground">
        Quanto cada pessoa consumiu de cada item.
      </p>
      <div className="space-y-2">
        {items.map((item, itemIndex) => {
          const attribution = attributeItem(
            itemIndex,
            item.totalPriceCents,
            itemAssignments,
          );
          return (
            <div
              key={`${item.description}-${itemIndex}`}
              className="rounded-xl border bg-card px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{item.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.quantityMilliunits > 1000
                      ? `${formatExpenseQuantity(item.quantityMilliunits as ExpenseQuantity)}x `
                      : ""}
                    {formatBRL(item.unitPriceCents)}/un
                    {solePayerName !== null && ` · Pago por ${solePayerName}`}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {formatBRL(item.totalPriceCents)}
                </span>
              </div>
              {attribution.consumers.length > 0 && (
                <ul className="mt-2 space-y-2 border-t border-dashed border-border pt-2">
                  {attribution.consumers.map((consumer) => {
                    const name = participantName(consumer.participantIndex);
                    return (
                      <li
                        key={consumer.participantIndex}
                        className="flex items-center gap-2"
                      >
                        {participantIsGuest(consumer.participantIndex) ? (
                          <GuestAvatar size="xs" />
                        ) : (
                          <UserAvatar
                            name={name}
                            avatarUrl={participantAvatarUrl(consumer.participantIndex)}
                            size="xs"
                          />
                        )}
                        <span className="min-w-0 flex-1 text-xs font-medium">{name}</span>
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted"
                        >
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${consumer.basisPoints / 100}%` }}
                          />
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                          {Math.round(consumer.basisPoints / 100)}%
                        </span>
                        <Money
                          cents={consumer.amountCents}
                          className="shrink-0 text-xs font-semibold"
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
              {attribution.unassignedCents !== 0 && (
                <p className="mt-1.5 text-xs font-semibold text-destructive">
                  {attribution.unassignedCents > 0
                    ? `Sem divisão: ${formatBRL(attribution.unassignedCents)}`
                    : `Divisão acima do item: ${formatBRL(-attribution.unassignedCents)}`}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
