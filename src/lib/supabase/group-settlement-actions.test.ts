import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import {
  loadGroupBillsAndLedger,
  loadGroupSettlements,
  upsertGroupSettlements,
  markGroupSettlementPaid,
  confirmGroupSettlement,
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
          status: "pending",
          paid_at: null,
          confirmed_at: null,
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
  it("maps settlement rows to domain types", async () => {
    mock.onTable("group_settlements", {
      data: [
        {
          id: "gs-1",
          group_id: "group-1",
          from_user_id: "user-bob",
          to_user_id: "user-alice",
          amount_cents: 5000,
          status: "pending",
          paid_at: null,
          confirmed_at: null,
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
      status: "pending",
    });
  });

  it("returns empty array when no settlements exist", async () => {
    mock.onTable("group_settlements", { data: [] });

    const result = await loadGroupSettlements("group-1");
    expect(result).toHaveLength(0);
  });
});

describe("upsertGroupSettlements", () => {
  it("inserts new pending settlements for edges", async () => {
    // loadGroupSettlements (called internally) → no existing
    mock.onTable("group_settlements", { data: [] });
    // insert new settlements
    mock.onTable("group_settlements", { error: null });

    await upsertGroupSettlements("group-1", [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 },
    ]);

    const inserts = mock.findCalls("group_settlements", "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toEqual([
      {
        group_id: "group-1",
        from_user_id: "user-bob",
        to_user_id: "user-alice",
        amount_cents: 5000,
      },
    ]);
  });

  it("deletes stale pending rows and inserts updated amounts", async () => {
    // Existing: bob→alice 3000 pending + 2000 already paid
    mock.onTable("group_settlements", {
      data: [
        {
          id: "gs-pending",
          group_id: "group-1",
          from_user_id: "user-bob",
          to_user_id: "user-alice",
          amount_cents: 3000,
          status: "pending",
          paid_at: null,
          confirmed_at: null,
          created_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "gs-paid",
          group_id: "group-1",
          from_user_id: "user-bob",
          to_user_id: "user-alice",
          amount_cents: 2000,
          status: "paid_unconfirmed",
          paid_at: "2024-01-02T00:00:00Z",
          confirmed_at: null,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    // delete stale pending
    mock.onTable("group_settlements", { error: null });
    // insert new pending for remaining
    mock.onTable("group_settlements", { error: null });

    // New edge: bob→alice owes 6000 total, but 2000 already paid
    await upsertGroupSettlements("group-1", [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 6000 },
    ]);

    // Should delete the old pending row
    const deletes = mock.findCalls("group_settlements", "delete");
    expect(deletes).toHaveLength(1);

    // Should insert a new pending row for 6000 - 2000 = 4000
    const inserts = mock.findCalls("group_settlements", "insert");
    expect(inserts).toHaveLength(1);
    const insertedRows = inserts[0].args[0] as { amount_cents: number }[];
    expect(insertedRows[0].amount_cents).toBe(4000);
  });

  it("does not insert if remaining amount is <= 1 centavo", async () => {
    mock.onTable("group_settlements", {
      data: [
        {
          id: "gs-paid",
          group_id: "group-1",
          from_user_id: "user-bob",
          to_user_id: "user-alice",
          amount_cents: 5000,
          status: "settled",
          paid_at: "2024-01-02T00:00:00Z",
          confirmed_at: "2024-01-03T00:00:00Z",
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    // Edge amount equals what's already settled
    await upsertGroupSettlements("group-1", [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 },
    ]);

    // Should not insert anything (remaining is 0)
    expect(mock.findCalls("group_settlements", "insert")).toHaveLength(0);
  });

  it("deletes pending rows for edges that no longer exist", async () => {
    mock.onTable("group_settlements", {
      data: [
        {
          id: "gs-stale",
          group_id: "group-1",
          from_user_id: "user-carlos",
          to_user_id: "user-alice",
          amount_cents: 1000,
          status: "pending",
          paid_at: null,
          confirmed_at: null,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    mock.onTable("group_settlements", { error: null }); // delete

    // Empty edges — the carlos→alice edge no longer exists
    await upsertGroupSettlements("group-1", []);

    const deletes = mock.findCalls("group_settlements", "delete");
    expect(deletes).toHaveLength(1);
  });
});

describe("markGroupSettlementPaid", () => {
  it("updates status to paid_unconfirmed with timestamp", async () => {
    mock.onTable("group_settlements", { error: null });

    await markGroupSettlementPaid("gs-1");

    const updates = mock.findCalls("group_settlements", "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({
      status: "paid_unconfirmed",
    });
    expect(updates[0].args[0]).toHaveProperty("paid_at");
  });
});

describe("confirmGroupSettlement", () => {
  it("updates status to settled with timestamp", async () => {
    mock.onTable("group_settlements", { error: null });

    await confirmGroupSettlement("gs-1");

    const updates = mock.findCalls("group_settlements", "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({
      status: "settled",
    });
    expect(updates[0].args[0]).toHaveProperty("confirmed_at");
  });
});
