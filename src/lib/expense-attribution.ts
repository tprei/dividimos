import type { ExpenseItemAssignmentPayload, ExpensePayerPayload } from "@/types/ledger";

/** Basis points (0–10_000) of `part` within `whole`; 0 when `whole` is not positive. */
export function shareBasisPoints(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part * 10_000) / whole);
}

export interface ItemConsumer {
  participantIndex: number;
  amountCents: number;
  basisPoints: number;
}

export interface ItemAttribution {
  consumers: ItemConsumer[];
  assignedCents: number;
  /** Item total minus what the assignments cover. 0 when fully divided. */
  unassignedCents: number;
}

/** Groups the persisted assignments for one item, biggest consumer first. */
export function attributeItem(
  itemIndex: number,
  itemTotalCents: number,
  assignments: ExpenseItemAssignmentPayload[] | null,
): ItemAttribution {
  const consumers: ItemConsumer[] = [];
  let assignedCents = 0;
  for (const assignment of assignments ?? []) {
    if (assignment.itemIndex !== itemIndex) continue;
    consumers.push({
      participantIndex: assignment.participantIndex,
      amountCents: assignment.amountCents,
      basisPoints: shareBasisPoints(assignment.amountCents, itemTotalCents),
    });
    assignedCents += assignment.amountCents;
  }
  consumers.sort(
    (a, b) => b.amountCents - a.amountCents || a.participantIndex - b.participantIndex,
  );
  return { consumers, assignedCents, unassignedCents: itemTotalCents - assignedCents };
}

export interface PayerAttribution {
  participantIndex: number;
  amountCents: number;
  basisPoints: number;
}

/** Payers with a nonzero contribution, biggest first. */
export function attributePayers(
  payers: ExpensePayerPayload[],
  totalCents: number,
): PayerAttribution[] {
  return payers
    .filter((payer) => payer.amountCents > 0)
    .map((payer) => ({
      participantIndex: payer.participantIndex,
      amountCents: payer.amountCents,
      basisPoints: shareBasisPoints(payer.amountCents, totalCents),
    }))
    .sort((a, b) => b.amountCents - a.amountCents || a.participantIndex - b.participantIndex);
}
