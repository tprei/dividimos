import { describe, expect, it } from "vitest";
import {
  ZERO_EXPENSE_CENTS,
  ZERO_SERVICE_FEE_BASIS_POINTS,
  brandExpenseCents,
  summarizeExpenseAllocations,
  validateExpenseMoney,
  type CompleteExpenseMoney,
  type ExpenseAllocationSummary,
} from "./expense-money";
import type {
  CanonicalGuestShareRow,
  CanonicalPayerRow,
  CanonicalShareRow,
  ParticipantOrderEntry,
} from "./expense-graph";

// Build a single_amount CompleteExpenseMoney with the given total (no fees).
function singleAmount(total: number): CompleteExpenseMoney {
  const totalCents = brandExpenseCents(total);
  return {
    expenseType: "single_amount",
    serviceFeeBasisPoints: ZERO_SERVICE_FEE_BASIS_POINTS,
    fixedFeesCents: ZERO_EXPENSE_CENTS,
    items: [],
    outcome: "complete",
    totalAmountCents: totalCents,
    summary: {
      itemsSubtotalCents: totalCents,
      serviceFeeCents: ZERO_EXPENSE_CENTS,
      fixedFeesCents: ZERO_EXPENSE_CENTS,
      totalAmountCents: totalCents,
    },
  };
}

function userEntry(userId: string): ParticipantOrderEntry {
  return { kind: "user", userId };
}
function guestEntry(guestLocalId: string): ParticipantOrderEntry {
  return { kind: "guest", guestLocalId };
}
function share(userId: string, cents: number): CanonicalShareRow {
  return { userId, shareAmountCents: brandExpenseCents(cents) };
}
function guestShare(guestLocalId: string, cents: number): CanonicalGuestShareRow {
  return { guestLocalId, shareAmountCents: brandExpenseCents(cents) };
}
function payer(userId: string, cents: number): CanonicalPayerRow {
  return { userId, amountCents: brandExpenseCents(cents) };
}

