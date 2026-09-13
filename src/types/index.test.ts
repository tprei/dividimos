import { describe, expect, it } from "vitest";
import type {
  Expense,
  ExpenseItem,
  ExpenseShare,
  ExpensePayer,
  DebtEdge,
  ExpenseType,
  PixKeyType,
  SplitType,
  NotificationCategory,
  NotificationPreferences,
  User,
  UserProfile,
} from "./index";

describe("Expense types", () => {
  it("ExpenseType covers both types", () => {
    const types: ExpenseType[] = ["itemized", "single_amount"];
    expect(types).toHaveLength(2);
  });

  it("Expense interface matches database schema shape", () => {
    const expense: Expense = {
      id: "uuid-1",
      groupId: "group-1",
      creatorId: "user-1",
      title: "Jantar",
      expenseType: "itemized",
      totalAmount: 10000,
      serviceFeePercent: 10,
      serviceFeeBasisPoints: 1000,
      fixedFees: 0,
      createdAt: "2026-03-28T00:00:00Z",
      updatedAt: "2026-03-28T00:00:00Z",
    };
    expect(expense.id).toBe("uuid-1");
    expect(expense.groupId).toBe("group-1");
    expect(expense.merchantName).toBeUndefined();
  });

  it("ExpenseItem interface matches database schema shape", () => {
    const item: ExpenseItem = {
      id: "item-1",
      expenseId: "uuid-1",
      description: "Pizza",
      quantity: 2000,
      unitPriceCents: 2500,
      totalPriceCents: 5000,
      createdAt: "2026-03-28T00:00:00Z",
    };
    expect(item.totalPriceCents).toBe(5000);
  });

  it("ExpenseShare interface matches database schema shape", () => {
    const share: ExpenseShare = {
      id: "share-1",
      expenseId: "uuid-1",
      userId: "user-1",
      shareAmountCents: 5000,
    };
    expect(share.shareAmountCents).toBe(5000);
  });

  it("ExpensePayer interface matches database schema shape", () => {
    const payer: ExpensePayer = {
      expenseId: "uuid-1",
      userId: "user-1",
      amountCents: 10000,
    };
    expect(payer.amountCents).toBe(10000);
  });

  it("DebtEdge interface represents directed debt", () => {
    const edge: DebtEdge = {
      fromUserId: "user-1",
      toUserId: "user-2",
      amountCents: 2500,
    };
    expect(edge.fromUserId).toBe("user-1");
    expect(edge.toUserId).toBe("user-2");
    expect(edge.amountCents).toBe(2500);
  });
});

describe("User types", () => {
  it("User interface matches user profile with auth data", () => {
    const user: User = {
      id: "user-1",
      email: "user@example.com",
      handle: "usuario",
      name: "Usuario Teste",
      avatarUrl: "https://example.com/avatar.png",
      pixKeyType: "cpf",
      pixKeyHint: "123.***.***-00",
      notificationPreferences: { expenses: true, settlements: false },
      onboarded: true,
      createdAt: "2026-03-28T00:00:00Z",
    };
    expect(user.id).toBe("user-1");
    expect(user.pixKeyType).toBe("cpf");
  });

  it("UserProfile interface has minimal public profile data", () => {
    const profile: UserProfile = {
      id: "user-1",
      handle: "usuario",
      name: "Usuario Teste",
      avatarUrl: null,
    };
    expect(profile.id).toBe("user-1");
  });
});

describe("Utility types", () => {
  it("PixKeyType covers all supported formats", () => {
    const types: PixKeyType[] = ["cpf", "email", "phone", "random"];
    expect(types).toHaveLength(4);
  });

  it("SplitType covers all split methods", () => {
    const types: SplitType[] = ["equal", "percentage", "fixed"];
    expect(types).toHaveLength(3);
  });

  it("NotificationCategory covers all categories", () => {
    const categories: NotificationCategory[] = [
      "expenses",
      "settlements",
      "nudges",
      "groups",
      "messages",
    ];
    expect(categories).toHaveLength(5);
  });

  it("NotificationPreferences allows partial overrides", () => {
    const prefs: NotificationPreferences = {
      expenses: false,
      nudges: true,
    };
    expect(prefs.expenses).toBe(false);
    expect(prefs.settlements).toBeUndefined();
  });
});
