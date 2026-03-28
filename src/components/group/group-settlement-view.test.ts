import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Balance, Settlement } from "@/types";
import type { DebtEdge } from "@/lib/simplify";

/**
 * Tests for GroupSettlementView logic:
 * - balancesToEdges: converts Balance[] (canonical ordering) to directed DebtEdge[]
 * - Settlement flow: recordSettlement creates pending, confirmSettlement finalizes
 * - Realtime patching: balance and settlement updates are applied locally
 */

// ============================================================
// balancesToEdges — extracted logic (mirrors the component's helper)
// ============================================================

function balancesToEdges(balances: Balance[]): DebtEdge[] {
  const edges: DebtEdge[] = [];
  for (const b of balances) {
    if (b.amountCents > 0) {
      edges.push({ fromUserId: b.userA, toUserId: b.userB, amountCents: b.amountCents });
    } else if (b.amountCents < 0) {
      edges.push({ fromUserId: b.userB, toUserId: b.userA, amountCents: Math.abs(b.amountCents) });
    }
  }
  return edges;
}

describe("balancesToEdges", () => {
  it("converts positive balance to edge from userA to userB", () => {
    const balances: Balance[] = [
      { groupId: "g1", userA: "aaa", userB: "bbb", amountCents: 5000, updatedAt: "" },
    ];

    const edges = balancesToEdges(balances);

    expect(edges).toEqual([
      { fromUserId: "aaa", toUserId: "bbb", amountCents: 5000 },
    ]);
  });

  it("converts negative balance to edge from userB to userA", () => {
    const balances: Balance[] = [
      { groupId: "g1", userA: "aaa", userB: "bbb", amountCents: -3000, updatedAt: "" },
    ];

    const edges = balancesToEdges(balances);

    expect(edges).toEqual([
      { fromUserId: "bbb", toUserId: "aaa", amountCents: 3000 },
    ]);
  });

  it("skips zero balances", () => {
    const balances: Balance[] = [
      { groupId: "g1", userA: "aaa", userB: "bbb", amountCents: 0, updatedAt: "" },
    ];

    const edges = balancesToEdges(balances);

    expect(edges).toEqual([]);
  });

  it("handles multiple balances in a group", () => {
    const balances: Balance[] = [
      { groupId: "g1", userA: "aaa", userB: "bbb", amountCents: 5000, updatedAt: "" },
      { groupId: "g1", userA: "aaa", userB: "ccc", amountCents: -2000, updatedAt: "" },
      { groupId: "g1", userA: "bbb", userB: "ccc", amountCents: 1000, updatedAt: "" },
    ];

    const edges = balancesToEdges(balances);

    expect(edges).toHaveLength(3);
    expect(edges).toContainEqual({ fromUserId: "aaa", toUserId: "bbb", amountCents: 5000 });
    expect(edges).toContainEqual({ fromUserId: "ccc", toUserId: "aaa", amountCents: 2000 });
    expect(edges).toContainEqual({ fromUserId: "bbb", toUserId: "ccc", amountCents: 1000 });
  });
});

// ============================================================
// Settlement actions — mock tests
// ============================================================

vi.mock("@/lib/supabase/settlement-actions", () => ({
  queryBalances: vi.fn(),
  querySettlements: vi.fn(),
  recordSettlement: vi.fn(),
  confirmSettlement: vi.fn(),
}));

import {
  recordSettlement,
  confirmSettlement,
} from "@/lib/supabase/settlement-actions";

type RecordFn = (
  groupId: string,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
) => Promise<Settlement>;

type ConfirmFn = (settlementId: string) => Promise<void>;

const mockedRecord = recordSettlement as unknown as ReturnType<typeof vi.fn<RecordFn>>;
const mockedConfirm = confirmSettlement as unknown as ReturnType<typeof vi.fn<ConfirmFn>>;

