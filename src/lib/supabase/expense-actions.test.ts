import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import {
  saveExpenseDraft,
  loadExpense,
  deleteExpense,
  listGroupExpenses,
} from "./expense-actions";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

// ============================================================
// saveExpenseDraft
// ============================================================

describe("saveExpenseDraft", () => {
  const baseDraftParams = {
    groupId: "group-1",
    creatorId: "user-alice",
    title: "Jantar",
    expenseType: "itemized" as const,
    totalAmount: 10000,
    serviceFeePercent: 10,
    fixedFees: 0,
  };

  it("creates a new draft expense", async () => {
    // expenses.insert
    mock.onTable("expenses", { data: { id: "expense-1" } });
    // expense_items.delete, expense_shares.delete, expense_payers.delete (parallel)
    mock.onTable("expense_items", { error: null });
    mock.onTable("expense_shares", { error: null });
    mock.onTable("expense_payers", { error: null });

    const result = await saveExpenseDraft(baseDraftParams);

    expect(result).toEqual({ expenseId: "expense-1" });

    const inserts = mock.findCalls("expenses", "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toMatchObject({
      status: "draft",
      title: "Jantar",
      group_id: "group-1",
    });
  });

  it("updates an existing draft expense", async () => {
    // expenses.update
    mock.onTable("expenses", { error: null });
    // child data deletes
    mock.onTable("expense_items", { error: null });
    mock.onTable("expense_shares", { error: null });
    mock.onTable("expense_payers", { error: null });

    const result = await saveExpenseDraft({
      ...baseDraftParams,
      existingExpenseId: "expense-existing",
    });

    expect(result).toEqual({ expenseId: "expense-existing" });
    expect(mock.findCalls("expenses", "update")).toHaveLength(1);
    expect(mock.findCalls("expenses", "insert")).toHaveLength(0);
  });

  it("persists child data (items, shares, payers)", async () => {
    mock.onTable("expenses", { data: { id: "expense-1" } });
    // deletes
    mock.onTable("expense_items", { error: null });
    mock.onTable("expense_shares", { error: null });
    mock.onTable("expense_payers", { error: null });
    // inserts
    mock.onTable("expense_items", { error: null });
    mock.onTable("expense_shares", { error: null });
    mock.onTable("expense_payers", { error: null });

    await saveExpenseDraft({
      ...baseDraftParams,
      items: [
        { description: "Pizza", quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000 },
      ],
      shares: [
        { userId: "user-alice", shareAmountCents: 5000 },
        { userId: "user-bob", shareAmountCents: 5000 },
      ],
      payers: [{ userId: "user-alice", amountCents: 10000 }],
    });

    expect(mock.findCalls("expense_items", "insert")).toHaveLength(1);
    expect(mock.findCalls("expense_shares", "insert")).toHaveLength(1);
    expect(mock.findCalls("expense_payers", "insert")).toHaveLength(1);
  });

  it("returns error when expense insert fails", async () => {
    mock.onTable("expenses", {
      data: null,
      error: { message: "Insert failed" },
    });

    const result = await saveExpenseDraft(baseDraftParams);

    expect(result).toEqual({ error: "Insert failed" });
  });

  it("returns error when expense update fails", async () => {
    mock.onTable("expenses", { error: { message: "Update failed" } });

    const result = await saveExpenseDraft({
      ...baseDraftParams,
      existingExpenseId: "expense-1",
    });

    expect(result).toEqual({ error: "Update failed" });
  });

  it("returns error when child data insert fails", async () => {
    mock.onTable("expenses", { data: { id: "expense-1" } });
    // deletes succeed
    mock.onTable("expense_items", { error: null });
    mock.onTable("expense_shares", { error: null });
    mock.onTable("expense_payers", { error: null });
    // shares insert fails
    mock.onTable("expense_shares", { error: { message: "Share insert failed" } });

    const result = await saveExpenseDraft({
      ...baseDraftParams,
      shares: [{ userId: "user-alice", shareAmountCents: 10000 }],
    });

    expect(result).toEqual({ error: "Share insert failed" });
  });
});

// ============================================================
// loadExpense
// ============================================================

