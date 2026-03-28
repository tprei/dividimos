import { describe, it, expect } from "vitest";
import { expenseShareRowToExpenseShare } from "./mappers";

describe("expenseShareRowToExpenseShare", () => {
  it("maps a Supabase row to an ExpenseShare object", () => {
    const row = {
      bill_id: "bill-1",
      user_id: "user-1",
      paid_cents: 5000,
      owed_cents: 2500,
      net_cents: 2500,
      created_at: "2026-03-28T12:00:00Z",
    };

    const result = expenseShareRowToExpenseShare(row);

    expect(result).toEqual({
      billId: "bill-1",
      userId: "user-1",
      paidCents: 5000,
      owedCents: 2500,
      netCents: 2500,
      createdAt: "2026-03-28T12:00:00Z",
    });
  });

  it("maps a debtor row (negative net)", () => {
    const row = {
      bill_id: "bill-2",
      user_id: "user-2",
      paid_cents: 0,
      owed_cents: 3000,
      net_cents: -3000,
      created_at: "2026-03-28T13:00:00Z",
    };

    const result = expenseShareRowToExpenseShare(row);

    expect(result.netCents).toBe(-3000);
    expect(result.paidCents).toBe(0);
    expect(result.owedCents).toBe(3000);
  });

  it("maps a payment share (payer side)", () => {
    const row = {
      bill_id: "bill-pay-1",
      user_id: "user-a",
      paid_cents: 10000,
      owed_cents: 0,
      net_cents: 10000,
      created_at: "2026-03-28T14:00:00Z",
    };

    const result = expenseShareRowToExpenseShare(row);

    expect(result.paidCents).toBe(10000);
    expect(result.owedCents).toBe(0);
    expect(result.netCents).toBe(10000);
  });
});
