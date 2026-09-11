export type PixKeyType = "cpf" | "email" | "phone" | "random";

export type SplitType = "equal" | "percentage" | "fixed";

export type ExpenseType = "itemized" | "single_amount";

export type NotificationCategory =
  | "expenses"
  | "settlements"
  | "nudges"
  | "groups"
  | "messages";

export type NotificationPreferences = Partial<Record<NotificationCategory, boolean>>;

export interface User {
  id: string;
  email: string;
  handle: string;
  name: string;
  avatarUrl?: string | null;
  pixKeyType?: PixKeyType | null;
  pixKeyHint?: string | null;
  notificationPreferences?: NotificationPreferences | null;
  onboarded: boolean;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string | null;
}

export interface Expense {
  id: string;
  groupId: string;
  creatorId: string;
  title: string;
  merchantName?: string | null;
  expenseType: ExpenseType;
  totalAmount: number;
  serviceFeePercent: number;
  serviceFeeBasisPoints: number;
  fixedFees: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseItem {
  id: string;
  expenseId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  createdAt: string;
}

export interface ExpenseShare {
  id: string;
  expenseId: string;
  userId: string;
  shareAmountCents: number;
}

export interface ExpensePayer {
  expenseId: string;
  userId: string;
  amountCents: number;
}

export interface DebtEdge {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}
