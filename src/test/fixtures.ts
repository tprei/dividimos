import type { Expense, ExpenseItem, User } from "@/types";

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
  pixKeyHint: "b***b@example.com",
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

