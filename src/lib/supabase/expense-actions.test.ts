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
  type SaveExpenseDraftParams,
} from "./expense-actions";
import {
  brandExpenseCents,
  parseGraphRevision,
  parseServiceFeeBasisPoints,
} from "@/lib/expense-money";
import { parseExpenseQuantity } from "@/lib/expense-quantity";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

// ============================================================
// saveExpenseDraft
// ============================================================

function basisPoints(value: number) {
  const result = parseServiceFeeBasisPoints(value);
  if (!result.ok) throw new Error("Invalid service fee basis points fixture");
  return result.value;
}

function graphRevision(value: number) {
  const result = parseGraphRevision(value);
  if (!result.ok) throw new Error("Invalid graph revision fixture");
  return result.value;
}

function quantity(value: number) {
  const result = parseExpenseQuantity(value);
  if (!result.ok) throw new Error("Invalid quantity fixture");
  return result.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function graphSaveArgs(): Record<string, unknown> {
  const [call] = mock.findCalls("rpc:save_expense_draft_graph", "rpc");
  if (!call || !isRecord(call.args[1])) {
    throw new Error("Expected graph-save RPC arguments");
  }
  return call.args[1];
}

describe("saveExpenseDraft", () => {
  const baseDraftParams: SaveExpenseDraftParams = {
    groupId: "group-1",
    title: "Jantar",
    merchantName: null,
    expenseType: "itemized",
    totalAmountCents: brandExpenseCents(10000),
    serviceFeeBasisPoints: basisPoints(1000),
    fixedFeesCents: brandExpenseCents(0),
    items: [],
    shares: [],
    payers: [],
    guests: [],
    guestShares: [],
    participantOrder: [],
    expectedGraphRevision: graphRevision(0),
    saveOperationId: "00000000-0000-0000-0000-000000000001",
  };

  it("encodes the exact nine-argument graph-save payload", async () => {
    mock.onRpc("save_expense_draft_graph", {
      data: { id: "expense-1", graph_revision: 1 },
    });
    const input: SaveExpenseDraftParams = {
      ...baseDraftParams,
      items: [
        {
          description: "Pizza",
          quantity: quantity(1),
          unitPriceCents: brandExpenseCents(5000),
          totalPriceCents: brandExpenseCents(5000),
        },
      ],
      shares: [
        { userId: "user-alice", shareAmountCents: brandExpenseCents(5000) },
        { userId: "user-bob", shareAmountCents: brandExpenseCents(0) },
      ],
      payers: [
        { userId: "user-alice", amountCents: brandExpenseCents(10000) },
        { userId: "user-bob", amountCents: brandExpenseCents(0) },
      ],
      guests: [
        { localId: "g:1", displayName: "Maria" },
        { localId: "g:2", displayName: "João" },
      ],
      guestShares: [
        { guestLocalId: "g:1", shareAmountCents: brandExpenseCents(0) },
        { guestLocalId: "g:2", shareAmountCents: brandExpenseCents(5000) },
      ],
      participantOrder: [
        { kind: "user", userId: "user-alice" },
        { kind: "user", userId: "user-bob" },
        { kind: "guest", guestLocalId: "g:1" },
        { kind: "guest", guestLocalId: "g:2" },
      ],
    };

    const result = await saveExpenseDraft(input);

    expect(result).toEqual({ expenseId: "expense-1", graphRevision: 1 });
    expect(mock.findCalls("rpc:save_expense_draft_graph", "rpc")).toHaveLength(1);
    expect(graphSaveArgs()).toEqual({
      p_expense: {
        group_id: "group-1",
        title: "Jantar",
        merchant_name: null,
        expense_type: "itemized",
        total_amount: 10000,
        service_fee_basis_points: 1000,
        fixed_fees: 0,
      },
      p_items: [
        {
          description: "Pizza",
          quantity: 1000,
          unit_price_cents: 5000,
          total_price_cents: 5000,
        },
      ],
      p_shares: [
        { user_id: "user-alice", share_amount_cents: 5000 },
        { user_id: "user-bob", share_amount_cents: 0 },
      ],
      p_payers: [{ user_id: "user-alice", amount_cents: 10000 }],
      p_guests: [
        { local_id: "g:1", display_name: "Maria" },
        { local_id: "g:2", display_name: "João" },
      ],
      p_guest_shares: [
        { local_id: "g:1", share_amount_cents: 0 },
        { local_id: "g:2", share_amount_cents: 5000 },
      ],
      p_participant_order: [
        { kind: "user", user_id: "user-alice" },
        { kind: "user", user_id: "user-bob" },
        { kind: "guest", guest_local_id: "g:1" },
        { kind: "guest", guest_local_id: "g:2" },
      ],
      p_expected_graph_revision: 0,
      p_save_operation_id: "00000000-0000-0000-0000-000000000001",
    });
    const args = graphSaveArgs();
    expect(args.p_items).not.toBe(input.items);
    expect(args.p_shares).not.toBe(input.shares);
    expect(args.p_payers).not.toBe(input.payers);
    expect(args.p_guests).not.toBe(input.guests);
    expect(args.p_guest_shares).not.toBe(input.guestShares);
    expect(args.p_participant_order).not.toBe(input.participantOrder);
  });

  it("adds only the routing id for a replacement save", async () => {
    mock.onRpc("save_expense_draft_graph", {
      data: { id: "expense-existing", graph_revision: 4 },
    });

    const result = await saveExpenseDraft({
      ...baseDraftParams,
      existingExpenseId: "expense-existing",
      expectedGraphRevision: graphRevision(3),
    });

    expect(result).toEqual({ expenseId: "expense-existing", graphRevision: 4 });
    expect(graphSaveArgs().p_expense).toEqual({
      id: "expense-existing",
      group_id: "group-1",
      title: "Jantar",
      merchant_name: null,
      expense_type: "itemized",
      total_amount: 10000,
      service_fee_basis_points: 1000,
      fixed_fees: 0,
    });
  });

  it("maps known RPC codes to safe PT-BR messages", async () => {
    mock.onRpc("save_expense_draft_graph", {
      data: null,
      error: { code: "PST08", message: "stale_graph_revision" },
    });

    const result = await saveExpenseDraft(baseDraftParams);

    expect(result).toEqual({
      error: "Este rascunho foi alterado. Atualize antes de salvar.",
    });
  });

  it("does not expose unknown RPC messages", async () => {
    mock.onRpc("save_expense_draft_graph", {
      data: null,
      error: { code: "XX000", message: "internal database detail" },
    });

    const result = await saveExpenseDraft(baseDraftParams);

    expect(result).toEqual({ error: "Erro ao salvar rascunho" });
    expect(JSON.stringify(result)).not.toContain("internal database detail");
  });

  it("rejects malformed graph-save results", async () => {
    mock.onRpc("save_expense_draft_graph", {
      data: { id: "expense-1", graph_revision: 1, unexpected: true },
    });

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
        quantity: 1000,
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

  it("returns a generic error without leaking the raw delete message", async () => {
    mock.onTable("expenses", {
      error: { message: 'permission denied for table "expenses"' },
    });

    const result = await deleteExpense("expense-1");

    expect(result).toEqual({ error: "Erro ao excluir rascunho" });
    expect(JSON.stringify(result)).not.toContain("permission denied");
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
