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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createClient).mockReturnValue(mock.client as any);
});

describe("loadBillFromSupabase", () => {
  it("returns null when the bill is not found", async () => {
    mock.onTable("bills", { data: null });

    const result = await loadBillFromSupabase("nonexistent");
    expect(result).toBeNull();
  });

  it("loads an itemized bill with items, splits, participants, and ledger", async () => {
    // 1. bills.select → bill row
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
      },
    });

    // 2. Promise.all: participants, payers, ledger, items (itemized)
    mock.onTable("bill_participants", {
      data: [{ user_id: "user-alice" }, { user_id: "user-bob" }],
    });
    mock.onTable("bill_payers", {
      data: [{ user_id: "user-alice", amount_cents: 5500 }],
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
    mock.onTable("bill_items", {
      data: [
        {
          id: "item-1",
          bill_id: "bill-1",
          description: "Pizza",
          quantity: 1,
          unit_price_cents: 5000,
          total_price_cents: 5000,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    // 3. Second Promise.all: user_profiles, item_splits
    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice Silva", avatar_url: null },
        { id: "user-bob", handle: "bob", name: "Bob Santos", avatar_url: null },
      ],
    });
    mock.onTable("item_splits", {
      data: [
        {
          id: "split-1",
          item_id: "item-1",
          user_id: "user-bob",
          split_type: "equal",
          value: 1,
          computed_amount_cents: 5000,
        },
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
    expect(result!.ledger).toHaveLength(1);
    expect(result!.ledger[0].amountCents).toBe(2750);
    expect(result!.billSplits).toHaveLength(0);
  });

  it("loads a single_amount bill with bill splits instead of items", async () => {
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
      },
    });

    mock.onTable("bill_participants", {
      data: [{ user_id: "user-alice" }, { user_id: "user-bob" }],
    });
    mock.onTable("bill_payers", {
      data: [{ user_id: "user-alice", amount_cents: 10000 }],
    });
    mock.onTable("ledger", { data: [] });
    // single_amount → bill_splits (not bill_items)
    mock.onTable("bill_splits", {
      data: [
        {
          user_id: "user-bob",
          split_type: "equal",
          value: 1,
          computed_amount_cents: 5000,
        },
      ],
    });

    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice Silva", avatar_url: null },
        { id: "user-bob", handle: "bob", name: "Bob Santos", avatar_url: null },
      ],
    });
    // No item_splits for single_amount (resolves via Promise.resolve({ data: [] }))

    const result = await loadBillFromSupabase("bill-2");

    expect(result).not.toBeNull();
    expect(result!.bill.billType).toBe("single_amount");
    expect(result!.items).toHaveLength(0);
    expect(result!.splits).toHaveLength(0);
    expect(result!.billSplits).toHaveLength(1);
    expect(result!.billSplits[0].computedAmountCents).toBe(5000);
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
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    });

    // Only bob is in bill_participants, but alice is creator
    mock.onTable("bill_participants", {
      data: [{ user_id: "user-bob" }],
    });
    mock.onTable("bill_payers", { data: [] });
    mock.onTable("ledger", { data: [] });
    mock.onTable("bill_splits", { data: [] });

    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice", avatar_url: null },
        { id: "user-bob", handle: "bob", name: "Bob", avatar_url: null },
      ],
    });

    const result = await loadBillFromSupabase("bill-3");

    expect(result).not.toBeNull();
    // Both alice (creator) and bob (participant) should appear
    expect(result!.participants).toHaveLength(2);

    // Verify user_profiles was queried with both IDs
    const profileSelects = mock.findCalls("user_profiles", "in");
    expect(profileSelects).toHaveLength(1);
    const queriedIds = profileSelects[0].args[1] as string[];
    expect(queriedIds).toContain("user-alice");
    expect(queriedIds).toContain("user-bob");
  });
});
