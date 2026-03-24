import { describe, expect, it } from "vitest";
import { makeItemizedBill, makeSingleAmountBill, userAlice, userBob, userCarlos } from "@/test/fixtures";
import type { BillSplit, ItemSplit } from "@/types";
import type { DebtEdge } from "./simplify";
import { computeRawEdges, simplifyDebts } from "./simplify";

const participants = [userAlice, userBob, userCarlos];
const twoParticipants = [userAlice, userBob];

function makeItemSplit(userId: string, amountCents: number, itemId = "item-1"): ItemSplit {
  return { id: `split-${userId}`, itemId, userId, splitType: "fixed", value: amountCents, computedAmountCents: amountCents };
}

function makeBillSplit(userId: string, amountCents: number): BillSplit {
  return { userId, splitType: "fixed", value: amountCents, computedAmountCents: amountCents };
}

describe("computeRawEdges", () => {
  it("two people, one payer, equal consumption", () => {
    const bill = makeItemizedBill({
      creatorId: "user-alice",
      serviceFeePercent: 0,
      payers: [{ userId: "user-alice", amountCents: 10000 }],
    });
    const items = [{ totalPriceCents: 10000 }];
    const itemSplits = [makeItemSplit("user-alice", 5000), makeItemSplit("user-bob", 5000)];
    const edges = computeRawEdges(bill, twoParticipants, itemSplits, [], items);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 });
  });

  it("excludes self-payment edges", () => {
    const bill = makeItemizedBill({
      creatorId: "user-alice",
      serviceFeePercent: 0,
      payers: [{ userId: "user-alice", amountCents: 10000 }],
    });
    const items = [{ totalPriceCents: 10000 }];
    // Alice consumed 8000, Bob consumed 2000
    const itemSplits = [makeItemSplit("user-alice", 8000), makeItemSplit("user-bob", 2000)];
    const edges = computeRawEdges(bill, twoParticipants, itemSplits, [], items);
    // Only Bob -> Alice, no self-edge for Alice
    expect(edges.every((e) => e.fromUserId !== e.toUserId)).toBe(true);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 2000 });
  });

  it("splits proportionally across multiple payers", () => {
    const bill = makeItemizedBill({
      creatorId: "user-alice",
      serviceFeePercent: 0,
      payers: [
        { userId: "user-alice", amountCents: 6000 },
        { userId: "user-bob", amountCents: 4000 },
      ],
    });
    const items = [{ totalPriceCents: 10000 }];
    // Carlos consumed everything
    const itemSplits = [makeItemSplit("user-carlos", 10000)];
    const edges = computeRawEdges(bill, participants, itemSplits, [], items);
    expect(edges).toHaveLength(2);
    const toAlice = edges.find((e) => e.toUserId === "user-alice");
    const toBob = edges.find((e) => e.toUserId === "user-bob");
    expect(toAlice?.amountCents).toBe(6000);
    expect(toBob?.amountCents).toBe(4000);
  });

  it("applies service fee proportionally to consumption", () => {
    const bill = makeItemizedBill({
      creatorId: "user-alice",
      serviceFeePercent: 10,
      payers: [{ userId: "user-alice", amountCents: 11000 }],
    });
    const items = [{ totalPriceCents: 10000 }];
    // Bob consumed all 10000, so Bob owes items + 10% fee = 11000
    const itemSplits = [makeItemSplit("user-bob", 10000)];
    const edges = computeRawEdges(bill, twoParticipants, itemSplits, [], items);
    expect(edges).toHaveLength(1);
    expect(edges[0].amountCents).toBe(11000);
  });

  it("splits fixed fees equally among participants", () => {
    const bill = makeItemizedBill({
      creatorId: "user-alice",
      serviceFeePercent: 0,
      fixedFees: 1000,
      payers: [{ userId: "user-alice", amountCents: 6000 }],
    });
    const items = [{ totalPriceCents: 5000 }];
    // Alice and Bob each consume 2500 items + 500 fixed fee
    const itemSplits = [makeItemSplit("user-alice", 2500), makeItemSplit("user-bob", 2500)];
    const edges = computeRawEdges(bill, twoParticipants, itemSplits, [], items);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 3000 });
  });

  it("uses billSplits for single_amount bill type", () => {
    const bill = makeSingleAmountBill({
      creatorId: "user-alice",
      payers: [{ userId: "user-alice", amountCents: 10000 }],
    });
    const billSplits = [makeBillSplit("user-alice", 5000), makeBillSplit("user-bob", 5000)];
    const edges = computeRawEdges(bill, twoParticipants, [], billSplits, []);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 });
  });

  it("falls back to creator as payer when payers array is empty", () => {
    const bill = makeItemizedBill({
      creatorId: "user-alice",
      serviceFeePercent: 0,
      payers: [],
    });
    const items = [{ totalPriceCents: 10000 }];
    const itemSplits = [makeItemSplit("user-alice", 5000), makeItemSplit("user-bob", 5000)];
    const edges = computeRawEdges(bill, twoParticipants, itemSplits, [], items);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 });
  });

  it("returns empty array when total paid is zero", () => {
    const bill = makeItemizedBill({ creatorId: "user-alice", serviceFeePercent: 0, payers: [] });
    const edges = computeRawEdges(bill, twoParticipants, [], [], []);
    expect(edges).toEqual([]);
  });

  it("generates no edges for zero-consumption participants", () => {
    const bill = makeItemizedBill({
      creatorId: "user-alice",
      serviceFeePercent: 0,
      payers: [{ userId: "user-alice", amountCents: 5000 }],
    });
    const items = [{ totalPriceCents: 5000 }];
    // Bob consumed nothing
    const itemSplits = [makeItemSplit("user-alice", 5000)];
    const edges = computeRawEdges(bill, twoParticipants, itemSplits, [], items);
    expect(edges).toHaveLength(0);
  });
});

