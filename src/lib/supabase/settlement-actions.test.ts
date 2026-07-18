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
  getSettlementOperation,
  queryBalanceBetween,
  queryBalances,
  querySettlementHistoryForBalance,
  querySettlements,
  recordSettlements,
  SettlementOperationConflictError,
  SettlementOperationCorruptError,
  SettlementOutcomeUnknownError,
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

  describe("settlement operation RPCs", () => {
    const operationId = "11111111-1111-1111-1111-111111111111";
    const groupId = "22222222-2222-2222-2222-222222222222";
    const debtorId = "33333333-3333-3333-3333-333333333333";
    const creditorId = "44444444-4444-4444-4444-444444444444";
    const settlementId = "55555555-5555-5555-5555-555555555555";
    const allocation = {
      groupId,
      fromUserId: debtorId,
      toUserId: creditorId,
      amountCents: 5000,
    };
    const responseRow = {
      allocation_index: 0,
      settlement_id: settlementId,
      group_id: groupId,
      from_user_id: debtorId,
      to_user_id: creditorId,
      amount_cents: 5000,
      status: "confirmed",
      created_at: "2026-07-16T00:00:00Z",
      confirmed_at: "2026-07-16T00:00:01Z",
      was_replay: false,
    };

    it("calls record_settlements once with exact snake-case arguments", async () => {
      mockRpc.mockResolvedValue({ data: [responseRow], error: null });

      const result = await recordSettlements({ operationId, allocations: [allocation] });

      expect(mockRpc).toHaveBeenCalledTimes(1);
      expect(mockRpc).toHaveBeenCalledWith("record_settlements", {
        p_operation_id: operationId,
        p_allocations: [
          {
            group_id: groupId,
            from_user_id: debtorId,
            to_user_id: creditorId,
            amount_cents: 5000,
          },
        ],
      });
      expect(result).toEqual({
        operationId,
        settlements: [
          {
            id: settlementId,
            groupId,
            fromUserId: debtorId,
            toUserId: creditorId,
            amountCents: 5000,
            status: "confirmed",
            createdAt: "2026-07-16T00:00:00Z",
            confirmedAt: "2026-07-16T00:00:01Z",
          },
        ],
        replayed: false,
      });
    });

    it("orders canonical response rows by allocation index", async () => {
      const lowerDebtorId = "22222222-1111-1111-1111-111111111111";
      const lowerSettlementId = "66666666-6666-6666-6666-666666666666";
      const lowerAllocation = {
        groupId,
        fromUserId: lowerDebtorId,
        toUserId: creditorId,
        amountCents: 2500,
      };
      mockRpc.mockResolvedValue({
        data: [
          {
            ...responseRow,
            from_user_id: lowerDebtorId,
            amount_cents: 2500,
            settlement_id: lowerSettlementId,
          },
          { ...responseRow, allocation_index: 1 },
        ],
        error: null,
      });

      const result = await recordSettlements({
        operationId,
        allocations: [allocation, lowerAllocation],
      });

      expect(result.settlements.map((settlement) => settlement.id)).toEqual([
        lowerSettlementId,
        settlementId,
      ]);
    });

    it("rejects invalid local requests before RPC invocation", async () => {
      await expect(
        recordSettlements({ operationId, allocations: [] }),
      ).rejects.toThrow("at least one allocation");
      await expect(
        recordSettlements({
          operationId,
          allocations: [{ ...allocation, fromUserId: creditorId }],
        }),
      ).rejects.toThrow("Cannot settle with yourself");
      await expect(
        recordSettlements({
          operationId,
          allocations: [allocation, { ...allocation, amountCents: 6000 }],
        }),
      ).rejects.toThrow("duplicate directed edges");
      await expect(
        recordSettlements({
          operationId,
          allocations: [{ ...allocation, amountCents: Number.MAX_SAFE_INTEGER + 1 }],
        }),
      ).rejects.toThrow("positive safe integer");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("maps stable database rejections without message matching", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: "PST10", message: "different payload" },
      });

      await expect(
        recordSettlements({ operationId, allocations: [allocation] }),
      ).rejects.toBeInstanceOf(SettlementOperationConflictError);
    });

    it("maps other SQLSTATE failures to definitive database rejections", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: "PST13", message: "invalid amount" },
      });

      await expect(
        recordSettlements({ operationId, allocations: [allocation] }),
      ).rejects.toMatchObject({
        sqlstate: "PST13",
        category: "invalid_amount",
      });
    });

    it("treats transport and gateway failures as outcome unknown", async () => {
      mockRpc.mockRejectedValueOnce(new Error("network unavailable"));

      await expect(
        recordSettlements({ operationId, allocations: [allocation] }),
      ).rejects.toBeInstanceOf(SettlementOutcomeUnknownError);

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST301", message: "gateway failure" },
      });

      await expect(
        recordSettlements({ operationId, allocations: [allocation] }),
      ).rejects.toBeInstanceOf(SettlementOutcomeUnknownError);
    });

    it("treats malformed success rows as outcome unknown", async () => {
      mockRpc.mockResolvedValue({
        data: [{ ...responseRow, was_replay: "false" }],
        error: null,
      });

      await expect(
        recordSettlements({ operationId, allocations: [allocation] }),
      ).rejects.toBeInstanceOf(SettlementOutcomeUnknownError);
    });

    it("maps zero-row operation reconciliation to null", async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await expect(getSettlementOperation(operationId)).resolves.toBeNull();
      expect(mockRpc).toHaveBeenCalledWith("get_settlement_operation", {
        p_operation_id: operationId,
      });
    });

    it("propagates operation corruption from reconciliation", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: "PST12", message: "operation is corrupt" },
      });

      await expect(getSettlementOperation(operationId)).rejects.toBeInstanceOf(
        SettlementOperationCorruptError,
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

});
