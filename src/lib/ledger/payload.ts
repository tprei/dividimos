import type {
  CanonicalGuestShareRow,
  CanonicalPayerRow,
  CanonicalShareRow,
  ExpenseAllocationIssue,
  ExpenseItemAssignmentInput,
  ExpenseMoneyInput,
  ParticipantOrderEntry,
  ValidationResult,
} from "@/lib/expense-money";
import {
  validateExpenseMoney,
  summarizeExpenseAllocations,
  brandExpenseCents,
  computeServiceFeeCents,
} from "@/lib/expense-money";
import type {
  ExpenseHeader,
  ExpenseItemAssignmentPayload,
  ExpenseItemPayload,
  ExpensePayerPayload,
  ExpensePayload,
  ExpenseSplitMethod,
  ParticipantRef,
  WireIssue,
} from "@/types/ledger";
import type { ExpenseState } from "@/stores/bill-store";
import { computeConsumption } from "@/stores/bill-store";
import { formatExpenseQuantity, type ExpenseQuantity } from "@/lib/expense-quantity";

export type BillPayloadState = Pick<
  ExpenseState,
  | "expense"
  | "items"
  | "participants"
  | "guests"
  | "splits"
  | "billSplits"
  | "payers"
  | "totalAmountInput"
  | "receiptAccessKey"
>;
export function buildExpensePayload(
  state: BillPayloadState,
  occurredOn: string,
): ValidationResult<{ header: ExpenseHeader; payload: ExpensePayload }, ExpenseAllocationIssue | WireIssue> {
  if (!state.expense) {
    return { ok: false, issue: { code: "incomplete_expense" } };
  }
  const { expense, items, participants, guests, splits, billSplits, payers, totalAmountInput } = state;

  const itemsSubtotal = items.reduce((sum, item) => sum + item.totalPriceCents, 0);
  const serviceFeeResult = computeServiceFeeCents(itemsSubtotal, expense.serviceFeeBasisPoints);
  const serviceFeeCents = serviceFeeResult.ok ? serviceFeeResult.value : 0;
  const totalAmountCents =
    expense.expenseType === "single_amount"
      ? totalAmountInput
      : itemsSubtotal + serviceFeeCents + expense.fixedFees;

  const moneyInput: ExpenseMoneyInput = {
    expenseType: expense.expenseType,
    totalAmountCents,
    serviceFeeBasisPoints: expense.serviceFeeBasisPoints,
    fixedFeesCents: expense.fixedFees,
    items: items.map((item) => ({
      description: item.description,
      quantity: formatExpenseQuantity(item.quantity as ExpenseQuantity),
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalPriceCents,
    })),
  };

  const moneyResult = validateExpenseMoney(moneyInput, "draft");
  if (!moneyResult.ok) {
    return { ok: false, issue: moneyResult.issue };
  }

  const money = moneyResult.value;
  if (money.outcome !== "complete") {
    return { ok: false, issue: { code: "incomplete_expense" } };
  }

  const allPersonIds = [
    ...participants.map((p) => p.id),
    ...guests.map((g) => g.id),
  ];

  const consumption = computeConsumption(
    expense,
    allPersonIds,
    items,
    splits,
    billSplits,
  );

  const participantOrder: ParticipantOrderEntry[] = [
    ...participants.map((p) => ({ kind: "user" as const, userId: p.id })),
    ...guests.map((g) => ({ kind: "guest" as const, guestLocalId: g.id })),
  ];

  const shares: CanonicalShareRow[] = participants.map((p) => ({
    userId: p.id,
    shareAmountCents: brandExpenseCents(consumption.get(p.id) ?? 0),
  }));

  const guestShares: CanonicalGuestShareRow[] = guests.map((g) => ({
    guestLocalId: g.id,
    shareAmountCents: brandExpenseCents(consumption.get(g.id) ?? 0),
  }));

  const activePayers: CanonicalPayerRow[] = payers
    .filter((payer) => payer.amountCents > 0)
    .map((payer) => ({
      userId: payer.userId,
      amountCents: brandExpenseCents(payer.amountCents),
    }));

  const participantUserIdSet = new Set(participants.map((p) => p.id));
  const itemAssignments: ExpenseItemAssignmentInput =
    expense.expenseType === "itemized"
      ? {
          kind: "detailed",
          itemIds: items.map((item) => item.id),
          rows: splits.map((split) => ({
            itemId: split.itemId,
            participant: participantUserIdSet.has(split.userId)
              ? { kind: "user" as const, userId: split.userId }
              : { kind: "guest" as const, guestLocalId: split.userId },
            amountCents: brandExpenseCents(split.computedAmountCents),
          })),
        }
      : { kind: "aggregate_only" };

  const summaryResult = summarizeExpenseAllocations({
    money,
    participantOrder,
    shares,
    guestShares,
    payers: activePayers,
    itemAssignments,
  });

  if (!summaryResult.ok) {
    return { ok: false, issue: summaryResult.issue };
  }

  const summary = summaryResult.value;

  if (summary.shareState !== "exact") {
    return { ok: false, issue: { code: "share_total_mismatch" } };
  }

  if (summary.payerState !== "exact") {
    return { ok: false, issue: { code: "payer_total_mismatch" } };
  }

  const header: ExpenseHeader = {
    occurredOn,
    title: expense.title.trim(),
    merchantName: expense.merchantName?.trim() || null,
    expenseType: expense.expenseType,
    totalCents: money.summary.totalAmountCents,
    serviceFeeBasisPoints: money.serviceFeeBasisPoints,
    fixedFeeCents: money.fixedFeesCents,
    receiptAccessKey: state.receiptAccessKey,
  };

  const payloadItems: ExpenseItemPayload[] = money.items.map((item) => ({
    description: item.description,
    quantityMilliunits: item.quantity,
    unitPriceCents: item.unitPriceCents,
    totalPriceCents: item.totalPriceCents,
  }));

  const payloadParticipants: ParticipantRef[] = [
    ...participants.map((p) => ({
      kind: "user" as const,
      userId: p.id,
    })),
    ...guests.map((g) => ({
      kind: "guest" as const,
      guestId: g.remoteId,
      displayName: g.name,
    })),
  ];

  const payloadShares: number[] = [
    ...summary.shareRows.map((row) => row.shareAmountCents as number),
    ...summary.guestShareRows.map((row) => row.shareAmountCents as number),
  ];

  const payloadPayers: ExpensePayerPayload[] = summary.payerRows.map((row) => ({
    participantIndex: allPersonIds.indexOf(row.userId),
    amountCents: row.amountCents as number,
  }));

  const payloadItemAssignments: ExpenseItemAssignmentPayload[] | null =
    expense.expenseType === "itemized"
      ? splits.map((split) => ({
          itemIndex: items.findIndex((item) => item.id === split.itemId),
          participantIndex: allPersonIds.indexOf(split.userId),
          amountCents: split.computedAmountCents,
        }))
      : null;

  // Recorded so an edit reopens the control the author used. Shares alone
  // cannot distinguish "split equally" from a custom split that happens to
  // come out even.
  const splitMethod: ExpenseSplitMethod | null =
    expense.expenseType === "single_amount"
      ? (state.billSplits[0]?.splitType ?? null)
      : null;

  return {
    ok: true,
    value: {
      header,
      payload: {
        items: payloadItems,
        participants: payloadParticipants,
        shares: payloadShares,
        payers: payloadPayers,
        itemAssignments: payloadItemAssignments,
        splitMethod,
      },
    },
  };
}
