import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase client module
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockEq = vi.fn();
const mockNeq = vi.fn();
const mockOr = vi.fn();
const mockOrder = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockRpc = vi.fn();

function createChain() {
  const chain = {
    select: mockSelect,
    insert: mockInsert,
    eq: mockEq,
    neq: mockNeq,
    or: mockOr,
    order: mockOrder,
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
  };
  // Each method returns the chain for chaining
  for (const fn of Object.values(chain)) {
    fn.mockReturnValue(chain);
  }
  return chain;
}

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom, rpc: mockRpc };

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mockSupabase,
}));

import {
  queryBalances,
  queryBalanceBetween,
  recordSettlement,
  confirmSettlement,
  querySettlements,
  querySettlementHistoryForBalance,
  queryPendingSettlementsForUser,
} from "./settlement-actions";

describe("settlement-actions", () => {
  let chain: ReturnType<typeof createChain>;

  beforeEach(() => {
    vi.clearAllMocks();
    chain = createChain();
    mockFrom.mockReturnValue(chain);
  });

  describe("queryBalances", () => {
    it("queries non-zero balances for a group", async () => {
      const balanceRows = [
        {
          group_id: "g1",
          user_a: "u1",
          user_b: "u2",
          amount_cents: 5000,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ];
      chain.neq.mockReturnValue({ data: balanceRows, error: null });

      const result = await queryBalances("g1");

      expect(mockFrom).toHaveBeenCalledWith("balances");
      expect(mockSelect).toHaveBeenCalledWith("*");
      expect(mockEq).toHaveBeenCalledWith("group_id", "g1");
      expect(mockNeq).toHaveBeenCalledWith("amount_cents", 0);
      expect(result).toEqual([
        {
          groupId: "g1",
          userA: "u1",
          userB: "u2",
          amountCents: 5000,
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ]);
    });

    it("throws on error", async () => {
      chain.neq.mockReturnValue({
        data: null,
        error: { message: "DB error" },
      });

      await expect(queryBalances("g1")).rejects.toThrow(
        "Failed to query balances: DB error",
      );
    });
  });

  describe("queryBalanceBetween", () => {
    it("orders user IDs canonically", async () => {
      chain.maybeSingle.mockReturnValue({ data: null, error: null });

      await queryBalanceBetween("g1", "zzz", "aaa");

      // Should be called with aaa first (canonical ordering)
      const eqCalls = mockEq.mock.calls;
      expect(eqCalls).toContainEqual(["user_a", "aaa"]);
      expect(eqCalls).toContainEqual(["user_b", "zzz"]);
    });

    it("returns null when no balance exists", async () => {
      chain.maybeSingle.mockReturnValue({ data: null, error: null });

      const result = await queryBalanceBetween("g1", "u1", "u2");
      expect(result).toBeNull();
    });

    it("maps row to Balance type", async () => {
      chain.maybeSingle.mockReturnValue({
        data: {
          group_id: "g1",
          user_a: "u1",
          user_b: "u2",
          amount_cents: -3000,
          updated_at: "2026-02-01T00:00:00Z",
        },
        error: null,
      });

      const result = await queryBalanceBetween("g1", "u1", "u2");
      expect(result).toEqual({
        groupId: "g1",
        userA: "u1",
        userB: "u2",
        amountCents: -3000,
        updatedAt: "2026-02-01T00:00:00Z",
      });
    });
  });

  describe("recordSettlement", () => {
    it("inserts a settlement and returns mapped result", async () => {
      const row = {
        id: "s1",
        group_id: "g1",
        from_user_id: "u1",
        to_user_id: "u2",
        amount_cents: 5000,
        status: "pending" as const,
        created_at: "2026-01-01T00:00:00Z",
        confirmed_at: null,
      };
      chain.single.mockReturnValue({ data: row, error: null });

      const result = await recordSettlement("g1", "u1", "u2", 5000);

      expect(mockInsert).toHaveBeenCalledWith({
        group_id: "g1",
        from_user_id: "u1",
        to_user_id: "u2",
        amount_cents: 5000,
      });
      expect(result).toEqual({
        id: "s1",
        groupId: "g1",
        fromUserId: "u1",
        toUserId: "u2",
        amountCents: 5000,
        status: "pending",
        createdAt: "2026-01-01T00:00:00Z",
        confirmedAt: undefined,
      });
    });

    it("rejects zero amount", async () => {
      await expect(recordSettlement("g1", "u1", "u2", 0)).rejects.toThrow(
        "Settlement amount must be positive",
      );
    });

    it("rejects negative amount", async () => {
      await expect(recordSettlement("g1", "u1", "u2", -100)).rejects.toThrow(
        "Settlement amount must be positive",
      );
    });

    it("rejects self-settlement", async () => {
      await expect(recordSettlement("g1", "u1", "u1", 5000)).rejects.toThrow(
        "Cannot settle with yourself",
      );
    });
  });

  describe("confirmSettlement", () => {
    it("calls confirm_settlement RPC", async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      await confirmSettlement("s1");

      expect(mockRpc).toHaveBeenCalledWith("confirm_settlement", {
        p_settlement_id: "s1",
      });
    });

    it("throws on RPC error", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "Not authorized" },
      });

      await expect(confirmSettlement("s1")).rejects.toThrow(
        "Failed to confirm settlement: Not authorized",
      );
    });
  });

  describe("querySettlements", () => {
    it("queries settlements ordered by created_at desc", async () => {
      chain.order.mockReturnValue({ data: [], error: null });

      await querySettlements("g1");

      expect(mockFrom).toHaveBeenCalledWith("settlements");
      expect(mockOrder).toHaveBeenCalledWith("created_at", {
        ascending: false,
      });
    });
  });

  describe("querySettlementHistoryForBalance", () => {
    it("queries settlements in both directions", async () => {
      chain.order.mockReturnValue({ data: [], error: null });

      await querySettlementHistoryForBalance("g1", "u1", "u2");

      expect(mockOr).toHaveBeenCalledWith(
        `and(from_user_id.eq.u1,to_user_id.eq.u2),and(from_user_id.eq.u2,to_user_id.eq.u1)`,
      );
    });
  });

  describe("queryPendingSettlementsForUser", () => {
    it("queries pending settlements where user is creditor", async () => {
      chain.order.mockReturnValue({ data: [], error: null });

      await queryPendingSettlementsForUser("g1", "u2");

      expect(mockEq).toHaveBeenCalledWith("to_user_id", "u2");
      expect(mockEq).toHaveBeenCalledWith("status", "pending");
    });
  });
});