describe("summarizeExpenseAllocations — identity/order", () => {
  it("rejects a duplicate participant-order entry", () => {
    const r = summarizeExpenseAllocations({
      money: singleAmount(100),
      participantOrder: [userEntry("a"), userEntry("a")],
      shares: [share("a", 100)],
      guestShares: [],
      payers: [],
      itemAssignments: { kind: "aggregate_only" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue).toMatchObject({ code: "invalid_allocation_identity", reason: "participant_order" });
    }
  });

  it("rejects a user participant with no matching share (and vice versa)", () => {
    const r = summarizeExpenseAllocations({
      money: singleAmount(100),
      participantOrder: [userEntry("a"), userEntry("b")],
      shares: [share("a", 100)],
      guestShares: [],
      payers: [],
      itemAssignments: { kind: "aggregate_only" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue).toMatchObject({ code: "invalid_allocation_identity", reason: "share" });
    }
  });

  it("rejects an unknown/ungrouped payer as ineligible_payer with its index", () => {
    const r = summarizeExpenseAllocations({
      money: singleAmount(100),
      participantOrder: [userEntry("a")],
      shares: [share("a", 100)],
      guestShares: [],
      payers: [payer("ghost", 100)],
      itemAssignments: { kind: "aggregate_only" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue).toMatchObject({ code: "ineligible_payer", payerIndex: 0 });
    }
  });

  it("rejects duplicate payer rows before their amounts are aggregated", () => {
    const r = summarizeExpenseAllocations({
      money: singleAmount(100),
      participantOrder: [userEntry("a"), userEntry("b")],
      shares: [share("a", 60), share("b", 40)],
      guestShares: [],
      payers: [payer("a", 40), payer("a", 60)],
      itemAssignments: { kind: "aggregate_only" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue).toMatchObject({ code: "duplicate_payer", payerIndex: 1 });
    }
  });

  it("rejects a guest identity as an ineligible payer", () => {
    const r = summarizeExpenseAllocations({
      money: singleAmount(100),
      participantOrder: [userEntry("a"), guestEntry("g1")],
      shares: [share("a", 0)],
      guestShares: [guestShare("g1", 100)],
      payers: [payer("g1", 100)],
      itemAssignments: { kind: "aggregate_only" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue).toMatchObject({ code: "ineligible_payer", payerIndex: 0 });
    }
  });
});

describe("summarizeExpenseAllocations — aggregate_only completeness", () => {
  const order = [userEntry("a"), userEntry("b")];

  it("is complete when shares and payers each equal the total exactly", () => {
    const r = summarizeExpenseAllocations({
      money: singleAmount(100),
      participantOrder: order,
      shares: [share("a", 60), share("b", 40)],
      guestShares: [],
      payers: [payer("a", 100)],
      itemAssignments: { kind: "aggregate_only" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const s = r.value as ExpenseAllocationSummary;
      expect(s.shareState).toBe("exact");
      expect(s.payerState).toBe("exact");
      expect(s.completeness).toBe("complete");
      expect(s.shareDeltaCents as number).toBe(0);
      expect(s.payerDeltaCents as number).toBe(0);
    }
  });

  it("is incomplete (not invalid) for a one-cent underallocation", () => {
    const r = summarizeExpenseAllocations({
      money: singleAmount(100),
      participantOrder: order,
      shares: [share("a", 60), share("b", 39)],
      guestShares: [],
      payers: [payer("a", 100)],
      itemAssignments: { kind: "aggregate_only" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.value as ExpenseAllocationSummary).completeness).toBe("incomplete");
      expect((r.value as ExpenseAllocationSummary).shareState).toBe("underallocated");
    }
  });

  it("is invalid for a one-cent overallocation", () => {
    const r = summarizeExpenseAllocations({
      money: singleAmount(100),
      participantOrder: order,
      shares: [share("a", 60), share("b", 41)],
      guestShares: [],
      payers: [payer("a", 100)],
      itemAssignments: { kind: "aggregate_only" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.value as ExpenseAllocationSummary).completeness).toBe("invalid");
      expect((r.value as ExpenseAllocationSummary).shareState).toBe("overallocated");
    }
  });

  it("combines user and guest shares into shareTotalCents", () => {
    const r = summarizeExpenseAllocations({
      money: singleAmount(100),
      participantOrder: [userEntry("a"), guestEntry("g1")],
      shares: [share("a", 40)],
      guestShares: [guestShare("g1", 60)],
      payers: [payer("a", 100)],
      itemAssignments: { kind: "aggregate_only" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const s = r.value as ExpenseAllocationSummary;
      expect(s.userShareTotalCents as number).toBe(40);
      expect(s.guestShareTotalCents as number).toBe(60);
      expect(s.shareTotalCents as number).toBe(100);
      expect(s.completeness).toBe("complete");
    }
  });
});

describe("summarizeExpenseAllocations — detailed item assignment", () => {
  it("rejects itemIds length mismatch against money.items", () => {
    const money = validateExpenseMoney(
      {
        expenseType: "itemized",
        totalAmountCents: 100,
        serviceFeeBasisPoints: 0,
        fixedFeesCents: 0,
        items: [
          { description: "x", quantity: 1, unitPriceCents: 100, totalPriceCents: 100 },
        ],
      },
      "draft",
    );
    expect(money.ok).toBe(true);
    if (!money.ok) return;
    const r = summarizeExpenseAllocations({
      money: money.value,
      participantOrder: [userEntry("a")],
      shares: [share("a", 100)],
      guestShares: [],
      payers: [payer("a", 100)],
      itemAssignments: { kind: "detailed", itemIds: ["i1", "i2"], rows: [] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue).toMatchObject({ code: "invalid_item_assignment", reason: "item_ids" });
    }
  });
});

describe("summarizeExpenseAllocations — immutability", () => {
  it("returns a frozen summary that cannot be mutated", () => {
    const r = summarizeExpenseAllocations({
      money: singleAmount(100),
      participantOrder: [userEntry("a"), userEntry("b")],
      shares: [share("a", 60), share("b", 40)],
      guestShares: [],
      payers: [payer("a", 100)],
      itemAssignments: { kind: "aggregate_only" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.value as ExpenseAllocationSummary;
    expect(Object.isFrozen(s)).toBe(true);
    expect(() => {
      (s as { shareTotalCents: number }).shareTotalCents = 999;
    }).toThrow();
    expect(s.shareTotalCents as number).toBe(100);
  });
});
