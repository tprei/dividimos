import type { ExpenseState } from "@/stores/bill-store";

export type DraftInspectionState = Pick<
  ExpenseState,
  | "expense"
  | "totalAmountInput"
  | "participants"
  | "guests"
  | "items"
  | "payers"
  | "splits"
  | "billSplits"
  | "occurredOn"
  | "receiptAccessKey"
>;

const LEGACY_ITEMIZED_TITLE = "Nova conta";

/**
 * Determines if an in-progress draft has meaningful user-entered content
 * that warrants a confirmation dialog before replacement.
 *
 * Baselines (from selectDraftForType):
 * - single_amount: title "", serviceFeeBasisPoints 0, participants [me],
 *   no guests/items/payers/splits/billSplits, totalAmountInput 0, fixedFees 0.
 * - itemized: title "" (or "Nova conta", the title drafts saved before the
 *   guided start was created with), serviceFeeBasisPoints 1000, otherwise
 *   same empties.
 *
 * Any deviation, or occurredOn !== null, or receiptAccessKey !== null -> meaningful.
 */
export function hasMeaningfulDraft(
  state: DraftInspectionState,
  currentUserId: string,
): boolean {
  if (!state.expense) {
    return false;
  }

  if (state.receiptAccessKey !== null) {
    return true;
  }

  if (
    state.guests.length > 0 ||
    state.items.length > 0 ||
    state.payers.length > 0 ||
    state.splits.length > 0 ||
    state.billSplits.length > 0
  ) {
    return true;
  }

  if (state.totalAmountInput !== 0) {
    return true;
  }

  const hasOnlyMe =
    state.participants.length === 1 && state.participants[0]?.id === currentUserId;
  if (!hasOnlyMe) {
    return true;
  }

  const { expense } = state;
  if (expense.fixedFees !== 0) {
    return true;
  }

  if (expense.merchantName) {
    return true;
  }

  if (expense.expenseType === "single_amount") {
    if (expense.title !== "" || expense.serviceFeeBasisPoints !== 0) {
      return true;
    }
    return false;
  }

  if (expense.expenseType === "itemized") {
    const untouchedTitle = expense.title === "" || expense.title === LEGACY_ITEMIZED_TITLE;
    if (!untouchedTitle || expense.serviceFeeBasisPoints !== 1000) {
      return true;
    }
    return false;
  }

  return true;
}