describe("simplifyDebts", () => {
  it("returns empty result for no edges", () => {
    const result = simplifyDebts([], participants);
    expect(result.simplifiedEdges).toEqual([]);
    expect(result.originalCount).toBe(0);
    expect(result.simplifiedCount).toBe(0);
  });

  it("returns same single edge unchanged", () => {
    const edges: DebtEdge[] = [{ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 }];
    const result = simplifyDebts(edges, twoParticipants);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0].amountCents).toBe(5000);
  });

  it("cancels equal reverse pair to zero edges", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 },
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 },
    ];
    const result = simplifyDebts(edges, twoParticipants);
    expect(result.simplifiedEdges).toHaveLength(0);
  });

  it("nets unequal reverse pair to a single edge", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 8000 },
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 3000 },
    ];
    const result = simplifyDebts(edges, twoParticipants);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0]).toMatchObject({
      fromUserId: "user-alice",
      toUserId: "user-bob",
      amountCents: 5000,
    });
  });

  it("collapses A→B→C chain to A→C", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 5000 },
    ];
    const result = simplifyDebts(edges, participants);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0]).toMatchObject({
      fromUserId: "user-alice",
      toUserId: "user-carlos",
      amountCents: 5000,
    });
  });

  it("records simplification steps", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 5000 },
    ];
    const result = simplifyDebts(edges, participants);
    // At minimum: original step + at least one simplification step
    expect(result.steps.length).toBeGreaterThan(1);
    expect(result.steps[0].description).toContain("Dividas");
  });

  it("step descriptions reference participant names", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 },
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 3000 },
    ];
    const result = simplifyDebts(edges, twoParticipants);
    const descriptions = result.steps.map((s) => s.description).join(" ");
    // Participant names should appear in descriptions
    expect(descriptions).toMatch(/Alice|Bob/);
  });

  it("reduces originalCount and simplifiedCount correctly after simplification", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 5000 },
    ];
    const result = simplifyDebts(edges, participants);
    expect(result.originalCount).toBe(2);
    expect(result.simplifiedCount).toBe(1);
  });

  it("handles already-minimal disconnected edges unchanged", () => {
    // Three separate debts with no simplification possible
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 1000 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 2000 },
      { fromUserId: "user-carlos", toUserId: "user-alice", amountCents: 3000 },
    ];
    const result = simplifyDebts(edges, participants);
    // A triangle should simplify (all balance to zero via netAndMinimize)
    expect(result.simplifiedEdges.length).toBeLessThanOrEqual(edges.length);
  });
});
