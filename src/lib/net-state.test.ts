import { describe, expect, it } from "vitest";
import { userAlice, userBob, userCarlos } from "@/test/fixtures";
import type { LedgerEntry } from "@/types";
import {
  computeBillDebtView,
  computeGroupNetEdgesDetailed,
  computeGroupNetState,
  computeGroupNetStateFromEvents,
} from "./net-state";

const participants = [userAlice, userBob, userCarlos];
const twoParticipants = [userAlice, userBob];

function makeDebtEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "entry-1",
    billId: "bill-1",
    entryType: "debt",
    fromUserId: "user-bob",
    toUserId: "user-alice",
    amountCents: 5000,
    paidAmountCents: 0,
    status: "pending",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePaymentEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "payment-1",
    entryType: "payment",
    fromUserId: "user-bob",
    toUserId: "user-alice",
    amountCents: 5000,
    paidAmountCents: 0,
    status: "pending",
    createdAt: "2024-01-02T00:00:00Z",
    ...overrides,
  };
}

// ---------- computeGroupNetState ----------

describe("computeGroupNetState", () => {
  it("returns single edge for one pending debt", () => {
    const entries = [makeDebtEntry()];
    const edges = computeGroupNetState(entries, twoParticipants);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      fromUserId: "user-bob",
      toUserId: "user-alice",
      amountCents: 5000,
    });
  });

  it("returns empty for fully settled debt", () => {
    const entries = [
      makeDebtEntry({ status: "settled", paidAmountCents: 5000 }),
    ];
    const edges = computeGroupNetState(entries, twoParticipants);
    expect(edges).toHaveLength(0);
  });

  it("accounts for partial payments via paidAmountCents", () => {
    const entries = [
      makeDebtEntry({ paidAmountCents: 2000, status: "partially_paid" }),
    ];
    const edges = computeGroupNetState(entries, twoParticipants);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      fromUserId: "user-bob",
      toUserId: "user-alice",
      amountCents: 3000,
    });
  });

  it("nets opposing debts between two users", () => {
    const entries = [
      makeDebtEntry({ id: "e1", billId: "bill-1", fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 }),
      makeDebtEntry({ id: "e2", billId: "bill-2", fromUserId: "user-alice", toUserId: "user-bob", amountCents: 3000 }),
    ];
    const edges = computeGroupNetState(entries, twoParticipants);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      fromUserId: "user-bob",
      toUserId: "user-alice",
      amountCents: 2000,
    });
  });

  it("simplifies three-way debts into minimal edges", () => {
    // Alice owes Bob 100, Bob owes Carlos 100 → Alice owes Carlos 100
    const entries = [
      makeDebtEntry({ id: "e1", fromUserId: "user-alice", toUserId: "user-bob", amountCents: 10000 }),
      makeDebtEntry({ id: "e2", fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 10000 }),
    ];
    const edges = computeGroupNetState(entries, participants);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      fromUserId: "user-alice",
      toUserId: "user-carlos",
      amountCents: 10000,
    });
  });

  it("handles multiple bills across the same group", () => {
    const entries = [
      makeDebtEntry({ id: "e1", billId: "bill-1", fromUserId: "user-bob", toUserId: "user-alice", amountCents: 3000 }),
      makeDebtEntry({ id: "e2", billId: "bill-2", fromUserId: "user-bob", toUserId: "user-alice", amountCents: 2000 }),
    ];
    const edges = computeGroupNetState(entries, twoParticipants);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      fromUserId: "user-bob",
      toUserId: "user-alice",
      amountCents: 5000,
    });
  });

  it("returns empty when all debts cancel out", () => {
    const entries = [
      makeDebtEntry({ id: "e1", fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 }),
      makeDebtEntry({ id: "e2", fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 }),
    ];
    const edges = computeGroupNetState(entries, twoParticipants);
    expect(edges).toHaveLength(0);
  });

  it("ignores payment entries (payments reflected in paidAmountCents)", () => {
    const entries = [
      makeDebtEntry({ paidAmountCents: 2000, status: "partially_paid" }),
      makePaymentEntry({ amountCents: 2000 }),
    ];
    const edges = computeGroupNetState(entries, twoParticipants);
    // Should only see remaining 3000, not double-count the payment
    expect(edges).toHaveLength(1);
    expect(edges[0].amountCents).toBe(3000);
  });

  it("handles empty entries", () => {
    const edges = computeGroupNetState([], twoParticipants);
    expect(edges).toHaveLength(0);
  });

  it("tolerates rounding (amounts <= 1 centavo treated as zero)", () => {
    const entries = [
      makeDebtEntry({ id: "e1", fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5001 }),
      makeDebtEntry({ id: "e2", fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 }),
    ];
    const edges = computeGroupNetState(entries, twoParticipants);
    // 1 centavo difference is below the threshold
    expect(edges).toHaveLength(0);
  });
});

// ---------- computeGroupNetStateFromEvents ----------

