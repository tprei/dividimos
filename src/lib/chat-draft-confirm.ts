import { saveExpenseDraft } from "@/lib/supabase/expense-actions";
import { activateExpense } from "@/lib/supabase/expense-rpc";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

export interface ConfirmDraftParams {
  result: ChatExpenseResult;
  groupId: string;
  creatorId: string;
  counterpartyId: string;
}

export type ConfirmDraftResult =
  | { success: true; expenseId: string }
  | { success: false; error: string };

function buildShares(
  result: ChatExpenseResult,
  creatorId: string,
  counterpartyId: string,
): Array<{ userId: string; shareAmountCents: number }> {
  if (result.splitType === "equal") {
    const half = Math.floor(result.amountCents / 2);
    const remainder = result.amountCents - half * 2;
    return [
      { userId: creatorId, shareAmountCents: half + remainder },
      { userId: counterpartyId, shareAmountCents: half },
    ];
  }

  if (result.items.length > 0) {
    const creatorTotal = result.items.reduce((sum, item) => sum + item.totalCents, 0);
    const counterpartyTotal = result.amountCents - creatorTotal;
    return [
      { userId: creatorId, shareAmountCents: Math.max(0, creatorTotal) },
      { userId: counterpartyId, shareAmountCents: Math.max(0, counterpartyTotal) },
    ];
  }

  const half = Math.floor(result.amountCents / 2);
  const remainder = result.amountCents - half * 2;
  return [
    { userId: creatorId, shareAmountCents: half + remainder },
    { userId: counterpartyId, shareAmountCents: half },
  ];
}

function resolvePayerId(
  payerHandle: string | null,
  creatorId: string,
  counterpartyId: string,
): string {
  if (!payerHandle || payerHandle === "SELF") return creatorId;
  return counterpartyId;
}

export async function confirmDraftExpense(
  params: ConfirmDraftParams,
): Promise<ConfirmDraftResult> {
  const { result, groupId, creatorId, counterpartyId } = params;

  const payerId = resolvePayerId(result.payerHandle, creatorId, counterpartyId);
  const shares = buildShares(result, creatorId, counterpartyId);

  const draftResult = await saveExpenseDraft({
    groupId,
    creatorId,
    title: result.title,
    merchantName: result.merchantName ?? undefined,
    expenseType: result.expenseType,
    totalAmount: result.amountCents,
    serviceFeePercent: 0,
    fixedFees: 0,
    shares,
    payers: [{ userId: payerId, amountCents: result.amountCents }],
  });

  if ("error" in draftResult) {
    return { success: false, error: draftResult.error };
  }

  const activateResult = await activateExpense({
    expense_id: draftResult.expenseId,
  });

  if ("error" in activateResult) {
    return { success: false, error: activateResult.error };
  }

  return { success: true, expenseId: draftResult.expenseId };
}
