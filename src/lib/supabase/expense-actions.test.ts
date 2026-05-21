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

  it("creates a new draft expense via RPC", async () => {
    mock.onRpc("save_expense_draft", { data: { id: "expense-1" } });

    const result = await saveExpenseDraft(baseDraftParams);

    expect(result).toEqual({ expenseId: "expense-1" });

    const rpcCalls = mock.findCalls("rpc:save_expense_draft", "rpc");
    expect(rpcCalls).toHaveLength(1);
    const args = rpcCalls[0].args[1] as Record<string, unknown>;
    expect((args.p_expense as Record<string, unknown>).title).toBe("Jantar");
    expect((args.p_expense as Record<string, unknown>).group_id).toBe("group-1");
  });

  it("sends existing expense id in p_expense when updating", async () => {
    mock.onRpc("save_expense_draft", { data: { id: "expense-existing" } });

    const result = await saveExpenseDraft({
      ...baseDraftParams,
      existingExpenseId: "expense-existing",
    });

    expect(result).toEqual({ expenseId: "expense-existing" });

    const rpcCalls = mock.findCalls("rpc:save_expense_draft", "rpc");
    expect(rpcCalls).toHaveLength(1);
    const args = rpcCalls[0].args[1] as Record<string, unknown>;
    expect((args.p_expense as Record<string, unknown>).id).toBe("expense-existing");
  });

  it("maps items, shares, and payers into RPC payload", async () => {
    mock.onRpc("save_expense_draft", { data: { id: "expense-1" } });

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

    const args = mock.findCalls("rpc:save_expense_draft", "rpc")[0].args[1] as Record<string, unknown>;
    expect((args.p_items as unknown[]).length).toBe(1);
    expect((args.p_shares as unknown[]).length).toBe(2);
    expect((args.p_payers as unknown[]).length).toBe(1);
  });

  it("maps guests and guest shares into RPC payload", async () => {
    mock.onRpc("save_expense_draft", { data: { id: "expense-1" } });

    await saveExpenseDraft({
      ...baseDraftParams,
      guests: [
        { localId: "guest_local_1", displayName: "Maria" },
        { localId: "guest_local_2", displayName: "Joao" },
      ],
      guestShares: [
        { guestLocalId: "guest_local_1", shareAmountCents: 3000 },
        { guestLocalId: "guest_local_2", shareAmountCents: 2000 },
      ],
    });

    const args = mock.findCalls("rpc:save_expense_draft", "rpc")[0].args[1] as Record<string, unknown>;
    expect((args.p_guests as unknown[]).length).toBe(2);
    expect((args.p_guest_shares as unknown[]).length).toBe(2);
  });

  it("returns error when RPC fails", async () => {
    mock.onRpc("save_expense_draft", { data: null, error: { message: "RPC failed" } });

    const result = await saveExpenseDraft(baseDraftParams);

    expect(result).toEqual({ error: "RPC failed" });
  });

  it("returns error when RPC returns no id", async () => {
    mock.onRpc("save_expense_draft", { data: null });

    const result = await saveExpenseDraft(baseDraftParams);

    expect(result).toEqual({ error: "Erro ao salvar rascunho" });
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
    mock.onTable("expense_guests", { data: [] });
    mock.onTable("expense_guest_shares", { data: [] });
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
    expect(result!.guests).toHaveLength(0);
  });

  it("returns null when expense not found", async () => {
    mock.onTable("expenses", { data: null });
    mock.onTable("expense_guests", { data: [] });
    mock.onTable("expense_guest_shares", { data: [] });

    const result = await loadExpense("nonexistent");

    expect(result).toBeNull();
  });

  it("uses fallback profile for unknown users", async () => {
    mock.onTable("expenses", { data: mockExpenseRow });
    mock.onTable("expense_guests", { data: [] });
    mock.onTable("expense_guest_shares", { data: [] });
    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice Silva", avatar_url: null },
      ],
    });

    const result = await loadExpense("expense-1");

    const bobShare = result!.shares.find((s) => s.userId === "user-bob");
    expect(bobShare!.user.name).toBe("Desconhecido");
  });

  it("loads guests with their shares", async () => {
    mock.onTable("expenses", { data: mockExpenseRow });
    mock.onTable("expense_guests", {
      data: [
        {
          id: "guest-1",
          expense_id: "expense-1",
          display_name: "Maria",
          claim_token: "token-abc",
          claimed_by: null,
          claimed_at: null,
          created_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "guest-2",
          expense_id: "expense-1",
          display_name: "Joao",
          claim_token: "token-def",
          claimed_by: "user-carlos",
          claimed_at: "2024-01-02T00:00:00Z",
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    mock.onTable("expense_guest_shares", {
      data: [
        { id: "gs-1", expense_id: "expense-1", guest_id: "guest-1", share_amount_cents: 3000 },
        { id: "gs-2", expense_id: "expense-1", guest_id: "guest-2", share_amount_cents: 2000 },
      ],
    });
    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice Silva", avatar_url: null },
        { id: "user-bob", handle: "bob", name: "Bob Santos", avatar_url: null },
      ],
    });

    const result = await loadExpense("expense-1");

    expect(result!.guests).toHaveLength(2);
    expect(result!.guests[0].displayName).toBe("Maria");
    expect(result!.guests[0].claimedBy).toBeUndefined();
    expect(result!.guests[0].share?.shareAmountCents).toBe(3000);
    expect(result!.guests[1].displayName).toBe("Joao");
    expect(result!.guests[1].claimedBy).toBe("user-carlos");
    expect(result!.guests[1].share?.shareAmountCents).toBe(2000);
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
