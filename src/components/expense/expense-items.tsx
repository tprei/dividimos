"use client";

import { AvatarStack } from "@/components/shared/avatar-stack";
import { Money } from "@/components/shared/money";
import { formatBRL } from "@/lib/currency";
import { attributeItem, type PayerAttribution } from "@/lib/expense-attribution";
import { displayNames } from "@/lib/people";
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
  participantId: (participantIndex: number) => string;
  participantAvatarUrl: (participantIndex: number) => string | null;
  participantIsGuest: (participantIndex: number) => boolean;
  showHeading?: boolean;
}
function buildBreakdownLabel(
  consumers: Array<{ name: string; amountCents: number }>,
): string {
  if (consumers.length === 0) return "";
  if (consumers.length === 1) {
    return `Para ${consumers[0].name}, ${formatBRL(consumers[0].amountCents)}`;
  }
  const allEqual = consumers.every((c) => c.amountCents === consumers[0].amountCents);
  const names = consumers.map((c) => c.name);
  const namesText =
    names.length === 2
      ? `${names[0]} e ${names[1]}`
      : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
  if (allEqual) {
    return `Dividido entre ${namesText}, ${formatBRL(consumers[0].amountCents)} cada`;
  }
  return `Dividido entre ${namesText}: ${consumers.map((c) => `${c.name} ${formatBRL(c.amountCents)}`).join(", ")}`;
}


export function ExpenseItems({
  items,
  itemAssignments,
  payers,
  participantName,
  participantId,
  participantAvatarUrl,
  participantIsGuest,
  showHeading = true,
}: ExpenseItemsProps) {
  const solePayerName =
    payers.length === 1 ? participantName(payers[0].participantIndex) : null;
  const names = displayNames([...new Set(itemAssignments?.map((assignment) => assignment.participantIndex))].map((index) => ({
    id: participantId(index), name: participantName(index), isGuest: participantIsGuest(index),
  })), { style: "short" });

  return (
    <section className={showHeading ? "mt-6" : undefined}>
      {showHeading && <h2 className="mb-3 text-lg font-semibold">Itens</h2>}
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
              className="rounded-xl border bg-card px-3 py-2.5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p title={item.description} className="min-w-0 truncate text-base font-semibold leading-5 text-foreground">
                  {item.description}
                </p>
                <Money cents={item.totalPriceCents} size="sm" className="shrink-0 font-semibold" />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs leading-4 text-muted-foreground">
                  {item.quantityMilliunits > 1000
                    ? `${formatExpenseQuantity(item.quantityMilliunits as ExpenseQuantity)}× `
                    : ""}
                  {formatBRL(item.unitPriceCents)}
                  {solePayerName !== null && ` · Pago por ${solePayerName}`}
                </p>
                {attribution.consumers.length > 0 && (
                  <div className="shrink-0">
                    <AvatarStack
                      people={attribution.consumers.map((consumer) => {
                        const id = participantId(consumer.participantIndex);
                        const name = names.get(id) ?? participantName(consumer.participantIndex);
                        return {
                          id,
                          name,
                          avatarUrl: participantAvatarUrl(consumer.participantIndex),
                          isGuest: participantIsGuest(consumer.participantIndex),
                        };
                      })}
                      size="xs"
                      label={buildBreakdownLabel(
                        attribution.consumers.map((consumer) => {
                          const id = participantId(consumer.participantIndex);
                          const name = names.get(id) ?? participantName(consumer.participantIndex);
                          return { name, amountCents: consumer.amountCents };
                        }),
                      )}
                    />
                  </div>
                )}
              </div>
              {attribution.unassignedCents !== 0 && (
                <p className="mt-1.5 text-xs font-semibold text-destructive-text">
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
