export type PixKeyType = "phone" | "cpf" | "email" | "random";

export type SplitType = "equal" | "percentage" | "fixed";

export type GroupMemberStatus = "invited" | "accepted";

// ============================================================
// New Expense-based types (Splitwise model)
// ============================================================

export type ExpenseStatus = "draft" | "active" | "settled";

export type ExpenseType = "itemized" | "single_amount";

export type SettlementStatus = "pending" | "confirmed";

// ============================================================
// User types (unchanged)
// ============================================================

export interface User {
  id: string;
  email: string;
  handle: string;
  name: string;
  phone?: string;
  pixKeyType: PixKeyType;
  pixKeyHint: string;
  avatarUrl?: string;
  onboarded: boolean;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string;
}

// ============================================================
// Group types (unchanged)
// ============================================================

export interface Group {
  id: string;
  name: string;
  creatorId: string;
  createdAt: string;
}

export interface GroupMember {
  groupId: string;
  userId: string;
  status: GroupMemberStatus;
  invitedBy: string;
  createdAt: string;
  acceptedAt?: string;
  user?: UserProfile;
}

export interface GroupWithMembers extends Group {
  members: (GroupMember & { user: UserProfile })[];
}

// ============================================================
// Expense types (replace Bill)
// ============================================================

/** An expense within a group. Every expense belongs to exactly one group. */
export interface Expense {
  id: string;
  groupId: string;
  creatorId: string;
  title: string;
  merchantName?: string;
  expenseType: ExpenseType;
  totalAmount: number;
  serviceFeePercent: number;
  fixedFees: number;
  status: ExpenseStatus;
  createdAt: string;
  updatedAt: string;
}

/** A line item within an itemized expense. */
export interface ExpenseItem {
  id: string;
  expenseId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  createdAt: string;
}

/** A user's computed share of an expense (what they owe). */
export interface ExpenseShare {
  id: string;
  expenseId: string;
  userId: string;
  shareAmountCents: number;
}

/** A user who paid for an expense (who fronted the money). */
export interface ExpensePayer {
  expenseId: string;
  userId: string;
  amountCents: number;
}

// ============================================================
// Balance types (running net balances per group pair)
// ============================================================

/**
 * Running net balance between two users in a group.
 * Convention: userA < userB (UUID ordering).
 * Positive amountCents = userA owes userB.
 * Negative amountCents = userB owes userA.
 */
export interface Balance {
  groupId: string;
  userA: string;
  userB: string;
  amountCents: number;
  updatedAt: string;
}

// ============================================================
// Settlement types (replace GroupSettlement, LedgerEntry, Payment)
// ============================================================

/** A payment from one user to another to settle a debt within a group. */
export interface Settlement {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  status: SettlementStatus;
  createdAt: string;
  confirmedAt?: string;
}

// ============================================================
// RPC request / result types (type-safe Supabase RPC calls)
// ============================================================

/** Request payload for the activate_expense RPC function. */
export interface ActivateExpenseRequest {
  /** The expense to transition from draft → active. */
  expense_id: string;
}

/**
 * Result returned by the activate_expense RPC function.
 * The RPC validates that shares sum to total, transitions the expense
 * to active, and atomically updates the balances table.
 */
export interface ActivateExpenseResult {
  /** The activated expense ID. */
  expenseId: string;
  /** New status (always "active" on success). */
  status: "active";
  /** Balances that were created or updated by this activation. */
  updatedBalances: ActivateExpenseBalanceUpdate[];
}

/** A single balance row that was upserted during activation. */
export interface ActivateExpenseBalanceUpdate {
  groupId: string;
  userA: string;
  userB: string;
  /** The new net balance after this expense was applied. */
  newAmountCents: number;
  /** The delta applied by this expense (positive = increased A's debt to B). */
  deltaCents: number;
}

/** Request payload for the record_settlement RPC function. */
export interface RecordSettlementRequest {
  /** The group this settlement belongs to. */
  group_id: string;
  /** The user making the payment. */
  from_user_id: string;
  /** The user receiving the payment. */
  to_user_id: string;
  /** Amount in centavos. Must be positive. */
  amount_cents: number;
}

