import { describe, expect, it } from "vitest";
import { makeExpenseShare } from "@/test/fixtures";
import { userAlice, userBob, userCarlos } from "@/test/fixtures";
import { computeGroupNetEdges } from "./group-settlement";

const participants = [userAlice, userBob, userCarlos];

describe("computeGroupNetEdges", () => {
  it("returns empty array for no shares", () => {
    expect(computeGroupNetEdges([], participants)).toEqual([]);
  });

  it("returns empty array when all shares are net-zero", () => {
    const shares = [
      makeExpenseShare({ userId: "user-bob", paidCents: 5000, owedCents: 5000, netCents: 0 }),
      makeExpenseShare({ userId: "user-alice", paidCents: 3000, owedCents: 3000, netCents: 0 }),
    ];
    expect(computeGroupNetEdges(shares, participants)).toEqual([]);
  });

  it("produces one edge for a simple debtor-creditor pair", () => {
    const shares = [
      makeExpenseShare({ userId: "user-alice", paidCents: 10000, owedCents: 5000, netCents: 5000 }),
      makeExpenseShare({ userId: "user-bob", paidCents: 0, owedCents: 5000, netCents: -5000 }),
    ];
    const edges = computeGroupNetEdges(shares, participants);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 });
  });

  it("aggregates net balances across multiple bills", () => {
    const shares = [
      makeExpenseShare({ billId: "bill-1", userId: "user-alice", paidCents: 10000, owedCents: 5000, netCents: 5000 }),
      makeExpenseShare({ billId: "bill-1", userId: "user-bob", paidCents: 0, owedCents: 5000, netCents: -5000 }),
      makeExpenseShare({ billId: "bill-2", userId: "user-alice", paidCents: 6000, owedCents: 3000, netCents: 3000 }),
      makeExpenseShare({ billId: "bill-2", userId: "user-bob", paidCents: 0, owedCents: 3000, netCents: -3000 }),
    ];
    const edges = computeGroupNetEdges(shares, participants);
    expect(edges).toHaveLength(1);
    expect(edges[0].amountCents).toBe(8000);
  });

  it("nets bidirectional debts across shares", () => {
    // Bill 1: Alice is creditor +5000, Bob is debtor -5000
    // Bill 2: Bob is creditor +3000, Alice is debtor -3000
    const shares = [
      makeExpenseShare({ billId: "bill-1", userId: "user-alice", paidCents: 10000, owedCents: 5000, netCents: 5000 }),
      makeExpenseShare({ billId: "bill-1", userId: "user-bob", paidCents: 0, owedCents: 5000, netCents: -5000 }),
      makeExpenseShare({ billId: "bill-2", userId: "user-bob", paidCents: 3000, owedCents: 0, netCents: 3000 }),
      makeExpenseShare({ billId: "bill-2", userId: "user-alice", paidCents: 0, owedCents: 3000, netCents: -3000 }),
    ];
    const edges = computeGroupNetEdges(shares, participants);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 2000 });
  });

  it("handles three-person greedy matching", () => {
    // Alice is creditor +10000 (6000+4000 from two bills)
    // Bob owes 6000, Carlos owes 4000
    const shares = [
      makeExpenseShare({ billId: "bill-1", userId: "user-alice", paidCents: 16000, owedCents: 6000, netCents: 10000 }),
      makeExpenseShare({ billId: "bill-1", userId: "user-bob", paidCents: 0, owedCents: 6000, netCents: -6000 }),
      makeExpenseShare({ billId: "bill-1", userId: "user-carlos", paidCents: 0, owedCents: 4000, netCents: -4000 }),
    ];
    const edges = computeGroupNetEdges(shares, participants);
    expect(edges).toHaveLength(2);
    const total = edges.reduce((s, e) => s + e.amountCents, 0);
    expect(total).toBe(10000);
  });

  it("ignores 1-centavo balance (tolerance threshold)", () => {
    const shares = [
      makeExpenseShare({ userId: "user-alice", paidCents: 5001, owedCents: 5000, netCents: 1 }),
      makeExpenseShare({ userId: "user-bob", paidCents: 4999, owedCents: 5000, netCents: -1 }),
    ];
    const edges = computeGroupNetEdges(shares, participants);
    expect(edges).toHaveLength(0);
  });

  it("handles payment shares correctly", () => {
    // Bob pays Alice 2000 via create_payment RPC
    // Bob gets paid_cents=2000, owed_cents=0 → net=+2000
    // Alice gets paid_cents=0, owed_cents=2000 → net=-2000
    // Combined with an existing debt: Alice owes Bob 5000
    const shares = [
      makeExpenseShare({ billId: "bill-1", userId: "user-alice", paidCents: 10000, owedCents: 5000, netCents: 5000 }),
      makeExpenseShare({ billId: "bill-1", userId: "user-bob", paidCents: 0, owedCents: 5000, netCents: -5000 }),
      makeExpenseShare({ billId: "payment-1", userId: "user-bob", paidCents: 2000, owedCents: 0, netCents: 2000 }),
      makeExpenseShare({ billId: "payment-1", userId: "user-alice", paidCents: 0, owedCents: 2000, netCents: -2000 }),
    ];
    const edges = computeGroupNetEdges(shares, participants);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 3000 });
  });

  it("returns empty when payments fully settle debts", () => {
    const shares = [
      makeExpenseShare({ billId: "bill-1", userId: "user-alice", paidCents: 5000, owedCents: 2500, netCents: 2500 }),
      makeExpenseShare({ billId: "bill-1", userId: "user-bob", paidCents: 0, owedCents: 2500, netCents: -2500 }),
      makeExpenseShare({ billId: "payment-1", userId: "user-bob", paidCents: 2500, owedCents: 0, netCents: 2500 }),
      makeExpenseShare({ billId: "payment-1", userId: "user-alice", paidCents: 0, owedCents: 2500, netCents: -2500 }),
    ];
    const edges = computeGroupNetEdges(shares, participants);
    expect(edges).toHaveLength(0);
  });
});
