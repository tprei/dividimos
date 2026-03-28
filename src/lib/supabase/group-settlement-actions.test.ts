import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import {
  loadGroupBillsAndLedger,
  loadGroupSettlements,
  syncGroupSettlements,
  markGroupSettlementPaid,
} from "./group-settlement-actions";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

describe("loadGroupBillsAndLedger", () => {
  it("returns empty arrays when there are no bills", async () => {
    mock.onTable("bills", { data: [] });

    const result = await loadGroupBillsAndLedger("group-1");

    expect(result.bills).toHaveLength(0);
    expect(result.ledger).toHaveLength(0);
    expect(result.participants).toHaveLength(0);
  });

  it("loads and maps bills, ledger, and participants", async () => {
    mock.onTable("bills", {
      data: [
        {
          id: "bill-1",
          creator_id: "user-alice",
          bill_type: "itemized",
          title: "Jantar",
          merchant_name: null,
          status: "active",
          service_fee_percent: 10,
          fixed_fees: 0,
          total_amount: 5500,
          total_amount_input: 5000,
          group_id: "group-1",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    mock.onTable("ledger", {
      data: [
        {
          id: "ledger-1",
          bill_id: "bill-1",
          from_user_id: "user-bob",
          to_user_id: "user-alice",
          amount_cents: 2750,
          paid_amount_cents: 0,
          status: "pending",
          paid_at: null,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    mock.onTable("bill_participants", {
      data: [{ user_id: "user-alice" }, { user_id: "user-bob" }],
    });
    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice", avatar_url: null },
        { id: "user-bob", handle: "bob", name: "Bob", avatar_url: null },
      ],
    });

    const result = await loadGroupBillsAndLedger("group-1");

    expect(result.bills).toHaveLength(1);
    expect(result.bills[0].billType).toBe("itemized");
    expect(result.bills[0].groupId).toBe("group-1");
    expect(result.ledger).toHaveLength(1);
    expect(result.ledger[0].fromUserId).toBe("user-bob");
    expect(result.participants).toHaveLength(2);
  });
});

describe("loadGroupSettlements", () => {
  it("maps settlement rows to domain types including paidAmountCents", async () => {
    mock.onTable("group_settlements", {
      data: [
        {
          id: "gs-1",
          group_id: "group-1",
          from_user_id: "user-bob",
          to_user_id: "user-alice",
          amount_cents: 5000,
          paid_amount_cents: 2000,
          status: "pending",
          paid_at: null,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    const result = await loadGroupSettlements("group-1");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "gs-1",
      groupId: "group-1",
      fromUserId: "user-bob",
      toUserId: "user-alice",
      amountCents: 5000,
      paidAmountCents: 2000,
      status: "pending",
    });
  });

  it("defaults paidAmountCents to 0 when absent from DB row", async () => {
    mock.onTable("group_settlements", {
      data: [
        {
          id: "gs-2",
          group_id: "group-1",
          from_user_id: "user-bob",
          to_user_id: "user-alice",
          amount_cents: 3000,
          status: "pending",
          paid_at: null,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    const result = await loadGroupSettlements("group-1");

    expect(result[0].paidAmountCents).toBe(0);
  });

  it("returns empty array when no settlements exist", async () => {
    mock.onTable("group_settlements", { data: [] });

    const result = await loadGroupSettlements("group-1");
    expect(result).toHaveLength(0);
  });
});

describe("syncGroupSettlements", () => {
  it("calls the RPC with snake_case edges and returns mapped settlements", async () => {
    mock.onRpc("sync_group_settlements", {
      data: [
        {
          id: "gs-1",
          group_id: "group-1",
          from_user_id: "user-bob",
          to_user_id: "user-alice",
          amount_cents: 5000,
          paid_amount_cents: 0,
          status: "pending",
          paid_at: null,
          confirmed_at: null,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
      error: null,
    });

    const result = await syncGroupSettlements("group-1", [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 },
    ]);

    const rpcCalls = mock.findCalls("rpc:sync_group_settlements", "rpc");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args[1]).toEqual({
      p_group_id: "group-1",
      p_edges: [{ from_user_id: "user-bob", to_user_id: "user-alice", amount_cents: 5000 }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "gs-1",
      groupId: "group-1",
      fromUserId: "user-bob",
      toUserId: "user-alice",
      amountCents: 5000,
      paidAmountCents: 0,
      status: "pending",
    });
  });

  it("passes empty edges array when there are no debts", async () => {
    mock.onRpc("sync_group_settlements", { data: [], error: null });

    const result = await syncGroupSettlements("group-1", []);

    const rpcCalls = mock.findCalls("rpc:sync_group_settlements", "rpc");
    expect((rpcCalls[0].args[1] as { p_edges: unknown[] }).p_edges).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when RPC returns null data", async () => {
    mock.onRpc("sync_group_settlements", { data: null, error: null });

    const result = await syncGroupSettlements("group-1", [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 },
    ]);

    expect(result).toHaveLength(0);
  });
});

describe("markGroupSettlementPaid", () => {
  it("inserts a payment row for the group settlement", async () => {
    mock.onTable("payments", { error: null });

    const result = await markGroupSettlementPaid("gs-1", 4000, "user-bob", "user-alice");

    expect(result.error).toBeUndefined();
    const inserts = mock.findCalls("payments", "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toMatchObject({
      group_settlement_id: "gs-1",
      from_user_id: "user-bob",
      to_user_id: "user-alice",
      amount_cents: 4000,
    });
  });

  it("returns error message on insert failure", async () => {
    mock.onTable("payments", { error: { message: "RLS violation" } });

    const result = await markGroupSettlementPaid("gs-1", 4000, "user-bob", "user-alice");

    expect(result.error).toBe("RLS violation");
  });
});

