import type { Expense, ExpenseItem, User, Bill, BillItem, LedgerEntry } from "@/types";

export const userAlice: User = {
  id: "user-alice",
  email: "alice@example.com",
  handle: "alice",
  name: "Alice Silva",
  pixKeyType: "email",
  pixKeyHint: "a***e@example.com",
  onboarded: true,
  createdAt: "2024-01-01T00:00:00Z",
};

export const userBob: User = {
  id: "user-bob",
  email: "bob@example.com",
  handle: "bob",
  name: "Bob Santos",
  pixKeyType: "email",
  pixKeyHint: "b**b@example.com",
  onboarded: true,
  createdAt: "2024-01-01T00:00:00Z",
};

export const userCarlos: User = {
  id: "user-carlos",
  email: "carlos@example.com",
  handle: "carlos",
  name: "Carlos Souza",
  pixKeyType: "cpf",
  pixKeyHint: "***.***.*89*-01",
  onboarded: true,
  createdAt: "2024-01-01T00:00:00Z",
};

export function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "expense-1",
    groupId: "group-1",
    creatorId: "user-alice",
    expenseType: "itemized",
    title: "Jantar",
    totalAmount: 0,
    serviceFeePercent: 10,
    fixedFees: 0,
    status: "draft",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeSingleAmountExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "expense-1",
    groupId: "group-1",
    creatorId: "user-alice",
    expenseType: "single_amount",
    title: "Aluguel",
    totalAmount: 0,
    serviceFeePercent: 0,
    fixedFees: 0,
    status: "draft",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeExpenseItem(overrides: Partial<ExpenseItem> = {}): ExpenseItem {
  return {
    id: "item-1",
    expenseId: "expense-1",
    description: "Pizza",
    quantity: 1,
    unitPriceCents: 5000,
    totalPriceCents: 5000,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// Legacy aliases for gradual migration of other test files
/** @deprecated Use makeExpense instead */
export function makeItemizedBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: "bill-1",
    creatorId: "user-alice",
    billType: "itemized",
    title: "Jantar",
    status: "draft",
    serviceFeePercent: 10,
    fixedFees: 0,
    totalAmount: 0,
    totalAmountInput: 0,
    payers: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

/** @deprecated Use makeSingleAmountExpense instead */
export function makeSingleAmountBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: "bill-1",
    creatorId: "user-alice",
    billType: "single_amount",
    title: "Aluguel",
    status: "draft",
    serviceFeePercent: 0,
    fixedFees: 0,
    totalAmount: 0,
    totalAmountInput: 10000,
    payers: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

/** @deprecated Use makeExpenseItem instead */
export function makeBillItem(overrides: Partial<BillItem> = {}): BillItem {
  return {
    id: "item-1",
    billId: "bill-1",
    description: "Pizza",
    quantity: 1,
    unitPriceCents: 5000,
    totalPriceCents: 5000,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

/** @deprecated Use DebtEdge instead */
export function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "ledger-1",
    billId: "bill-1",
    entryType: "debt",
    fromUserId: "user-bob",
    toUserId: "user-alice",
    amountCents: 5000,
    paidAmountCents: 0,
    status: "pending",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}
