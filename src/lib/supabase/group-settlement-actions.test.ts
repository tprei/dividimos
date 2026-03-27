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
  batchMarkGroupSettlementsPaid,
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

  it("loads and maps bills, ledger, and participants via nested select", async () => {
    // Nested PostgREST select returns ledger + bill_participants inline
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
          ledger: [
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
          bill_participants: [
            { user_id: "user-alice" },
            { user_id: "user-bob" },
          ],
        },
      ],
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

  it("uses a single query with nested select instead of separate queries", async () => {
    mock.onTable("bills", {
      data: [
        {
          id: "bill-1",
          creator_id: "user-alice",
          bill_type: "single_amount",
          title: "Uber",
          merchant_name: null,
          status: "active",
          service_fee_percent: 0,
          fixed_fees: 0,
          total_amount: 4000,
          total_amount_input: 4000,
          group_id: "group-1",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          ledger: [],
          bill_participants: [{ user_id: "user-alice" }],
        },
      ],
    });
    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice", avatar_url: null },
      ],
    });

    await loadGroupBillsAndLedger("group-1");

    // Should use nested select: "*, ledger(*), bill_participants(user_id)"
    const selectCalls = mock.findCalls("bills", "select");
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0].args[0]).toBe("*, ledger(*), bill_participants(user_id)");

    // No separate ledger or bill_participants queries
    const ledgerCalls = mock.findCalls("ledger");
    expect(ledgerCalls).toHaveLength(0);
    const participantCalls = mock.findCalls("bill_participants");
    expect(participantCalls).toHaveLength(0);
  });

  it("deduplicates participant IDs across multiple bills", async () => {
    mock.onTable("bills", {
      data: [
        {
          id: "bill-1",
          creator_id: "user-alice",
          bill_type: "single_amount",
          title: "Bill 1",
          merchant_name: null,
          status: "active",
          service_fee_percent: 0,
          fixed_fees: 0,
          total_amount: 2000,
          total_amount_input: 2000,
          group_id: "group-1",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          ledger: [],
          bill_participants: [
            { user_id: "user-alice" },
            { user_id: "user-bob" },
          ],
        },
        {
          id: "bill-2",
          creator_id: "user-bob",
          bill_type: "single_amount",
          title: "Bill 2",
          merchant_name: null,
          status: "active",
          service_fee_percent: 0,
          fixed_fees: 0,
          total_amount: 3000,
          total_amount_input: 3000,
          group_id: "group-1",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          ledger: [],
          bill_participants: [
            { user_id: "user-bob" },
            { user_id: "user-carol" },
          ],
        },
      ],
    });
    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice", avatar_url: null },
        { id: "user-bob", handle: "bob", name: "Bob", avatar_url: null },
        { id: "user-carol", handle: "carol", name: "Carol", avatar_url: null },
      ],
    });

    const result = await loadGroupBillsAndLedger("group-1");

    expect(result.bills).toHaveLength(2);
    expect(result.participants).toHaveLength(3);
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
  it("calls the sync_group_settlements RPC with mapped edges", async () => {
    mock.onTable("rpc:sync_group_settlements", {
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
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    const result = await syncGroupSettlements("group-1", [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 },
    ]);

    const rpcCalls = mock.findCalls("rpc:sync_group_settlements", "rpc");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args[1]).toEqual({
      p_group_id: "group-1",
      p_edges: [
        { from_user_id: "user-bob", to_user_id: "user-alice", amount_cents: 5000 },
      ],
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

  it("maps multiple returned settlements correctly", async () => {
    mock.onTable("rpc:sync_group_settlements", {
      data: [
        {
          id: "gs-1",
          group_id: "group-1",
          from_user_id: "user-bob",
          to_user_id: "user-alice",
          amount_cents: 3000,
          paid_amount_cents: 1000,
          status: "partially_paid",
          paid_at: null,
          created_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "gs-2",
          group_id: "group-1",
          from_user_id: "user-carlos",
          to_user_id: "user-alice",
          amount_cents: 2000,
          paid_amount_cents: 0,
          status: "pending",
          paid_at: null,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    const result = await syncGroupSettlements("group-1", [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 4000 },
      { fromUserId: "user-carlos", toUserId: "user-alice", amountCents: 2000 },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].paidAmountCents).toBe(1000);
    expect(result[1].amountCents).toBe(2000);
  });

  it("returns empty array on RPC error", async () => {
    mock.onTable("rpc:sync_group_settlements", {
      data: null,
      error: { message: "Not a member of this group" },
    });

    const result = await syncGroupSettlements("group-1", [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 },
    ]);

    expect(result).toHaveLength(0);
  });

  it("returns empty array when RPC returns no data", async () => {
    mock.onTable("rpc:sync_group_settlements", { data: null });

    const result = await syncGroupSettlements("group-1", []);

    expect(result).toHaveLength(0);
  });

  it("defaults paidAmountCents to 0 when absent", async () => {
    mock.onTable("rpc:sync_group_settlements", {
      data: [
        {
          id: "gs-1",
          group_id: "group-1",
          from_user_id: "user-bob",
          to_user_id: "user-alice",
          amount_cents: 5000,
          status: "pending",
          paid_at: null,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    const result = await syncGroupSettlements("group-1", [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 },
    ]);

    expect(result[0].paidAmountCents).toBe(0);
  });
});

describe("markGroupSettlementPaid", () => {
  it("inserts a payment row and returns the generated payment ID", async () => {
    mock.onTable("payments", { data: { id: "pay-1" }, error: null });

    const result = await markGroupSettlementPaid("gs-1", 4000, "user-bob", "user-alice");

    expect(result.error).toBeUndefined();
    expect(result.paymentId).toBe("pay-1");
    const inserts = mock.findCalls("payments", "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toMatchObject({
      group_settlement_id: "gs-1",
      from_user_id: "user-bob",
      to_user_id: "user-alice",
      amount_cents: 4000,
    });
  });

  it("chains .select() and .single() to capture the generated UUID", async () => {
    mock.onTable("payments", { data: { id: "pay-2" }, error: null });

    await markGroupSettlementPaid("gs-1", 4000, "user-bob", "user-alice");

    const selectCalls = mock.findCalls("payments", "select");
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0].args[0]).toBe("id");

    const singleCalls = mock.findCalls("payments", "single");
    expect(singleCalls).toHaveLength(1);
  });

  it("returns error message on insert failure", async () => {
    mock.onTable("payments", { error: { message: "RLS violation" } });

    const result = await markGroupSettlementPaid("gs-1", 4000, "user-bob", "user-alice");

    expect(result.error).toBe("RLS violation");
    expect(result.paymentId).toBeUndefined();
  });

  it("rejects empty settlement ID without hitting the database", async () => {
    const result = await markGroupSettlementPaid("", 4000, "user-bob", "user-alice");

    expect(result.error).toBe("Settlement ID is required");
    expect(result.paymentId).toBeUndefined();
    const inserts = mock.findCalls("payments", "insert");
    expect(inserts).toHaveLength(0);
  });
});

describe("batchMarkGroupSettlementsPaid", () => {
  it("inserts all payments in a single batch and returns IDs", async () => {
    mock.onTable("payments", {
      data: [{ id: "pay-1" }, { id: "pay-2" }],
      error: null,
    });

    const result = await batchMarkGroupSettlementsPaid([
      { settlementId: "gs-1", amountCents: 3000, fromUserId: "user-bob", toUserId: "user-alice" },
      { settlementId: "gs-2", amountCents: 2000, fromUserId: "user-bob", toUserId: "user-carol" },
    ]);

    expect(result.error).toBeUndefined();
    expect(result.paymentIds).toEqual(["pay-1", "pay-2"]);

    const inserts = mock.findCalls("payments", "insert");
    expect(inserts).toHaveLength(1);
    const rows = inserts[0].args[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      group_settlement_id: "gs-1",
      amount_cents: 3000,
    });
    expect(rows[1]).toMatchObject({
      group_settlement_id: "gs-2",
      amount_cents: 2000,
    });
  });

  it("chains .select() to capture generated UUIDs", async () => {
    mock.onTable("payments", { data: [{ id: "pay-1" }], error: null });

    await batchMarkGroupSettlementsPaid([
      { settlementId: "gs-1", amountCents: 5000, fromUserId: "user-bob", toUserId: "user-alice" },
    ]);

    const selectCalls = mock.findCalls("payments", "select");
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0].args[0]).toBe("id");
  });

  it("filters out entries with empty settlementId", async () => {
    mock.onTable("payments", { data: [{ id: "pay-1" }], error: null });

    const result = await batchMarkGroupSettlementsPaid([
      { settlementId: "", amountCents: 3000, fromUserId: "user-bob", toUserId: "user-alice" },
      { settlementId: "gs-2", amountCents: 2000, fromUserId: "user-bob", toUserId: "user-carol" },
    ]);

    expect(result.error).toBeUndefined();
    const inserts = mock.findCalls("payments", "insert");
    expect(inserts).toHaveLength(1);
    const rows = inserts[0].args[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].group_settlement_id).toBe("gs-2");
  });

  it("filters out entries with zero or negative amountCents", async () => {
    mock.onTable("payments", { data: [{ id: "pay-1" }], error: null });

    const result = await batchMarkGroupSettlementsPaid([
      { settlementId: "gs-1", amountCents: 0, fromUserId: "user-bob", toUserId: "user-alice" },
      { settlementId: "gs-2", amountCents: -100, fromUserId: "user-bob", toUserId: "user-carol" },
      { settlementId: "gs-3", amountCents: 5000, fromUserId: "user-bob", toUserId: "user-carol" },
    ]);

    expect(result.error).toBeUndefined();
    const inserts = mock.findCalls("payments", "insert");
    const rows = inserts[0].args[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].group_settlement_id).toBe("gs-3");
  });

  it("returns error when all entries are invalid", async () => {
    const result = await batchMarkGroupSettlementsPaid([
      { settlementId: "", amountCents: 3000, fromUserId: "user-bob", toUserId: "user-alice" },
      { settlementId: "gs-2", amountCents: 0, fromUserId: "user-bob", toUserId: "user-carol" },
    ]);

    expect(result.error).toBe("No valid payments to insert");
    expect(result.paymentIds).toEqual([]);
    const inserts = mock.findCalls("payments", "insert");
    expect(inserts).toHaveLength(0);
  });

  it("returns error on insert failure", async () => {
    mock.onTable("payments", { error: { message: "RLS violation" } });

    const result = await batchMarkGroupSettlementsPaid([
      { settlementId: "gs-1", amountCents: 3000, fromUserId: "user-bob", toUserId: "user-alice" },
    ]);

    expect(result.error).toBe("RLS violation");
    expect(result.paymentIds).toEqual([]);
  });

  it("returns empty paymentIds when data is null", async () => {
    mock.onTable("payments", { data: null, error: null });

    const result = await batchMarkGroupSettlementsPaid([
      { settlementId: "gs-1", amountCents: 3000, fromUserId: "user-bob", toUserId: "user-alice" },
    ]);

    expect(result.error).toBeUndefined();
    expect(result.paymentIds).toEqual([]);
  });
});

