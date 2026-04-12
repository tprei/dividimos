import { createClient } from "@/lib/supabase/client";
import { saveExpenseDraft } from "@/lib/supabase/expense-actions";
import { activateExpense } from "@/lib/supabase/expense-rpc";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import type { UserProfile, ActivateExpenseResult } from "@/types";

export interface ConfirmChatDraftParams {
  /** The parsed expense from the LLM. */
  result: ChatExpenseResult;
  /** The DM group this expense belongs to. */
  groupId: string;
  /** The authenticated user who is confirming the draft. */
  currentUserId: string;
  /** All members of the DM group (exactly 2 for a DM). */
  members: UserProfile[];
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
 * Converts a ChatExpenseResult into draft params, saves it, and immediately
 * activates the expense. The activate_expense RPC atomically updates balances
 * and inserts a system_expense message in the DM group's chat.
 *
 * This is the "one-tap confirm" flow for AI-parsed expenses in DM conversations.
 */
export async function confirmChatDraft(
  params: ConfirmChatDraftParams,
): Promise<ConfirmChatDraftResult> {
  const { result, groupId, currentUserId, members } = params;

  // Resolve participant user IDs
  const participantIds = resolveParticipantIds(result, currentUserId, members);
  const payerId = resolvePayerId(result, currentUserId, members);

  // For equal splits: distribute total evenly among participants
  const perPersonCents = Math.floor(result.amountCents / participantIds.length);
  const remainder = result.amountCents - perPersonCents * participantIds.length;

  const shares = participantIds.map((userId, i) => ({
    userId,
    shareAmountCents: perPersonCents + (i === 0 ? remainder : 0),
  }));

  // Build items for itemized expenses
  const items =
    result.expenseType === "itemized"
      ? result.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          totalPriceCents: item.totalCents,
        }))
      : undefined;

  // Step 1: Save draft
  const draftResult = await saveExpenseDraft({
    groupId,
    creatorId: currentUserId,
    title: result.title || "Despesa via IA",
    merchantName: result.merchantName ?? undefined,
    expenseType: result.expenseType,
    totalAmount: result.amountCents,
    serviceFeePercent: 0,
    fixedFees: 0,
    items,
    shares,
    payers: [{ userId: payerId, amountCents: result.amountCents }],
  });

  if ("error" in draftResult) {
    return { error: draftResult.error };
  }

  // Step 2: Activate (atomically updates balances + inserts system message)
  const activateResult = await activateExpense({
    expense_id: draftResult.expenseId,
  });

  if ("error" in activateResult) {
    // Draft was saved but activation failed — clean up the orphaned draft
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
