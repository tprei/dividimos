import type { Expense, ExpenseItem, User } from "@/types";
import type { Guest } from "@/stores/bill-store";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";

export interface ScanDraftCandidate {
  expense: Expense;
  items: ExpenseItem[];
  participants: User[];
  guests: Guest[];
  occurredOn: string;
}

export function buildScanDraftCandidate(input: {
  result: ReceiptOcrResult;
  occurredOn: string;
  groupId: string | null;
  participants: User[];
  guests: Guest[];
  creatorId: string;
  nowIso: string;
}): ScanDraftCandidate {
  const expenseId = crypto.randomUUID();
  const expense: Expense = {
    id: expenseId,
    groupId: input.groupId ?? "",
    creatorId: input.creatorId,
    title: input.result.merchant || "Nota escaneada",
    merchantName: input.result.merchant || null,
    expenseType: "itemized",
    totalAmount: 0,
    serviceFeePercent: input.result.serviceFeeBasisPoints / 100,
    serviceFeeBasisPoints: input.result.serviceFeeBasisPoints,
    fixedFees: input.result.fixedFeesCents,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };

  const items: ExpenseItem[] = input.result.items.map((item) => ({
    id: crypto.randomUUID(),
    expenseId,
    description: item.description,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    totalPriceCents: item.totalCents,
    createdAt: input.nowIso,
  }));

  return {
    expense,
    items,
    participants: input.participants,
    guests: input.guests,
    occurredOn: input.occurredOn,
  };
}
