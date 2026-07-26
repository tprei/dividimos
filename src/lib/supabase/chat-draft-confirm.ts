import { createClient } from "@/lib/supabase/client";
import { saveExpenseDraft } from "@/lib/supabase/expense-actions";
import { activateExpense } from "@/lib/supabase/expense-rpc";
import {
  parseExpenseCents,
  ZERO_EXPENSE_CENTS,
  ZERO_GRAPH_REVISION,
  ZERO_SERVICE_FEE_BASIS_POINTS,
  type ExpenseCents,
} from "@/lib/expense-money";
import {
  computeExpenseLineTotalCents,
  parseExpenseQuantity,
} from "@/lib/expense-quantity";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import type { UserProfile, ActivateExpenseResult } from "@/types";

export interface PrecomputedShare {
  userId: string;
  shareAmountCents: number;
}

export interface ConfirmChatDraftParams {
  /** The parsed expense from the LLM. */
  result: ChatExpenseResult;
  /** The DM group this expense belongs to. */
  groupId: string;
  /** The authenticated user who is confirming the draft. */
  currentUserId: string;
  /** All members of the DM group (exactly 2 for a DM). */
  members: UserProfile[];
  /** Pre-computed shares for non-equal splits. When provided, skips equal-split computation. */
  precomputedShares?: PrecomputedShare[];
}

export interface ConfirmChatDraftSuccess {
  expenseId: string;
  status: "active";
  updatedBalances: ActivateExpenseResult["updatedBalances"];
}

export type ConfirmChatDraftResult =
  | ConfirmChatDraftSuccess
  | { error: string };

/**
 * Resolves participant handles from the ChatExpenseResult to user IDs
 * using the provided member list.
 */
function resolveParticipantIds(
  result: ChatExpenseResult,
  currentUserId: string,
  members: UserProfile[],
): string[] {
  if (result.participants.length === 0) {
    // No explicit participants — include all DM members
    return members.map((m) => m.id);
  }

  const ids = new Set<string>();
  // Always include the current user
  ids.add(currentUserId);

  for (const p of result.participants) {
    if (p.matchedHandle) {
      const member = members.find((m) => m.handle === p.matchedHandle);
      if (member) ids.add(member.id);
    }
  }

  // If no other participants resolved, include all DM members
  if (ids.size < 2 && members.length === 2) {
    for (const m of members) ids.add(m.id);
  }

  return Array.from(ids);
}

/**
 * Resolves the payer user ID from the ChatExpenseResult.
 * Returns the current user for "SELF", otherwise looks up by handle.
 * Falls back to currentUserId if unresolved.
 */
function resolvePayerId(
  result: ChatExpenseResult,
  currentUserId: string,
  members: UserProfile[],
): string {
  if (!result.payerHandle || result.payerHandle === "SELF") {
    return currentUserId;
  }

  const member = members.find((m) => m.handle === result.payerHandle);
  return member?.id ?? currentUserId;
}

/**
 * Converts a validated ChatExpenseResult into a graph draft, saves it, and
 * activates it using the returned graph revision.
 *
 * This is the "one-tap confirm" flow for AI-parsed expenses in DM
 * conversations.
 */
export async function confirmChatDraft(
  params: ConfirmChatDraftParams,
): Promise<ConfirmChatDraftResult> {
  const { result, groupId, currentUserId, members, precomputedShares } = params;

  const amount = parseExpenseCents(result.amountCents, "positive");
  if (!amount.ok) {
    return { error: "A despesa reconhecida não tem um valor válido." };
  }

  const participantIds = resolveParticipantIds(result, currentUserId, members);
  const payerId = resolvePayerId(result, currentUserId, members);
  if (participantIds.length === 0 || !participantIds.includes(payerId)) {
    return { error: "Não foi possível identificar os participantes da despesa." };
  }

  let shares: Array<{ userId: string; shareAmountCents: ExpenseCents }>;
  if (precomputedShares && precomputedShares.length > 0) {
    shares = [];
    for (const share of precomputedShares) {
      const parsed = parseExpenseCents(share.shareAmountCents, "allow");
      if (!parsed.ok) {
        return { error: "A divisão reconhecida não é válida." };
      }
      shares.push({ userId: share.userId, shareAmountCents: parsed.value });
    }
  } else {
    const perPersonCents = Math.floor(result.amountCents / participantIds.length);
    const remainder = result.amountCents - perPersonCents * participantIds.length;
    shares = [];
    for (const [index, userId] of participantIds.entries()) {
      const parsed = parseExpenseCents(
        perPersonCents + (index === 0 ? remainder : 0),
        "allow",
      );
      if (!parsed.ok) {
        return { error: "A divisão reconhecida não é válida." };
      }
      shares.push({ userId, shareAmountCents: parsed.value });
    }
  }

  const items = [];
  if (result.expenseType === "itemized") {
    for (const item of result.items) {
      const quantity = parseExpenseQuantity(item.quantity);
      const unitPriceCents = parseExpenseCents(item.unitPriceCents, "positive");
      const totalPriceCents = parseExpenseCents(item.totalCents, "positive");
      if (!quantity.ok || !unitPriceCents.ok || !totalPriceCents.ok) {
        return { error: "Os itens reconhecidos não são válidos." };
      }
      const computed = computeExpenseLineTotalCents(quantity.value, unitPriceCents.value);
      if (!computed.ok || computed.value !== totalPriceCents.value) {
        return { error: "Os itens reconhecidos não fecham a conta." };
      }
      items.push({
        description: item.description,
        quantity: quantity.value,
        unitPriceCents: unitPriceCents.value,
        totalPriceCents: totalPriceCents.value,
      });
    }
  }

  const payerAmount = parseExpenseCents(amount.value, "positive");
  if (!payerAmount.ok) {
    return { error: "O pagador reconhecido não é válido." };
  }

  const draftResult = await saveExpenseDraft({
    groupId,
    title: result.title || "Despesa via IA",
    merchantName: result.merchantName,
    expenseType: result.expenseType,
    totalAmountCents: amount.value,
    serviceFeeBasisPoints: ZERO_SERVICE_FEE_BASIS_POINTS,
    fixedFeesCents: ZERO_EXPENSE_CENTS,
    items,
    shares,
    payers: [{ userId: payerId, amountCents: payerAmount.value }],
    participantOrder: participantIds.map((userId) => ({ kind: "user", userId })),
    expectedGraphRevision: ZERO_GRAPH_REVISION,
    saveOperationId: crypto.randomUUID(),
  });

  if ("error" in draftResult) {
    return { error: draftResult.error };
  }
  const activateResult = await activateExpense({
    expense_id: draftResult.expenseId,
    expectedGraphRevision: draftResult.graphRevision,
  });

  if ("error" in activateResult) {
    const supabase = createClient();
    await supabase
      .from("expenses")
      .delete()
      .eq("id", draftResult.expenseId)
      .eq("status", "draft");
    return { error: activateResult.error };
  }

  return {
    expenseId: activateResult.expenseId,
    status: "active",
    updatedBalances: activateResult.updatedBalances,
  };
}
