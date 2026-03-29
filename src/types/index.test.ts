import { describe, it, expect } from "vitest";
import type {
  Expense,
  ExpenseItem,
  ExpenseShare,
  ExpensePayer,
  Balance,
  Settlement,
  ExpenseWithDetails,
  ExpenseParticipantSummary,
  DebtEdge,
  GroupBalanceSummary,
  ExpenseStatus,
  ExpenseType,
  SettlementStatus,
  ActivateExpenseRequest,
  ActivateExpenseResult,
  ActivateExpenseBalanceUpdate,
  RecordSettlementRequest,
  RecordSettlementResult,
  ExpenseGuest,
  GuestStatus,
  UserParticipant,
  GuestParticipant,
  Participant,
  // Legacy aliases
  Bill,
  BillType,
  BillStatus,
  BillPayer,
  BillItem,
} from "./index";
import {
  isUserParticipant,
  isGuestParticipant,
  getParticipantId,
  getParticipantLabel,
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
    };
    expect(detailed.items).toHaveLength(1);
    expect(detailed.shares).toHaveLength(1);
    expect(detailed.payers).toHaveLength(1);
    expect(detailed.shares[0].user.handle).toBe("bob");
  });

  it("ExpenseParticipantSummary computes net correctly", () => {
    const summary: ExpenseParticipantSummary = {
      userId: "user-1",
      user: { id: "user-1", handle: "alice", name: "Alice" },
      shareAmountCents: 5000,
      paidAmountCents: 10000,
      netCents: 5000, // paid 100, owes 50 → is owed 50
    };
    expect(summary.netCents).toBe(summary.paidAmountCents - summary.shareAmountCents);
  });

  it("DebtEdge represents a directed debt", () => {
    const edge: DebtEdge = {
      fromUserId: "user-1",
      toUserId: "user-2",
      amountCents: 3000,
    };
    expect(edge.amountCents).toBeGreaterThan(0);
  });

  it("GroupBalanceSummary aggregates debts", () => {
    const summary: GroupBalanceSummary = {
      groupId: "group-1",
      debts: [
        { fromUserId: "user-1", toUserId: "user-2", amountCents: 3000 },
        { fromUserId: "user-3", toUserId: "user-2", amountCents: 2000 },
      ],
      totalDebtCents: 5000,
    };
    expect(summary.debts).toHaveLength(2);
    expect(summary.totalDebtCents).toBe(
      summary.debts.reduce((sum, d) => sum + d.amountCents, 0)
    );
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

  it("RecordSettlementRequest has all required fields", () => {
    const req: RecordSettlementRequest = {
      group_id: "group-1",
      from_user_id: "user-debtor",
      to_user_id: "user-creditor",
      amount_cents: 5000,
    };
    expect(req.group_id).toBe("group-1");
    expect(req.from_user_id).toBe("user-debtor");
    expect(req.to_user_id).toBe("user-creditor");
    expect(req.amount_cents).toBe(5000);
    expect(req.amount_cents).toBeGreaterThan(0);
  });

  it("RecordSettlementResult contains settlement and updated balance", () => {
    const result: RecordSettlementResult = {
      settlement: {
        id: "settlement-1",
        groupId: "group-1",
        fromUserId: "user-debtor",
        toUserId: "user-creditor",
        amountCents: 5000,
        status: "pending",
        createdAt: "2026-03-28T00:00:00Z",
      },
      updatedBalance: {
        groupId: "group-1",
        userA: "user-creditor",
        userB: "user-debtor",
        newAmountCents: -2000,
      },
    };
    expect(result.settlement.status).toBe("pending");
    expect(result.settlement.amountCents).toBe(5000);
    expect(result.updatedBalance.newAmountCents).toBe(-2000);
  });

  it("RecordSettlementResult settlement can be confirmed", () => {
    const result: RecordSettlementResult = {
      settlement: {
        id: "settlement-1",
        groupId: "group-1",
        fromUserId: "user-1",
        toUserId: "user-2",
        amountCents: 10000,
        status: "confirmed",
        createdAt: "2026-03-28T00:00:00Z",
        confirmedAt: "2026-03-28T01:00:00Z",
      },
      updatedBalance: {
        groupId: "group-1",
        userA: "user-1",
        userB: "user-2",
        newAmountCents: 0,
      },
    };
    expect(result.settlement.status).toBe("confirmed");
    expect(result.settlement.confirmedAt).toBeDefined();
    // Balance of 0 = fully settled
    expect(result.updatedBalance.newAmountCents).toBe(0);
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

  it("BillPayer still works for gradual migration", () => {
    const payer: BillPayer = { userId: "user-1", amountCents: 5000 };
    expect(payer.amountCents).toBe(5000);
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

describe("Guest participant types", () => {
  it("GuestStatus covers all valid statuses", () => {
    const statuses: GuestStatus[] = ["pending", "claimed"];
    expect(statuses).toHaveLength(2);
  });

  it("ExpenseGuest interface matches database schema shape", () => {
    const guest: ExpenseGuest = {
      id: "guest-1",
      expenseId: "uuid-1",
      guestLabel: "João",
      claimToken: "abc123def456",
      status: "pending",
      createdAt: "2026-03-29T00:00:00Z",
    };
    expect(guest.id).toBe("guest-1");
    expect(guest.status).toBe("pending");
    expect(guest.claimedByUserId).toBeUndefined();
    expect(guest.claimedAt).toBeUndefined();
  });

  it("ExpenseGuest can be claimed", () => {
    const guest: ExpenseGuest = {
      id: "guest-1",
      expenseId: "uuid-1",
      guestLabel: "João",
      claimToken: "abc123def456",
      status: "claimed",
      claimedByUserId: "user-99",
      createdAt: "2026-03-29T00:00:00Z",
      claimedAt: "2026-03-29T01:00:00Z",
    };
    expect(guest.status).toBe("claimed");
    expect(guest.claimedByUserId).toBe("user-99");
    expect(guest.claimedAt).toBeDefined();
  });

  it("UserParticipant has kind discriminator", () => {
    const p: UserParticipant = {
      kind: "user",
      id: "user-1",
      user: { id: "user-1", handle: "alice", name: "Alice" },
    };
    expect(p.kind).toBe("user");
    expect(p.user.handle).toBe("alice");
  });

  it("GuestParticipant has kind discriminator and tempId", () => {
    const p: GuestParticipant = {
      kind: "guest",
      tempId: "temp-1",
      guestLabel: "Convidado 1",
    };
    expect(p.kind).toBe("guest");
    expect(p.guestId).toBeUndefined();
  });

  it("GuestParticipant can have a persisted guestId", () => {
    const p: GuestParticipant = {
      kind: "guest",
      tempId: "temp-1",
      guestLabel: "Convidado 1",
      guestId: "guest-db-1",
    };
    expect(p.guestId).toBe("guest-db-1");
  });

  it("Participant union accepts both user and guest", () => {
    const participants: Participant[] = [
      {
        kind: "user",
        id: "user-1",
        user: { id: "user-1", handle: "alice", name: "Alice" },
      },
      {
        kind: "guest",
        tempId: "temp-1",
        guestLabel: "Convidado 1",
      },
    ];
    expect(participants).toHaveLength(2);
    expect(participants[0].kind).toBe("user");
    expect(participants[1].kind).toBe("guest");
  });
});

describe("Participant type guards", () => {
  const userP: Participant = {
    kind: "user",
    id: "user-1",
    user: { id: "user-1", handle: "alice", name: "Alice" },
  };
  const guestP: Participant = {
    kind: "guest",
    tempId: "temp-1",
    guestLabel: "Convidado 1",
  };

  it("isUserParticipant returns true for user participants", () => {
    expect(isUserParticipant(userP)).toBe(true);
    expect(isUserParticipant(guestP)).toBe(false);
  });

  it("isGuestParticipant returns true for guest participants", () => {
    expect(isGuestParticipant(guestP)).toBe(true);
    expect(isGuestParticipant(userP)).toBe(false);
  });

  it("type guards enable narrowing in conditionals", () => {
    if (isUserParticipant(userP)) {
      // TypeScript narrows to UserParticipant
      expect(userP.user.handle).toBe("alice");
    }
    if (isGuestParticipant(guestP)) {
      // TypeScript narrows to GuestParticipant
      expect(guestP.guestLabel).toBe("Convidado 1");
    }
  });
});

describe("Participant utility functions", () => {
  it("getParticipantId returns user id for UserParticipant", () => {
    const p: Participant = {
      kind: "user",
      id: "user-1",
      user: { id: "user-1", handle: "alice", name: "Alice" },
    };
    expect(getParticipantId(p)).toBe("user-1");
  });

  it("getParticipantId returns guestId when available for GuestParticipant", () => {
    const p: Participant = {
      kind: "guest",
      tempId: "temp-1",
      guestLabel: "João",
      guestId: "guest-db-1",
    };
    expect(getParticipantId(p)).toBe("guest-db-1");
  });

  it("getParticipantId falls back to tempId for unsaved GuestParticipant", () => {
    const p: Participant = {
      kind: "guest",
      tempId: "temp-1",
      guestLabel: "João",
    };
    expect(getParticipantId(p)).toBe("temp-1");
  });

  it("getParticipantLabel returns user name for UserParticipant", () => {
    const p: Participant = {
      kind: "user",
      id: "user-1",
      user: { id: "user-1", handle: "alice", name: "Alice" },
    };
    expect(getParticipantLabel(p)).toBe("Alice");
  });

  it("getParticipantLabel returns guest label for GuestParticipant", () => {
    const p: Participant = {
      kind: "guest",
      tempId: "temp-1",
      guestLabel: "Convidado 1",
    };
    expect(getParticipantLabel(p)).toBe("Convidado 1");
  });
});
