import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { activateExpense } from "./expense-rpc";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

describe("activateExpense", () => {
  it("returns error when not authenticated", async () => {
    const result = await activateExpense({ expense_id: "exp-1" });

    expect(result).toEqual({
      error: "Não autenticado",
      code: "not_authenticated",
    });
  });

  it("calls the RPC and returns result on success", async () => {
    mock.setUser({ id: "user-alice" });

    // RPC returns void (no data, no error)
    mock.onRpc("activate_expense", { data: null, error: null });

    // After RPC, wrapper fetches expense to get group_id
    mock.onTable("expenses", {
      data: { group_id: "group-1" },
    });

    // Then fetches balances for the group
    mock.onTable("balances", {
      data: [
        {
          group_id: "group-1",
          user_a: "user-alice",
          user_b: "user-bob",
          amount_cents: -3000,
        },
      ],
    });

    const result = await activateExpense({ expense_id: "exp-1" });

    expect(result).toEqual({
      expenseId: "exp-1",
      status: "active",
      updatedBalances: [
        {
          groupId: "group-1",
          userA: "user-alice",
          userB: "user-bob",
          newAmountCents: -3000,
          deltaCents: 0,
        },
      ],
    });

    // Verify RPC was called with correct args
    const rpcCalls = mock.findCalls("rpc:activate_expense", "rpc");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args).toEqual([
      "activate_expense",
      { p_expense_id: "exp-1" },
    ]);
  });

  it("returns typed error when RPC fails with permission_denied", async () => {
    mock.setUser({ id: "user-bob" });

    mock.onRpc("activate_expense", {
      error: { message: "permission_denied: only the creator can activate" },
    });

    const result = await activateExpense({ expense_id: "exp-1" });

    expect(result).toEqual({
      error: "only the creator can activate",
      code: "permission_denied",
    });
  });

  it("returns typed error when RPC fails with invalid_status", async () => {
    mock.setUser({ id: "user-alice" });

    mock.onRpc("activate_expense", {
      error: { message: "invalid_status: expense is active, expected draft" },
    });

    const result = await activateExpense({ expense_id: "exp-1" });

    expect(result).toEqual({
      error: "expense is active, expected draft",
      code: "invalid_status",
    });
  });

  it("returns typed error when RPC fails with shares_mismatch", async () => {
    mock.setUser({ id: "user-alice" });

    mock.onRpc("activate_expense", {
      error: { message: "shares_mismatch: shares sum to 6000, expected 10000" },
    });

    const result = await activateExpense({ expense_id: "exp-1" });

    expect(result).toEqual({
      error: "shares sum to 6000, expected 10000",
      code: "shares_mismatch",
    });
  });

  it("returns result with empty balances when expense fetch fails", async () => {
    mock.setUser({ id: "user-alice" });

    mock.onRpc("activate_expense", { data: null, error: null });

    // Expense fetch fails
    mock.onTable("expenses", {
      data: null,
      error: { message: "not found" },
    });

    const result = await activateExpense({ expense_id: "exp-1" });

    expect(result).toEqual({
      expenseId: "exp-1",
      status: "active",
      updatedBalances: [],
    });
  });

  it("returns result with empty balances when balances fetch returns null", async () => {
    mock.setUser({ id: "user-alice" });

    mock.onRpc("activate_expense", { data: null, error: null });
    mock.onTable("expenses", { data: { group_id: "group-1" } });
    mock.onTable("balances", { data: null });

    const result = await activateExpense({ expense_id: "exp-1" });

    expect(result).toEqual({
      expenseId: "exp-1",
      status: "active",
      updatedBalances: [],
    });
  });
});
