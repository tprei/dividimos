import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { loadSharesForBill, loadSharesForGroup, loadSharesForUser } from "./expense-share-actions";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

describe("loadSharesForBill", () => {
  it("loads and maps shares for a single bill", async () => {
    mock.onTable("expense_shares", {
      data: [
        { bill_id: "bill-1", user_id: "u1", paid_cents: 5000, owed_cents: 2500, net_cents: 2500, created_at: "2026-01-01T00:00:00Z" },
        { bill_id: "bill-1", user_id: "u2", paid_cents: 0, owed_cents: 2500, net_cents: -2500, created_at: "2026-01-01T00:00:00Z" },
      ],
      error: null,
    });

    const { shares, error } = await loadSharesForBill("bill-1");

    expect(error).toBeUndefined();
    expect(shares).toHaveLength(2);
    expect(shares[0]).toEqual({
      billId: "bill-1",
      userId: "u1",
      paidCents: 5000,
      owedCents: 2500,
      netCents: 2500,
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(shares[1].netCents).toBe(-2500);

    // Verify query uses eq("bill_id", ...)
    const selectCalls = mock.findCalls("expense_shares", "select");
    expect(selectCalls).toHaveLength(1);
    const eqCalls = mock.findCalls("expense_shares", "eq");
    expect(eqCalls[0].args[0]).toBe("bill_id");
    expect(eqCalls[0].args[1]).toBe("bill-1");
  });

  it("returns empty array and error message on failure", async () => {
    mock.onTable("expense_shares", { data: null, error: { message: "RLS denied" } });

    const { shares, error } = await loadSharesForBill("bill-1");

    expect(shares).toEqual([]);
    expect(error).toBe("RLS denied");
  });

  it("returns empty array when no shares exist", async () => {
    mock.onTable("expense_shares", { data: [], error: null });

    const { shares, error } = await loadSharesForBill("nonexistent");

    expect(error).toBeUndefined();
    expect(shares).toEqual([]);
  });
});

describe("loadSharesForGroup", () => {
  it("loads shares via inner join on bills.group_id", async () => {
    mock.onTable("expense_shares", {
      data: [
        { bill_id: "b1", user_id: "u1", paid_cents: 1000, owed_cents: 500, net_cents: 500, created_at: "2026-01-01T00:00:00Z" },
      ],
      error: null,
    });

    const { shares, error } = await loadSharesForGroup("group-1");

    expect(error).toBeUndefined();
    expect(shares).toHaveLength(1);
    expect(shares[0].billId).toBe("b1");

    // Verify it selects with the join and filters by group_id
    const selectCalls = mock.findCalls("expense_shares", "select");
    expect(selectCalls).toHaveLength(1);
    const eqCalls = mock.findCalls("expense_shares", "eq");
    expect(eqCalls[0].args).toEqual(["bills.group_id", "group-1"]);
  });

  it("returns error on query failure", async () => {
    mock.onTable("expense_shares", { data: null, error: { message: "fail" } });

    const { shares, error } = await loadSharesForGroup("group-1");

    expect(shares).toEqual([]);
    expect(error).toBe("fail");
  });
});

describe("loadSharesForUser", () => {
  it("loads all shares for a user across all bills", async () => {
    mock.onTable("expense_shares", {
      data: [
        { bill_id: "b1", user_id: "u1", paid_cents: 1000, owed_cents: 0, net_cents: 1000, created_at: "2026-01-01T00:00:00Z" },
        { bill_id: "b2", user_id: "u1", paid_cents: 0, owed_cents: 2000, net_cents: -2000, created_at: "2026-01-02T00:00:00Z" },
      ],
      error: null,
    });

    const { shares, error } = await loadSharesForUser("u1");

    expect(error).toBeUndefined();
    expect(shares).toHaveLength(2);

    const eqCalls = mock.findCalls("expense_shares", "eq");
    expect(eqCalls[0].args).toEqual(["user_id", "u1"]);
  });

  it("returns error on query failure", async () => {
    mock.onTable("expense_shares", { data: null, error: { message: "nope" } });

    const { shares, error } = await loadSharesForUser("u1");

    expect(shares).toEqual([]);
    expect(error).toBe("nope");
  });
});
