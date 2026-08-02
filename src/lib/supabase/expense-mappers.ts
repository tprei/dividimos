import type {
  Balance,
  Expense,
  ExpenseGuest,
  ExpenseGuestShare,
  ExpenseItem,
  ExpensePayer,
  ExpenseShare,
  Settlement,
  UserProfile,
} from "@/types";
import type { Database } from "@/types/database";

type ExpenseGuestRow = Database["public"]["Tables"]["expense_guests"]["Row"];
type ExpenseGuestShareRow = Database["public"]["Tables"]["expense_guest_shares"]["Row"];
type ExpenseRow = Database["public"]["Tables"]["expenses"]["Row"];
type ExpenseItemRow = Database["public"]["Tables"]["expense_items"]["Row"];
type ExpenseShareRow = Database["public"]["Tables"]["expense_shares"]["Row"];
type ExpensePayerRow = Database["public"]["Tables"]["expense_payers"]["Row"];
type BalanceRow = Database["public"]["Tables"]["balances"]["Row"];
type SettlementRow = Database["public"]["Tables"]["settlements"]["Row"];
type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

/**
 * Issue #477: the database stores service_fee_basis_points (integer,
 * 0..10000). `serviceFeePercent` (0..100, may have up to 2 decimal
 * digits) is display-only and MAY lose precision converting from
 * integer basis points to a float — never derive a fee amount from it.
 * `serviceFeeBasisPoints` carries the exact DB value through so every
 * fee-amount consumer (bill-store, BillSummary, ItemsStep, simplify.ts)
 * can call `computeServiceFeeCents` and match the server's rounding
 * exactly instead of drifting a cent on float-imprecise percentages
 * (e.g. 6460 bps stored as 64.6, which is not exactly representable).
 */
export function expenseRowToExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    groupId: row.group_id,
    creatorId: row.creator_id,
    title: row.title,
    merchantName: row.merchant_name ?? undefined,
    expenseType: row.expense_type,
    totalAmount: row.total_amount,
    serviceFeePercent: row.service_fee_basis_points / 100,
    serviceFeeBasisPoints: row.service_fee_basis_points,
    fixedFees: row.fixed_fees,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function expenseItemRowToExpenseItem(row: ExpenseItemRow): ExpenseItem {
  return {
    id: row.id,
    expenseId: row.expense_id,
    description: row.description,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    totalPriceCents: row.total_price_cents,
    createdAt: row.created_at,
  };
}

export function expenseShareRowToExpenseShare(row: ExpenseShareRow): ExpenseShare {
  return {
    id: row.id,
    expenseId: row.expense_id,
    userId: row.user_id,
    shareAmountCents: row.share_amount_cents,
  };
}

export function expensePayerRowToExpensePayer(row: ExpensePayerRow): ExpensePayer {
  return {
    expenseId: row.expense_id,
    userId: row.user_id,
    amountCents: row.amount_cents,
  };
}

export function balanceRowToBalance(row: BalanceRow): Balance {
  return {
    groupId: row.group_id,
    userA: row.user_a,
    userB: row.user_b,
    amountCents: row.amount_cents,
    updatedAt: row.updated_at,
  };
}

export function settlementRowToSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    groupId: row.group_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    amountCents: row.amount_cents,
    status: row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? undefined,
  };
}

export function userProfileRowToUserProfile(row: UserProfileRow): UserProfile {
  if (row.id === null || row.handle === null || row.name === null) {
    throw new Error("user_profiles row missing required column");
  }
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    avatarUrl: row.avatar_url ?? undefined,
  };
}

export function expenseGuestRowToExpenseGuest(row: ExpenseGuestRow): ExpenseGuest {
  return {
    id: row.id,
    expenseId: row.expense_id,
    displayName: row.display_name,
    claimedBy: row.claimed_by ?? undefined,
    claimedAt: row.claimed_at ?? undefined,
    createdAt: row.created_at,
  };
}

export function expenseGuestShareRowToExpenseGuestShare(
  row: ExpenseGuestShareRow,
): ExpenseGuestShare {
  return {
    id: row.id,
    expenseId: row.expense_id,
    guestId: row.guest_id,
    shareAmountCents: row.share_amount_cents,
  };
}
