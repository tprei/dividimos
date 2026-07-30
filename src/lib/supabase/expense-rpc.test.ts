import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseGraphRevision } from "@/lib/expense-money";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { activateExpense, loadExpenseGraphSnapshot } from "./expense-rpc";

let mock: MockSupabase;

function graphRevision(value: number) {
  const parsed = parseGraphRevision(value);
  if (!parsed.ok) throw new Error(`Invalid graph revision fixture: ${value}`);
  return parsed.value;
}

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

describe("activateExpense", () => {
  it("returns error when not authenticated", async () => {
    const result = await activateExpense({
      expense_id: "exp-1",
      expectedGraphRevision: graphRevision(4),
    });

    expect(result).toEqual({
      error: "Não autenticado",
      code: "not_authenticated",
    });
  });

  it("calls the revisioned RPC, strictly decodes its result, and does not fetch tables", async () => {
    mock.setUser({ id: "user-alice" });
    mock.onRpc("activate_saved_expense", {
      data: { id: "exp-1", status: "active", graph_revision: 5 },
      error: null,
    });

    const result = await activateExpense({
      expense_id: "exp-1",
      expectedGraphRevision: graphRevision(4),
    });

    expect(result).toEqual({
      expenseId: "exp-1",
      status: "active",
      graphRevision: graphRevision(5),
      updatedBalances: [],
    });
    expect(mock.findCalls("rpc:activate_saved_expense", "rpc")).toEqual([
      {
        table: "rpc:activate_saved_expense",
        method: "rpc",
        args: [
          "activate_saved_expense",
          {
            p_expense_id: "exp-1",
            p_expected_graph_revision: graphRevision(4),
          },
        ],
      },
    ]);
    expect(mock.findCalls("expenses")).toHaveLength(0);
    expect(mock.findCalls("balances")).toHaveLength(0);
  });

  it("returns typed errors from non-conflict RPC failures", async () => {
    mock.setUser({ id: "user-bob" });
    mock.onRpc("activate_saved_expense", {
      error: { message: "permission_denied: only the creator can activate" },
    });

    const result = await activateExpense({
      expense_id: "exp-1",
      expectedGraphRevision: graphRevision(4),
    });

    expect(result).toEqual({
      error: "only the creator can activate",
      code: "permission_denied",
    });
  });

  it("maps the stable stale-revision SQLSTATE to a conflict without losing provider detail", async () => {
    mock.setUser({ id: "user-alice" });
    mock.onRpc("activate_saved_expense", {
      error: {
        code: "PST08",
        message: "stale_graph_revision: expected revision 5",
        details: "The draft graph changed before activation.",
      },
    });

    const result = await activateExpense({
      expense_id: "exp-1",
      expectedGraphRevision: graphRevision(4),
    });

    expect(result).toEqual({
      error: "expected revision 5",
      code: "stale_graph_revision",
    });
  });

  it("rejects malformed successful RPC data", async () => {
    mock.setUser({ id: "user-alice" });
    mock.onRpc("activate_saved_expense", {
      data: {
        id: "exp-1",
        status: "active",
        graph_revision: 5,
        unexpected: true,
      },
      error: null,
    });

    const result = await activateExpense({
      expense_id: "exp-1",
      expectedGraphRevision: graphRevision(4),
    });

    expect(result).toEqual({
      error: "Resposta de ativação inválida",
      code: "invalid_graph_mutation_result",
    });
  });
});

describe("loadExpenseGraphSnapshot", () => {
  const validSnapshot = {
    expense_id: "exp-1",
    group_id: "group-1",
    graph_revision: 3,
    title: "Uber",
    merchant_name: null,
    expense_type: "single_amount",
    total_amount: 2000,
    service_fee_basis_points: 0,
    fixed_fees: 0,
    items: [],
    item_ids: [],
    draft_claim_protected_user_ids: [],
    status: "draft",
    participant_order: [
      { kind: "user", user_id: "user-alice" },
      { kind: "user", user_id: "user-bob" },
    ],
    shares: [
      { user_id: "user-alice", share_amount_cents: 1000 },
      { user_id: "user-bob", share_amount_cents: 1000 },
    ],
    guest_shares: [],
    payers: [{ user_id: "user-alice", amount_cents: 2000 }],
    guests: [],
  };

  it("returns error when not authenticated", async () => {
    const result = await loadExpenseGraphSnapshot("exp-1");

    expect(result).toEqual({
      error: "Não autenticado",
      code: "not_authenticated",
    });
  });

  it("calls the RPC and strictly decodes a valid snapshot", async () => {
    mock.setUser({ id: "user-alice" });
    mock.onRpc("load_expense_graph_snapshot", {
      data: validSnapshot,
      error: null,
    });

    const result = await loadExpenseGraphSnapshot("exp-1");

    expect(result).not.toBeNull();
    expect(result && "error" in result).toBe(false);
    if (!result || "error" in result) return;
    expect(result.expenseId).toBe("exp-1");
    expect(result.status).toBe("draft");
    expect(result.participantOrder).toHaveLength(2);
    expect(mock.findCalls("rpc:load_expense_graph_snapshot", "rpc")).toEqual([
      {
        table: "rpc:load_expense_graph_snapshot",
        method: "rpc",
        args: ["load_expense_graph_snapshot", { p_expense_id: "exp-1" }],
      },
    ]);
  });

  it("returns null when the expense is unknown or not readable (non-disclosing)", async () => {
    mock.setUser({ id: "user-alice" });
    mock.onRpc("load_expense_graph_snapshot", { data: null, error: null });

    const result = await loadExpenseGraphSnapshot("exp-missing");

    expect(result).toBeNull();
  });

  it("returns typed errors from RPC failures", async () => {
    mock.setUser({ id: "user-alice" });
    mock.onRpc("load_expense_graph_snapshot", {
      error: { message: "permission_denied: not a group member" },
    });

    const result = await loadExpenseGraphSnapshot("exp-1");

    expect(result).toEqual({
      error: "not a group member",
      code: "permission_denied",
    });
  });

  it("rejects a malformed/incomplete snapshot instead of returning partial data", async () => {
    mock.setUser({ id: "user-alice" });
    mock.onRpc("load_expense_graph_snapshot", {
      data: { ...validSnapshot, shares: undefined },
      error: null,
    });

    const result = await loadExpenseGraphSnapshot("exp-1");

    expect(result).toEqual({
      error: "Resposta de snapshot inválida",
      code: "invalid_graph_snapshot",
    });
  });
});