describe("computeGroupNetStateFromEvents", () => {
  it("derives state purely from debt and payment events", () => {
    const entries = [
      makeDebtEntry({ amountCents: 5000, paidAmountCents: 0 }),
      makePaymentEntry({ amountCents: 2000 }),
    ];
    const edges = computeGroupNetStateFromEvents(entries, twoParticipants);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      fromUserId: "user-bob",
      toUserId: "user-alice",
      amountCents: 3000,
    });
  });

  it("returns empty when payment covers full debt", () => {
    const entries = [
      makeDebtEntry({ amountCents: 5000 }),
      makePaymentEntry({ amountCents: 5000 }),
    ];
    const edges = computeGroupNetStateFromEvents(entries, twoParticipants);
    expect(edges).toHaveLength(0);
  });

  it("handles overpayment (creditor becomes debtor)", () => {
    const entries = [
      makeDebtEntry({ amountCents: 3000 }),
      makePaymentEntry({ amountCents: 5000 }),
    ];
    const edges = computeGroupNetStateFromEvents(entries, twoParticipants);
    expect(edges).toHaveLength(1);
    // Bob overpaid by 2000, so Alice now owes Bob
    expect(edges[0]).toMatchObject({
      fromUserId: "user-alice",
      toUserId: "user-bob",
      amountCents: 2000,
    });
  });

  it("ignores paidAmountCents field (uses only entry amounts)", () => {
    // paidAmountCents says 2000 but no payment entry exists
    const entries = [
      makeDebtEntry({ amountCents: 5000, paidAmountCents: 2000 }),
    ];
    const edges = computeGroupNetStateFromEvents(entries, twoParticipants);
    // Should use full 5000, not 3000
    expect(edges[0].amountCents).toBe(5000);
  });
});

// ---------- computeBillDebtView ----------

describe("computeBillDebtView", () => {
  it("returns debt entries for the specified bill", () => {
    const entries = [
      makeDebtEntry({ id: "e1", billId: "bill-1" }),
      makeDebtEntry({ id: "e2", billId: "bill-2" }),
    ];
    const view = computeBillDebtView(entries, "bill-1");
    expect(view).toHaveLength(1);
    expect(view[0].ledgerEntryId).toBe("e1");
  });

  it("excludes payment entries", () => {
    const entries = [
      makeDebtEntry({ billId: "bill-1" }),
      makePaymentEntry({ billId: "bill-1" }),
    ];
    const view = computeBillDebtView(entries, "bill-1");
    expect(view).toHaveLength(1);
    expect(view[0].status).toBe("pending");
  });

  it("derives pending status correctly", () => {
    const entries = [makeDebtEntry({ amountCents: 5000, paidAmountCents: 0 })];
    const view = computeBillDebtView(entries, "bill-1");
    expect(view[0].status).toBe("pending");
  });

  it("derives partially_paid status correctly", () => {
    const entries = [makeDebtEntry({ amountCents: 5000, paidAmountCents: 2000 })];
    const view = computeBillDebtView(entries, "bill-1");
    expect(view[0].status).toBe("partially_paid");
  });

  it("derives paid_unconfirmed status correctly", () => {
    const entries = [makeDebtEntry({ amountCents: 5000, paidAmountCents: 5000 })];
    const view = computeBillDebtView(entries, "bill-1");
    expect(view[0].status).toBe("paid_unconfirmed");
  });

  it("derives settled status when confirmed", () => {
    const entries = [
      makeDebtEntry({
        amountCents: 5000,
        paidAmountCents: 5000,
        confirmedAt: "2024-01-03T00:00:00Z",
      }),
    ];
    const view = computeBillDebtView(entries, "bill-1");
    expect(view[0].status).toBe("settled");
  });

  it("returns empty for unknown bill", () => {
    const entries = [makeDebtEntry({ billId: "bill-1" })];
    const view = computeBillDebtView(entries, "bill-999");
    expect(view).toHaveLength(0);
  });

  it("returns multiple debts for multi-payer bills", () => {
    const entries = [
      makeDebtEntry({ id: "e1", billId: "bill-1", fromUserId: "user-bob", toUserId: "user-alice", amountCents: 3000 }),
      makeDebtEntry({ id: "e2", billId: "bill-1", fromUserId: "user-carlos", toUserId: "user-alice", amountCents: 2000 }),
    ];
    const view = computeBillDebtView(entries, "bill-1");
    expect(view).toHaveLength(2);
    expect(view.reduce((s, e) => s + e.amountCents, 0)).toBe(5000);
  });
});

// ---------- computeGroupNetEdgesDetailed ----------

describe("computeGroupNetEdgesDetailed", () => {
  it("returns detailed edges with status", () => {
    const entries = [makeDebtEntry()];
    const edges = computeGroupNetEdgesDetailed(entries, twoParticipants);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      fromUserId: "user-bob",
      toUserId: "user-alice",
      amountCents: 5000,
      paidAmountCents: 0,
      status: "pending",
    });
  });

  it("nets opposing pairs", () => {
    const entries = [
      makeDebtEntry({ id: "e1", fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 }),
      makeDebtEntry({ id: "e2", fromUserId: "user-alice", toUserId: "user-bob", amountCents: 3000 }),
    ];
    const edges = computeGroupNetEdgesDetailed(entries, twoParticipants);
    expect(edges).toHaveLength(1);
    expect(edges[0].amountCents).toBe(2000);
  });

  it("accounts for payments in netting", () => {
    const entries = [
      makeDebtEntry({ id: "e1", fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000, paidAmountCents: 2000 }),
    ];
    const edges = computeGroupNetEdgesDetailed(entries, twoParticipants);
    expect(edges).toHaveLength(1);
    expect(edges[0].amountCents).toBe(3000);
  });

  it("returns empty when pairs cancel out", () => {
    const entries = [
      makeDebtEntry({ id: "e1", fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 }),
      makeDebtEntry({ id: "e2", fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 }),
    ];
    const edges = computeGroupNetEdgesDetailed(entries, twoParticipants);
    expect(edges).toHaveLength(0);
  });

  it("filters out non-participant entries", () => {
    const entries = [
      makeDebtEntry({ fromUserId: "user-unknown", toUserId: "user-alice", amountCents: 5000 }),
    ];
    const edges = computeGroupNetEdgesDetailed(entries, twoParticipants);
    expect(edges).toHaveLength(0);
  });
});