describe("loadExpense", () => {
  const mockExpenseRow = {
    id: "expense-1",
    group_id: "group-1",
    creator_id: "user-alice",
    title: "Jantar",
    merchant_name: "Restaurante",
    expense_type: "itemized",
    total_amount: 10000,
    service_fee_percent: 10,
    fixed_fees: 0,
    status: "active",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    expense_items: [
      {
        id: "item-1",
        expense_id: "expense-1",
        description: "Pizza",
        quantity: 1,
        unit_price_cents: 5000,
        total_price_cents: 5000,
        created_at: "2024-01-01T00:00:00Z",
      },
    ],
    expense_shares: [
      { id: "share-1", expense_id: "expense-1", user_id: "user-alice", share_amount_cents: 5000 },
      { id: "share-2", expense_id: "expense-1", user_id: "user-bob", share_amount_cents: 5000 },
    ],
    expense_payers: [
      { expense_id: "expense-1", user_id: "user-alice", amount_cents: 10000 },
    ],
  };

  it("loads an expense with all details and user profiles", async () => {
    mock.onTable("expenses", { data: mockExpenseRow });
    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice Silva", avatar_url: null },
        { id: "user-bob", handle: "bob", name: "Bob Santos", avatar_url: null },
      ],
    });

    const result = await loadExpense("expense-1");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("expense-1");
    expect(result!.title).toBe("Jantar");
    expect(result!.merchantName).toBe("Restaurante");
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0].description).toBe("Pizza");
    expect(result!.shares).toHaveLength(2);
    expect(result!.shares[0].user.handle).toBe("alice");
    expect(result!.payers).toHaveLength(1);
    expect(result!.payers[0].user.handle).toBe("alice");
  });

  it("returns null when expense not found", async () => {
    mock.onTable("expenses", { data: null });

    const result = await loadExpense("nonexistent");

    expect(result).toBeNull();
  });

  it("uses fallback profile for unknown users", async () => {
    mock.onTable("expenses", { data: mockExpenseRow });
    // Only return alice's profile, not bob's
    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice Silva", avatar_url: null },
      ],
    });

    const result = await loadExpense("expense-1");

    const bobShare = result!.shares.find((s) => s.userId === "user-bob");
    expect(bobShare!.user.name).toBe("Desconhecido");
  });
});

// ============================================================
// deleteExpense
// ============================================================

describe("deleteExpense", () => {
  it("deletes a draft expense", async () => {
    mock.onTable("expenses", { error: null });

    const result = await deleteExpense("expense-1");

    expect(result).toEqual({});
    const deleteCalls = mock.findCalls("expenses", "delete");
    expect(deleteCalls).toHaveLength(1);
  });

  it("returns error when delete fails", async () => {
    mock.onTable("expenses", { error: { message: "Delete failed" } });

    const result = await deleteExpense("expense-1");

    expect(result).toEqual({ error: "Delete failed" });
  });
});

// ============================================================
// listGroupExpenses
// ============================================================

describe("listGroupExpenses", () => {
  it("returns expenses with participant profiles", async () => {
    mock.onTable("expenses", {
      data: [
        {
          id: "expense-1",
          group_id: "group-1",
          creator_id: "user-alice",
          title: "Jantar",
          merchant_name: null,
          expense_type: "single_amount",
          total_amount: 9000,
          service_fee_percent: 0,
          fixed_fees: 0,
          status: "active",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    // shares user_ids
    mock.onTable("expense_shares", {
      data: [
        { user_id: "user-alice" },
        { user_id: "user-bob" },
        { user_id: "user-carlos" },
      ],
    });
    // payers user_ids
    mock.onTable("expense_payers", {
      data: [{ user_id: "user-alice" }],
    });
    // user profiles
    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice Silva", avatar_url: null },
        { id: "user-bob", handle: "bob", name: "Bob Santos", avatar_url: null },
        { id: "user-carlos", handle: "carlos", name: "Carlos Souza", avatar_url: null },
      ],
    });

    const result = await listGroupExpenses("group-1");

    expect(result.expenses).toHaveLength(1);
    expect(result.expenses[0].title).toBe("Jantar");
    expect(result.participants).toHaveLength(3);
  });

  it("returns empty results when no expenses exist", async () => {
    mock.onTable("expenses", { data: [] });

    const result = await listGroupExpenses("group-1");

    expect(result.expenses).toHaveLength(0);
    expect(result.participants).toHaveLength(0);
  });
});
