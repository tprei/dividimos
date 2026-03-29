import { describe, it, expect } from "vitest";
import {
  expenseRowToExpense,
  expenseItemRowToExpenseItem,
  expenseShareRowToExpenseShare,
  expensePayerRowToExpensePayer,
  balanceRowToBalance,
  settlementRowToSettlement,
  userProfileRowToUserProfile,
  expenseGuestRowToExpenseGuest,
  expenseGuestShareRowToExpenseGuestShare,
} from "./expense-mappers";

describe("expenseRowToExpense", () => {
  it("maps all fields correctly", () => {
    const row = {
      id: "e-1",
      group_id: "g-1",
      creator_id: "u-1",
      title: "Jantar",
      merchant_name: "Restaurante",
      expense_type: "itemized" as const,
      total_amount: 10000,
      service_fee_percent: 10,
      fixed_fees: 200,
      status: "active" as const,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-02T00:00:00Z",
    };

    const result = expenseRowToExpense(row);

    expect(result).toEqual({
      id: "e-1",
      groupId: "g-1",
      creatorId: "u-1",
      title: "Jantar",
      merchantName: "Restaurante",
      expenseType: "itemized",
      totalAmount: 10000,
      serviceFeePercent: 10,
      fixedFees: 200,
      status: "active",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("converts null merchant_name to undefined", () => {
    const row = {
      id: "e-1",
      group_id: "g-1",
      creator_id: "u-1",
      title: "Jantar",
      merchant_name: null,
      expense_type: "single_amount" as const,
      total_amount: 5000,
      service_fee_percent: 0,
      fixed_fees: 0,
      status: "draft" as const,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };

    expect(expenseRowToExpense(row).merchantName).toBeUndefined();
  });
});

describe("expenseItemRowToExpenseItem", () => {
  it("maps all fields", () => {
    const result = expenseItemRowToExpenseItem({
      id: "i-1",
      expense_id: "e-1",
      description: "Pizza",
      quantity: 2,
      unit_price_cents: 2500,
      total_price_cents: 5000,
      created_at: "2024-01-01T00:00:00Z",
    });

    expect(result).toEqual({
      id: "i-1",
      expenseId: "e-1",
      description: "Pizza",
      quantity: 2,
      unitPriceCents: 2500,
      totalPriceCents: 5000,
      createdAt: "2024-01-01T00:00:00Z",
    });
  });
});

describe("expenseShareRowToExpenseShare", () => {
  it("maps all fields", () => {
    const result = expenseShareRowToExpenseShare({
      id: "s-1",
      expense_id: "e-1",
      user_id: "u-1",
      share_amount_cents: 3333,
    });

    expect(result).toEqual({
      id: "s-1",
      expenseId: "e-1",
      userId: "u-1",
      shareAmountCents: 3333,
    });
  });
});

describe("expensePayerRowToExpensePayer", () => {
  it("maps all fields", () => {
    const result = expensePayerRowToExpensePayer({
      expense_id: "e-1",
      user_id: "u-1",
      amount_cents: 10000,
    });

    expect(result).toEqual({
      expenseId: "e-1",
      userId: "u-1",
      amountCents: 10000,
    });
  });
});

describe("balanceRowToBalance", () => {
  it("maps all fields", () => {
    const result = balanceRowToBalance({
      group_id: "g-1",
      user_a: "u-1",
      user_b: "u-2",
      amount_cents: 5000,
      updated_at: "2024-01-01T00:00:00Z",
    });

    expect(result).toEqual({
      groupId: "g-1",
      userA: "u-1",
      userB: "u-2",
      amountCents: 5000,
      updatedAt: "2024-01-01T00:00:00Z",
    });
  });
});

describe("settlementRowToSettlement", () => {
  it("maps all fields with confirmedAt", () => {
    const result = settlementRowToSettlement({
      id: "st-1",
      group_id: "g-1",
      from_user_id: "u-1",
      to_user_id: "u-2",
      amount_cents: 3000,
      status: "confirmed",
      created_at: "2024-01-01T00:00:00Z",
      confirmed_at: "2024-01-02T00:00:00Z",
    });

    expect(result).toEqual({
      id: "st-1",
      groupId: "g-1",
      fromUserId: "u-1",
      toUserId: "u-2",
      amountCents: 3000,
      status: "confirmed",
      createdAt: "2024-01-01T00:00:00Z",
      confirmedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("converts null confirmed_at to undefined", () => {
    const result = settlementRowToSettlement({
      id: "st-1",
      group_id: "g-1",
      from_user_id: "u-1",
      to_user_id: "u-2",
      amount_cents: 3000,
      status: "pending",
      created_at: "2024-01-01T00:00:00Z",
      confirmed_at: null,
    });

    expect(result.confirmedAt).toBeUndefined();
  });
});

describe("userProfileRowToUserProfile", () => {
  it("maps all fields", () => {
    const result = userProfileRowToUserProfile({
      id: "u-1",
      handle: "alice",
      name: "Alice Silva",
      avatar_url: "https://example.com/avatar.jpg",
    });

    expect(result).toEqual({
      id: "u-1",
      handle: "alice",
      name: "Alice Silva",
      avatarUrl: "https://example.com/avatar.jpg",
    });
  });

  it("converts null avatar_url to undefined", () => {
    const result = userProfileRowToUserProfile({
      id: "u-1",
      handle: "alice",
      name: "Alice Silva",
      avatar_url: null,
    });

    expect(result.avatarUrl).toBeUndefined();
  });
});

describe("expenseGuestRowToExpenseGuest", () => {
  it("maps all fields from an unclaimed guest row", () => {
    const result = expenseGuestRowToExpenseGuest({
      id: "guest-1",
      expense_id: "exp-1",
      display_name: "João",
      claim_token: "token-abc",
      claimed_by: null,
      claimed_at: null,
      created_at: "2026-03-29T00:00:00Z",
    });

    expect(result).toEqual({
      id: "guest-1",
      expenseId: "exp-1",
      displayName: "João",
      claimToken: "token-abc",
      claimedBy: undefined,
      claimedAt: undefined,
      createdAt: "2026-03-29T00:00:00Z",
    });
  });

  it("maps claimed fields when present", () => {
    const result = expenseGuestRowToExpenseGuest({
      id: "guest-2",
      expense_id: "exp-1",
      display_name: "Maria",
      claim_token: "token-def",
      claimed_by: "user-123",
      claimed_at: "2026-03-29T12:00:00Z",
      created_at: "2026-03-29T00:00:00Z",
    });

    expect(result.claimedBy).toBe("user-123");
    expect(result.claimedAt).toBe("2026-03-29T12:00:00Z");
  });
});

describe("expenseGuestShareRowToExpenseGuestShare", () => {
  it("maps all fields", () => {
    const result = expenseGuestShareRowToExpenseGuestShare({
      id: "share-1",
      expense_id: "exp-1",
      guest_id: "guest-1",
      share_amount_cents: 2500,
    });

    expect(result).toEqual({
      id: "share-1",
      expenseId: "exp-1",
      guestId: "guest-1",
      shareAmountCents: 2500,
    });
  });
});
