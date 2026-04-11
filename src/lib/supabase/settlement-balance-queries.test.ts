import { describe, it, expect, vi, beforeEach } from "vitest";

// Build a chainable Supabase mock
const mockData: { data: unknown[]; error: null } = { data: [], error: null };

function chainable() {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "select", "eq", "neq", "or", "in", "order", "limit", "single", "maybeSingle"];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(mockData);
  return chain;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: vi.fn(() => chainable()),
  }),
}));

import {
  queryGroupBalancesForUser,
  queryAllBalancesForUser,
} from "./settlement-actions";

describe("queryGroupBalancesForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty map when no balances exist", async () => {
    mockData.data = [];
    const result = await queryGroupBalancesForUser("group-1", "user-a");
    expect(result.size).toBe(0);
  });

  it("computes net balance correctly when user is userA (owes userB)", async () => {
    // userA < userB, amountCents > 0 means userA owes userB
    mockData.data = [
      { group_id: "group-1", user_a: "user-a", user_b: "user-b", amount_cents: 1000, updated_at: "2026-01-01" },
    ];

    const result = await queryGroupBalancesForUser("group-1", "user-a");
    // From user-a's perspective: I owe user-b 1000 → negative
    expect(result.get("user-b")).toBe(-1000);
  });

  it("computes net balance correctly when user is userB (owed by userA)", async () => {
    // userA < userB, amountCents > 0 means userA owes userB
    mockData.data = [
      { group_id: "group-1", user_a: "user-a", user_b: "user-b", amount_cents: 1000, updated_at: "2026-01-01" },
    ];

    const result = await queryGroupBalancesForUser("group-1", "user-b");
    // From user-b's perspective: user-a owes me 1000 → positive
    expect(result.get("user-a")).toBe(1000);
  });

  it("computes net when amountCents is negative (reverse direction)", async () => {
    // amountCents < 0 means userB owes userA
    mockData.data = [
      { group_id: "group-1", user_a: "user-a", user_b: "user-b", amount_cents: -500, updated_at: "2026-01-01" },
    ];

    const result = await queryGroupBalancesForUser("group-1", "user-a");
    // userA perspective: positive amountCents = I owe userB, but amountCents = -500
    // so -(-500) = +500, meaning userB owes me
    expect(result.get("user-b")).toBe(500);
  });

  it("aggregates multiple balances for the same counterparty", async () => {
    mockData.data = [
      { group_id: "group-1", user_a: "user-a", user_b: "user-c", amount_cents: 300, updated_at: "2026-01-01" },
      { group_id: "group-1", user_a: "user-a", user_b: "user-c", amount_cents: 200, updated_at: "2026-01-02" },
    ];

    const result = await queryGroupBalancesForUser("group-1", "user-a");
    // Both rows: I (user-a) owe user-c → -300 + -200 = -500
    expect(result.get("user-c")).toBe(-500);
  });

  it("handles multiple counterparties", async () => {
    mockData.data = [
      { group_id: "group-1", user_a: "user-a", user_b: "user-b", amount_cents: 1000, updated_at: "2026-01-01" },
      { group_id: "group-1", user_a: "user-a", user_b: "user-c", amount_cents: -500, updated_at: "2026-01-01" },
    ];

    const result = await queryGroupBalancesForUser("group-1", "user-a");
    expect(result.get("user-b")).toBe(-1000); // I owe user-b
    expect(result.get("user-c")).toBe(500);   // user-c owes me
  });
});

describe("queryAllBalancesForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates balances across groups", async () => {
    mockData.data = [
      { group_id: "group-1", user_a: "user-a", user_b: "user-b", amount_cents: 1000, updated_at: "2026-01-01" },
      { group_id: "group-2", user_a: "user-a", user_b: "user-b", amount_cents: 500, updated_at: "2026-01-01" },
    ];

    const result = await queryAllBalancesForUser("user-a");
    // Both groups: I owe user-b → -1000 + -500 = -1500
    expect(result.get("user-b")).toBe(-1500);
  });

  it("returns empty map when no balances exist", async () => {
    mockData.data = [];
    const result = await queryAllBalancesForUser("user-a");
    expect(result.size).toBe(0);
  });
});