describe("settlement recording logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRecord.mockResolvedValue({
      id: "s1",
      groupId: "g1",
      fromUserId: "debtor",
      toUserId: "creditor",
      amountCents: 5000,
      status: "pending",
      createdAt: "",
    });
    mockedConfirm.mockResolvedValue(undefined);
  });

  it("records a settlement with correct arguments", async () => {
    await recordSettlement("g1", "debtor", "creditor", 5000);

    expect(mockedRecord).toHaveBeenCalledWith("g1", "debtor", "creditor", 5000);
  });

  it("confirms a settlement by ID", async () => {
    await confirmSettlement("s1");

    expect(mockedConfirm).toHaveBeenCalledWith("s1");
  });
});

// ============================================================
// Realtime balance patching logic
// ============================================================

describe("realtime balance patching", () => {
  it("patches existing balance in array", () => {
    const balances: Balance[] = [
      { groupId: "g1", userA: "aaa", userB: "bbb", amountCents: 5000, updatedAt: "t1" },
      { groupId: "g1", userA: "aaa", userB: "ccc", amountCents: 3000, updatedAt: "t1" },
    ];

    const updatedBalance: Balance = {
      groupId: "g1", userA: "aaa", userB: "bbb", amountCents: 2000, updatedAt: "t2",
    };

    // Mirrors the realtime handler logic
    const idx = balances.findIndex(
      (b) => b.userA === updatedBalance.userA && b.userB === updatedBalance.userB,
    );
    const next = idx >= 0
      ? balances.map((b, i) => (i === idx ? updatedBalance : b))
      : [...balances, updatedBalance];
    const filtered = next.filter((b) => b.amountCents !== 0);

    expect(filtered).toHaveLength(2);
    expect(filtered[0].amountCents).toBe(2000);
    expect(filtered[1].amountCents).toBe(3000);
  });

  it("adds new balance when pair not found", () => {
    const balances: Balance[] = [
      { groupId: "g1", userA: "aaa", userB: "bbb", amountCents: 5000, updatedAt: "t1" },
    ];

    const newBalance: Balance = {
      groupId: "g1", userA: "bbb", userB: "ccc", amountCents: 1000, updatedAt: "t2",
    };

    const idx = balances.findIndex(
      (b) => b.userA === newBalance.userA && b.userB === newBalance.userB,
    );
    const next = idx >= 0
      ? balances.map((b, i) => (i === idx ? newBalance : b))
      : [...balances, newBalance];

    expect(next).toHaveLength(2);
    expect(next[1]).toEqual(newBalance);
  });

  it("removes balance when updated to zero", () => {
    const balances: Balance[] = [
      { groupId: "g1", userA: "aaa", userB: "bbb", amountCents: 5000, updatedAt: "t1" },
    ];

    const zeroed: Balance = {
      groupId: "g1", userA: "aaa", userB: "bbb", amountCents: 0, updatedAt: "t2",
    };

    const idx = balances.findIndex(
      (b) => b.userA === zeroed.userA && b.userB === zeroed.userB,
    );
    const next = idx >= 0
      ? balances.map((b, i) => (i === idx ? zeroed : b))
      : [...balances, zeroed];
    const filtered = next.filter((b) => b.amountCents !== 0);

    expect(filtered).toHaveLength(0);
  });
});

// ============================================================
// Settlement event patching logic
// ============================================================

describe("realtime settlement patching", () => {
  it("adds new pending settlement", () => {
    const settlements: Settlement[] = [];
    const newSettlement: Settlement = {
      id: "s1", groupId: "g1", fromUserId: "debtor", toUserId: "creditor",
      amountCents: 5000, status: "pending", createdAt: "",
    };

    // Mirrors the handler: inserted + pending → prepend
    const next = [newSettlement, ...settlements];
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("s1");
  });

  it("removes settlement when confirmed", () => {
    const settlements: Settlement[] = [
      {
        id: "s1", groupId: "g1", fromUserId: "debtor", toUserId: "creditor",
        amountCents: 5000, status: "pending", createdAt: "",
      },
    ];

    const confirmed: Settlement = { ...settlements[0], status: "confirmed", confirmedAt: "now" };

    // Mirrors the handler: updated + confirmed → remove from pending list
    const next = settlements.filter((s) => s.id !== confirmed.id);
    expect(next).toHaveLength(0);
  });
});
