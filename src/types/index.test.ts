import { describe, it, expect } from "vitest";
import type {
  Expense,
  ExpenseItem,
  ExpenseShare,
  ExpensePayer,
  Balance,
  Settlement,
  ExpenseWithDetails,
  DebtEdge,
  ExpenseStatus,
  ExpenseType,
  SettlementStatus,
  ActivateExpenseRequest,
  ActivateExpenseResult,
  ActivateExpenseBalanceUpdate,
  // Legacy aliases
  Bill,
  BillType,
  BillStatus,
  BillItem,
} from "./index";

describe("Expense types", () => {
  it("ExpenseStatus covers all valid statuses", () => {
    const statuses: ExpenseStatus[] = ["draft", "active", "settled"];
    expect(statuses).toHaveLength(3);
  });

  it("ExpenseType covers both types", () => {
    const types: ExpenseType[] = ["itemized", "single_amount"];
    expect(types).toHaveLength(2);
  });

  it("SettlementStatus covers both statuses", () => {
    const statuses: SettlementStatus[] = ["pending", "confirmed"];
    expect(statuses).toHaveLength(2);
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
      fixedFees: 0,
      status: "draft",
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
      quantity: 2,
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

  it("Balance interface enforces canonical user ordering concept", () => {
    const balance: Balance = {
      groupId: "group-1",
      userA: "aaa-user",
      userB: "bbb-user",
      amountCents: 5000,
      updatedAt: "2026-03-28T00:00:00Z",
    };
    // Convention: userA < userB, positive = A owes B
    expect(balance.userA < balance.userB).toBe(true);
    expect(balance.amountCents).toBe(5000);
  });

  it("Settlement interface matches database schema shape", () => {
    const settlement: Settlement = {
      id: "settlement-1",
      groupId: "group-1",
      fromUserId: "user-1",
      toUserId: "user-2",
      amountCents: 5000,
      status: "pending",
      createdAt: "2026-03-28T00:00:00Z",
    };
    expect(settlement.confirmedAt).toBeUndefined();
    expect(settlement.status).toBe("pending");
  });

  it("ExpenseWithDetails extends Expense with nested data", () => {
    const detailed: ExpenseWithDetails = {
      id: "uuid-1",
      groupId: "group-1",
      creatorId: "user-1",
      title: "Jantar",
      expenseType: "itemized",
      totalAmount: 10000,
      serviceFeePercent: 0,
      fixedFees: 0,
      status: "active",
      createdAt: "2026-03-28T00:00:00Z",
      updatedAt: "2026-03-28T00:00:00Z",
      items: [
        {
          id: "item-1",
          expenseId: "uuid-1",
          description: "Pizza",
          quantity: 1,
          unitPriceCents: 5000,
          totalPriceCents: 5000,
          createdAt: "2026-03-28T00:00:00Z",
        },
      ],
      shares: [
        {
          id: "share-1",
          expenseId: "uuid-1",
          userId: "user-2",
          shareAmountCents: 5000,
          user: { id: "user-2", handle: "bob", name: "Bob", avatarUrl: undefined },
        },
      ],
      payers: [
        {
          expenseId: "uuid-1",
          userId: "user-1",
          amountCents: 10000,
          user: {
            id: "user-1",
            handle: "alice",
            name: "Alice",
            avatarUrl: undefined,
          },
        },
      ],
      guests: [],
    };
    expect(detailed.items).toHaveLength(1);
    expect(detailed.shares).toHaveLength(1);
    expect(detailed.payers).toHaveLength(1);
    expect(detailed.guests).toHaveLength(0);
    expect(detailed.shares[0].user.handle).toBe("bob");
  });

  it("DebtEdge represents a directed debt", () => {
    const edge: DebtEdge = {
      fromUserId: "user-1",
      toUserId: "user-2",
      amountCents: 3000,
    };
    expect(edge.amountCents).toBeGreaterThan(0);
  });

});

describe("RPC request/result types", () => {
  it("ActivateExpenseRequest has expense_id", () => {
    const req: ActivateExpenseRequest = {
      expense_id: "uuid-1",
    };
    expect(req.expense_id).toBe("uuid-1");
  });

  it("ActivateExpenseResult has expected shape", () => {
    const result: ActivateExpenseResult = {
      expenseId: "uuid-1",
      status: "active",
      updatedBalances: [
        {
          groupId: "group-1",
          userA: "aaa-user",
          userB: "bbb-user",
          newAmountCents: 5000,
          deltaCents: 5000,
        },
      ],
    };
    expect(result.status).toBe("active");
    expect(result.updatedBalances).toHaveLength(1);
    expect(result.updatedBalances[0].deltaCents).toBe(5000);
  });

  it("ActivateExpenseBalanceUpdate tracks delta and new amount", () => {
    const update: ActivateExpenseBalanceUpdate = {
      groupId: "group-1",
      userA: "aaa-user",
      userB: "bbb-user",
      newAmountCents: 3000,
      deltaCents: -2000,
    };
    // Negative delta means A's debt to B decreased (A was a payer)
    expect(update.deltaCents).toBeLessThan(0);
    expect(update.newAmountCents).toBe(3000);
  });

  it("ActivateExpenseResult with multiple balance updates", () => {
    // Expense with 3 participants creates up to 3 balance pairs
    const result: ActivateExpenseResult = {
      expenseId: "uuid-1",
      status: "active",
      updatedBalances: [
        {
          groupId: "group-1",
          userA: "aaa",
          userB: "bbb",
          newAmountCents: 3000,
          deltaCents: 3000,
        },
        {
          groupId: "group-1",
          userA: "aaa",
          userB: "ccc",
          newAmountCents: 2000,
          deltaCents: 2000,
        },
        {
          groupId: "group-1",
          userA: "bbb",
          userB: "ccc",
          newAmountCents: -1000,
          deltaCents: -1000,
        },
      ],
    };
    expect(result.updatedBalances).toHaveLength(3);
    // All balances should reference the same group
    expect(
      result.updatedBalances.every((b) => b.groupId === "group-1")
    ).toBe(true);
  });

});

describe("Legacy type aliases", () => {
  it("BillType is an alias for ExpenseType", () => {
    const t: BillType = "itemized";
    const e: ExpenseType = t;
    expect(e).toBe("itemized");
  });

  it("BillStatus is an alias for ExpenseStatus", () => {
    const s: BillStatus = "active";
    const e: ExpenseStatus = s;
    expect(e).toBe("active");
  });

  it("Bill interface still works for gradual migration", () => {
    const bill: Bill = {
      id: "bill-1",
      creatorId: "user-1",
      billType: "single_amount",
      title: "Test",
      status: "draft",
      serviceFeePercent: 0,
      fixedFees: 0,
      totalAmount: 10000,
      totalAmountInput: 10000,
      payers: [{ userId: "user-1", amountCents: 10000 }],
      createdAt: "2026-03-28T00:00:00Z",
      updatedAt: "2026-03-28T00:00:00Z",
    };
    expect(bill.payers).toHaveLength(1);
  });

  it("BillItem still works for gradual migration", () => {
    const item: BillItem = {
      id: "item-1",
      billId: "bill-1",
      description: "Test",
      quantity: 1,
      unitPriceCents: 1000,
      totalPriceCents: 1000,
      createdAt: "2026-03-28T00:00:00Z",
    };
    expect(item.totalPriceCents).toBe(1000);
  });
});
