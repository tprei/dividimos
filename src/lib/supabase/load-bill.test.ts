import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { loadBillFromSupabase } from "./load-bill";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

describe("loadBillFromSupabase", () => {
  it("returns null when the bill is not found", async () => {
    mock.onTable("bills", { data: null });

    const result = await loadBillFromSupabase("nonexistent");
    expect(result).toBeNull();
  });

  it("loads an itemized bill with items, splits, participants, and expense_shares", async () => {
    mock.onTable("bills", {
      data: {
        id: "bill-1",
        creator_id: "user-alice",
        bill_type: "itemized",
        title: "Jantar",
        merchant_name: "Restaurante",
        status: "active",
        service_fee_percent: 10,
        fixed_fees: 0,
        total_amount: 5500,
        total_amount_input: 5000,
        group_id: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        bill_participants: [
          { user_id: "user-alice", status: "accepted" },
          { user_id: "user-bob", status: "accepted" },
        ],
        bill_payers: [{ bill_id: "bill-1", user_id: "user-alice", amount_cents: 5500 }],
        expense_shares: [
          {
            bill_id: "bill-1",
            user_id: "user-alice",
            paid_cents: 5500,
            owed_cents: 500,
            net_cents: 5000,
            created_at: "2024-01-01T00:00:00Z",
          },
          {
            bill_id: "bill-1",
            user_id: "user-bob",
            paid_cents: 0,
            owed_cents: 5000,
            net_cents: -5000,
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
        bill_items: [
          {
            id: "item-1",
            bill_id: "bill-1",
            description: "Pizza",
            quantity: 1,
            unit_price_cents: 5000,
            total_price_cents: 5000,
            created_at: "2024-01-01T00:00:00Z",
            item_splits: [
              {
                id: "split-1",
                item_id: "item-1",
                user_id: "user-bob",
                split_type: "equal",
                value: 1,
                computed_amount_cents: 5000,
              },
            ],
          },
        ],
        bill_splits: [],
      },
    });

    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice Silva", avatar_url: null },
        { id: "user-bob", handle: "bob", name: "Bob Santos", avatar_url: null },
      ],
    });

    const result = await loadBillFromSupabase("bill-1");

    expect(result).not.toBeNull();
    expect(result!.bill.id).toBe("bill-1");
    expect(result!.bill.billType).toBe("itemized");
    expect(result!.bill.title).toBe("Jantar");
    expect(result!.bill.totalAmount).toBe(5500);
    expect(result!.bill.payers).toHaveLength(1);
    expect(result!.participants).toHaveLength(2);
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0].description).toBe("Pizza");
    expect(result!.splits).toHaveLength(1);
    expect(result!.splits[0].userId).toBe("user-bob");
    expect(result!.shares).toHaveLength(2);
    expect(result!.shares[0].userId).toBe("user-alice");
    expect(result!.shares[0].paidCents).toBe(5500);
    expect(result!.shares[0].owedCents).toBe(500);
    expect(result!.shares[0].netCents).toBe(5000);
    expect(result!.shares[1].userId).toBe("user-bob");
    expect(result!.shares[1].paidCents).toBe(0);
    expect(result!.shares[1].owedCents).toBe(5000);
    expect(result!.shares[1].netCents).toBe(-5000);
    expect(result!.billSplits).toHaveLength(0);
  });

  it("loads a single_amount bill with bill splits and expense_shares", async () => {
    mock.onTable("bills", {
      data: {
        id: "bill-2",
        creator_id: "user-alice",
        bill_type: "single_amount",
        title: "Aluguel",
        merchant_name: null,
        status: "active",
        service_fee_percent: 0,
        fixed_fees: 0,
        total_amount: 10000,
        total_amount_input: 10000,
        group_id: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        bill_participants: [
          { user_id: "user-alice", status: "accepted" },
          { user_id: "user-bob", status: "accepted" },
        ],
        bill_payers: [{ bill_id: "bill-2", user_id: "user-alice", amount_cents: 10000 }],
        expense_shares: [
          {
            bill_id: "bill-2",
            user_id: "user-alice",
            paid_cents: 10000,
            owed_cents: 5000,
            net_cents: 5000,
            created_at: "2024-01-01T00:00:00Z",
          },
          {
            bill_id: "bill-2",
            user_id: "user-bob",
            paid_cents: 0,
            owed_cents: 5000,
            net_cents: -5000,
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
        bill_items: [],
        bill_splits: [
          {
            id: "bs-1",
            bill_id: "bill-2",
            user_id: "user-bob",
            split_type: "equal",
            value: 1,
            computed_amount_cents: 5000,
          },
        ],
      },
    });

    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice Silva", avatar_url: null },
        { id: "user-bob", handle: "bob", name: "Bob Santos", avatar_url: null },
      ],
    });

    const result = await loadBillFromSupabase("bill-2");

    expect(result).not.toBeNull();
    expect(result!.bill.billType).toBe("single_amount");
    expect(result!.items).toHaveLength(0);
    expect(result!.splits).toHaveLength(0);
    expect(result!.billSplits).toHaveLength(1);
    expect(result!.billSplits[0].computedAmountCents).toBe(5000);
    expect(result!.shares).toHaveLength(2);
    expect(result!.shares[0].netCents).toBe(5000);
    expect(result!.shares[1].netCents).toBe(-5000);
  });

  it("includes the creator in participants even if not in bill_participants", async () => {
    mock.onTable("bills", {
      data: {
        id: "bill-3",
        creator_id: "user-alice",
        bill_type: "single_amount",
        title: "Test",
        merchant_name: null,
        status: "active",
        service_fee_percent: 0,
        fixed_fees: 0,
        total_amount: 1000,
        total_amount_input: 1000,
        group_id: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        bill_participants: [
          { user_id: "user-bob", status: "accepted" },
        ],
        bill_payers: [],
        expense_shares: [],
        bill_items: [],
        bill_splits: [],
      },
    });

    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice", avatar_url: null },
        { id: "user-bob", handle: "bob", name: "Bob", avatar_url: null },
      ],
    });

    const result = await loadBillFromSupabase("bill-3");

    expect(result).not.toBeNull();
    expect(result!.participants).toHaveLength(2);

    const names = result!.participants.map((p) => p.name);
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
  });

  it("returns participant statuses as a map", async () => {
    mock.onTable("bills", {
      data: {
        id: "bill-4",
        creator_id: "user-alice",
        bill_type: "single_amount",
        title: "Test",
        merchant_name: null,
        status: "active",
        service_fee_percent: 0,
        fixed_fees: 0,
        total_amount: 1000,
        total_amount_input: 1000,
        group_id: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        bill_participants: [
          { user_id: "user-alice", status: "accepted" },
          { user_id: "user-bob", status: "invited" },
        ],
        bill_payers: [],
        expense_shares: [],
        bill_items: [],
        bill_splits: [],
      },
    });

    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice", avatar_url: null },
        { id: "user-bob", handle: "bob", name: "Bob", avatar_url: null },
      ],
    });

    const result = await loadBillFromSupabase("bill-4");

    expect(result).not.toBeNull();
    expect(result!.participantStatuses.get("user-alice")).toBe("accepted");
    expect(result!.participantStatuses.get("user-bob")).toBe("invited");
  });
});