/**
 * Result returned by the record_settlement RPC function.
 * The RPC creates a settlement record and atomically updates
 * the balances table.
 */
export interface RecordSettlementResult {
  /** The created settlement record. */
  settlement: Settlement;
  /** The updated balance between the two users after the settlement. */
  updatedBalance: {
    groupId: string;
    userA: string;
    userB: string;
    newAmountCents: number;
  };
}

// ============================================================
// Composite types for UI consumption
// ============================================================

/** Expense with all related data for the detail view. */
export interface ExpenseWithDetails extends Expense {
  items: ExpenseItem[];
  shares: (ExpenseShare & { user: UserProfile })[];
  payers: (ExpensePayer & { user: UserProfile })[];
}

/** Summary of what a participant owes/is owed for a single expense. */
export interface ExpenseParticipantSummary {
  userId: string;
  user: UserProfile;
  shareAmountCents: number;
  paidAmountCents: number;
  /** Positive = this user is owed money. Negative = this user owes money. */
  netCents: number;
}

/** A directed debt edge between two users (for settlement display). */
export interface DebtEdge {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

/** Group balance summary with all debts between members. */
export interface GroupBalanceSummary {
  groupId: string;
  debts: DebtEdge[];
  /** Total amount owed across all pairs. */
  totalDebtCents: number;
}

export interface DebtSummary {
  groupId: string;
  groupName: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyAvatarUrl: string | null;
  amountCents: number;
  direction: "owes" | "owed";
}

// ============================================================
// Legacy type aliases (for gradual migration of components)
// ============================================================

/** @deprecated Use ExpenseType instead */
export type BillType = ExpenseType;

/** @deprecated Use ExpenseStatus instead */
export type BillStatus = ExpenseStatus | "partially_settled";

/** @deprecated Use ExpensePayer instead */
export interface BillPayer {
  userId: string;
  amountCents: number;
}

/** @deprecated Use Expense instead */
export interface Bill {
  id: string;
  creatorId: string;
  billType: BillType;
  title: string;
  merchantName?: string;
  status: BillStatus;
  serviceFeePercent: number;
  fixedFees: number;
  totalAmount: number;
  totalAmountInput: number;
  payers: BillPayer[];
  groupId?: string;
  createdAt: string;
  updatedAt: string;
}

/** @deprecated Use ExpenseItem instead */
export interface BillItem {
  id: string;
  billId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  createdAt: string;
}

/** @deprecated */
export interface BillSplit {
  userId: string;
  splitType: SplitType;
  value: number;
  computedAmountCents: number;
}

/** @deprecated */
export interface ItemSplit {
  id: string;
  itemId: string;
  userId: string;
  splitType: SplitType;
  value: number;
  computedAmountCents: number;
}

/** @deprecated Use Settlement instead */
export type DebtStatus = "pending" | "partially_paid" | "settled";

/** @deprecated */
export type LedgerEntryType = "debt" | "payment";

/** @deprecated */
export type BillParticipantStatus = "invited" | "accepted" | "declined";

/** @deprecated */
export interface GroupSettlement {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  paidAmountCents: number;
  status: DebtStatus;
  paidAt?: string;
  createdAt: string;
}

/** @deprecated */
export interface BillParticipant {
  billId: string;
  userId: string;
  status: BillParticipantStatus;
  invitedBy?: string;
  respondedAt?: string;
  user?: User;
  joinedAt: string;
}

/** @deprecated */
export interface LedgerEntry {
  id: string;
  billId?: string;
  entryType: LedgerEntryType;
  groupId?: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  paidAmountCents: number;
  status: DebtStatus;
  paidAt?: string;
  createdAt: string;
}


/** @deprecated Use ExpenseWithDetails instead */
export interface BillWithDetails extends Bill {
  participants: (BillParticipant & { user: User })[];
  items: (BillItem & { splits: (ItemSplit & { user: User })[] })[];
  ledger: LedgerEntry[];
  billSplits: BillSplit[];
}
