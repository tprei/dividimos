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

  it("loads an itemized bill with items, splits, participants, and ledger", async () => {
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
        ledger: [
          {
            id: "ledger-1",
            bill_id: "bill-1",
            entry_type: "debt",
            group_id: null,
            from_user_id: "user-bob",
            to_user_id: "user-alice",
            amount_cents: 2750,
            paid_amount_cents: 0,
            status: "pending",
            paid_at: null,
            confirmed_at: null,
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
    expect(result!.ledger).toHaveLength(1);
    expect(result!.ledger[0].amountCents).toBe(2750);
    expect(result!.billSplits).toHaveLength(0);

    // Verify it queried user_profiles instead of relying on FK join
    const profileQueries = mock.findCalls("user_profiles", "select");
    expect(profileQueries).toHaveLength(1);
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
        bill_participants: [
          { user_id: "user-alice", status: "accepted" },
          { user_id: "user-bob", status: "accepted" },
        ],
        bill_payers: [{ bill_id: "bill-2", user_id: "user-alice", amount_cents: 10000 }],
        ledger: [],
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
        ledger: [],
        bill_items: [],
        bill_splits: [],
      },
    });

    // user_profiles query will include both user-bob (from participants) and user-alice (creator)
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

    // Verify only one user_profiles query was made (batch fetch)
    const profileQueries = mock.findCalls("user_profiles", "select");
    expect(profileQueries).toHaveLength(1);
  });

  it("fetches profiles from user_profiles view instead of FK join on users table", async () => {
    mock.onTable("bills", {
      data: {
        id: "bill-4",
        creator_id: "user-alice",
        bill_type: "itemized",
        title: "Test RLS",
        merchant_name: null,
        status: "active",
        service_fee_percent: 0,
        fixed_fees: 0,
        total_amount: 2000,
        total_amount_input: 2000,
        group_id: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        bill_participants: [
          { user_id: "user-alice", status: "accepted" },
          { user_id: "user-bob", status: "accepted" },
          { user_id: "user-carol", status: "accepted" },
        ],
        bill_payers: [{ bill_id: "bill-4", user_id: "user-alice", amount_cents: 2000 }],
        ledger: [],
        bill_items: [],
        bill_splits: [],
      },
    });

    mock.onTable("user_profiles", {
      data: [
        { id: "user-alice", handle: "alice", name: "Alice", avatar_url: "https://example.com/alice.jpg" },
        { id: "user-bob", handle: "bob", name: "Bob", avatar_url: null },
        { id: "user-carol", handle: "carol", name: "Carol", avatar_url: null },
      ],
    });

    const result = await loadBillFromSupabase("bill-4");

    expect(result).not.toBeNull();
    expect(result!.participants).toHaveLength(3);

    const alice = result!.participants.find((p) => p.id === "user-alice")!;
    expect(alice.name).toBe("Alice");
    expect(alice.handle).toBe("alice");
    expect(alice.avatarUrl).toBe("https://example.com/alice.jpg");

    const bob = result!.participants.find((p) => p.id === "user-bob")!;
    expect(bob.name).toBe("Bob");

    // No query to the users table — only user_profiles
    const usersCalls = mock.findCalls("users", "select");
    expect(usersCalls).toHaveLength(0);
  });

  it("populates participantStatuses from bill_participants", async () => {
    mock.onTable("bills", {
      data: {
        id: "bill-5",
        creator_id: "user-alice",
        bill_type: "single_amount",
        title: "Status Test",
        merchant_name: null,
        status: "active",
        service_fee_percent: 0,
        fixed_fees: 0,
        total_amount: 3000,
        total_amount_input: 3000,
        group_id: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        bill_participants: [
          { user_id: "user-alice", status: "accepted" },
          { user_id: "user-bob", status: "pending" },
        ],
        bill_payers: [],
        ledger: [],
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

    const result = await loadBillFromSupabase("bill-5");

    expect(result).not.toBeNull();
    expect(result!.participantStatuses.get("user-alice")).toBe("accepted");
    expect(result!.participantStatuses.get("user-bob")).toBe("pending");
  });
});
