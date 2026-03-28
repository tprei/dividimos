import { describe, expect, it } from "vitest";
import { makeLedgerEntry } from "@/test/fixtures";
import { userAlice, userBob, userCarlos } from "@/test/fixtures";
import { computeGroupNetEdges } from "./group-settlement";

const participants = [userAlice, userBob, userCarlos];

describe("computeGroupNetEdges", () => {
  it("returns empty array for no entries", () => {
    expect(computeGroupNetEdges([], participants)).toEqual([]);
  });

  it("returns empty array when all entries are settled", () => {
    const entries = [
      makeLedgerEntry({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000, status: "settled" }),
      makeLedgerEntry({ id: "l2", fromUserId: "user-carlos", toUserId: "user-alice", amountCents: 3000, status: "settled" }),
    ];
    expect(computeGroupNetEdges(entries, participants)).toEqual([]);
  });

  it("produces one edge for a single pending entry", () => {
    const entries = [makeLedgerEntry({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 })];
    const edges = computeGroupNetEdges(entries, participants);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 });
  });

  it("excludes settled entries and keeps pending ones", () => {
    const entries = [
      makeLedgerEntry({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000, status: "settled" }),
      makeLedgerEntry({ id: "l2", fromUserId: "user-bob", toUserId: "user-alice", amountCents: 3000, status: "pending" }),
    ];
    const edges = computeGroupNetEdges(entries, participants);
    expect(edges).toHaveLength(1);
    expect(edges[0].amountCents).toBe(3000);
  });

  it("uses remaining balance for partially_paid entries", () => {
    const entries = [
      makeLedgerEntry({
        fromUserId: "user-bob",
        toUserId: "user-alice",
        amountCents: 10000,
        paidAmountCents: 3000,
        status: "partially_paid",
      }),
    ];
    const edges = computeGroupNetEdges(entries, participants);
    expect(edges).toHaveLength(1);
    expect(edges[0].amountCents).toBe(7000);
  });

  it("skips fully-paid partially_paid entries (remaining is zero)", () => {
    const entries = [
      makeLedgerEntry({
        fromUserId: "user-bob",
        toUserId: "user-alice",
        amountCents: 5000,
        paidAmountCents: 5000,
        status: "partially_paid",
      }),
    ];
    const edges = computeGroupNetEdges(entries, participants);
    expect(edges).toHaveLength(0);
  });

  it("nets partially_paid remaining balances correctly", () => {
    const entries = [
      makeLedgerEntry({
        fromUserId: "user-bob",
        toUserId: "user-alice",
        amountCents: 10000,
        paidAmountCents: 3000,
        status: "partially_paid",
      }),
      makeLedgerEntry({
        id: "l2",
        fromUserId: "user-alice",
        toUserId: "user-bob",
        amountCents: 6000,
        paidAmountCents: 2000,
        status: "partially_paid",
      }),
    ];
    const edges = computeGroupNetEdges(entries, participants);
    expect(edges).toHaveLength(1);
    // Bob owes Alice 7000 remaining, Alice owes Bob 4000 remaining
    // Net: Bob owes Alice 3000
    expect(edges[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 3000 });
  });

  it("aggregates multiple entries in same direction", () => {
    const entries = [
      makeLedgerEntry({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 3000 }),
      makeLedgerEntry({ id: "l2", fromUserId: "user-bob", toUserId: "user-alice", amountCents: 2000 }),
    ];
    const edges = computeGroupNetEdges(entries, participants);
    expect(edges).toHaveLength(1);
    expect(edges[0].amountCents).toBe(5000);
  });

  it("nets bidirectional entries", () => {
    const entries = [
      makeLedgerEntry({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 }),
      makeLedgerEntry({ id: "l2", fromUserId: "user-alice", toUserId: "user-bob", amountCents: 3000 }),
    ];
    const edges = computeGroupNetEdges(entries, participants);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 2000 });
  });

  it("handles three-person greedy matching", () => {
    // Alice owes 10000 total: 6000 to Bob, 4000 to Carlos
    const entries = [
      makeLedgerEntry({ fromUserId: "user-alice", toUserId: "user-bob", amountCents: 6000 }),
      makeLedgerEntry({ id: "l2", fromUserId: "user-alice", toUserId: "user-carlos", amountCents: 4000 }),
    ];
    const edges = computeGroupNetEdges(entries, participants);
    expect(edges).toHaveLength(2);
    const total = edges.reduce((s, e) => s + e.amountCents, 0);
    expect(total).toBe(10000);
  });

  it("ignores 1-centavo balance (tolerance threshold)", () => {
    // Balance of exactly 1 centavo is within the tolerance and should be ignored
    const entries = [
      makeLedgerEntry({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 }),
      makeLedgerEntry({ id: "l2", fromUserId: "user-alice", toUserId: "user-bob", amountCents: 4999 }),
    ];
    const edges = computeGroupNetEdges(entries, participants);
    // Net balance is 1 centavo which is <= 1, so no edges
    expect(edges).toHaveLength(0);
  });
});
