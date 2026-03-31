import { describe, expect, it } from "vitest";
import { makeItemizedBill, makeSingleAmountBill, userAlice, userBob, userCarlos } from "@/test/fixtures";
import type { BillSplit, ItemSplit } from "@/types";
import type { DebtEdge } from "./simplify";
import { computeRawEdges, consolidateEdges, simplifyDebts } from "./simplify";

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

// ============================================================
// Multi-expense merging and participant edge cases
// ============================================================

import type { User } from "@/types";

function makeUser(id: string, name: string): User {
  return {
    id,
    email: `${id}@example.com`,
    handle: id,
    name,
    pixKeyType: "email" as const,
    pixKeyHint: `${id}@example.com`,
    onboarded: true,
    createdAt: "2024-01-01T00:00:00Z",
  };
}

function computeNetBalances(edges: DebtEdge[]): Map<string, number> {
  const balances = new Map<string, number>();
  for (const e of edges) {
    balances.set(e.fromUserId, (balances.get(e.fromUserId) || 0) - e.amountCents);
    balances.set(e.toUserId, (balances.get(e.toUserId) || 0) + e.amountCents);
  }
  return balances;
}

function assertConservation(original: DebtEdge[], simplified: DebtEdge[]) {
  const origBal = computeNetBalances(original);
  const simpBal = computeNetBalances(simplified);
  const allUsers = new Set([...origBal.keys(), ...simpBal.keys()]);
  for (const u of allUsers) {
    expect(simpBal.get(u) || 0).toBe(origBal.get(u) || 0);
  }
}

describe("multi-expense merging via consolidateEdges", () => {
  it("merges cumulative edges from multiple expenses between the same pair", () => {
    const expense1Edges: DebtEdge[] = [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 3000 },
    ];
    const expense2Edges: DebtEdge[] = [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 2000 },
    ];
    const merged = consolidateEdges([...expense1Edges, ...expense2Edges]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      fromUserId: "user-bob",
      toUserId: "user-alice",
      amountCents: 5000,
    });
  });

  it("keeps opposing edges from different expenses as separate directions", () => {
    const expense1Edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 7000 },
    ];
    const expense2Edges: DebtEdge[] = [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 4000 },
    ];
    const merged = consolidateEdges([...expense1Edges, ...expense2Edges]);
    expect(merged).toHaveLength(2);
    const ab = merged.find((e) => e.fromUserId === "user-alice" && e.toUserId === "user-bob");
    const ba = merged.find((e) => e.fromUserId === "user-bob" && e.toUserId === "user-alice");
    expect(ab?.amountCents).toBe(7000);
    expect(ba?.amountCents).toBe(4000);
  });

  it("merges edges from 3+ expenses between many user pairs", () => {
    const allEdges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 1000 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 2000 },
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 500 },
      { fromUserId: "user-carlos", toUserId: "user-alice", amountCents: 800 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 1200 },
    ];
    const merged = consolidateEdges(allEdges);
    const ab = merged.find((e) => e.fromUserId === "user-alice" && e.toUserId === "user-bob");
    const bc = merged.find((e) => e.fromUserId === "user-bob" && e.toUserId === "user-carlos");
    const ca = merged.find((e) => e.fromUserId === "user-carlos" && e.toUserId === "user-alice");
    expect(ab?.amountCents).toBe(1500);
    expect(bc?.amountCents).toBe(3200);
    expect(ca?.amountCents).toBe(800);
  });

  it("filters out edges that net to zero after consolidation", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 1000 },
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: -1000 },
    ];
    const merged = consolidateEdges(edges);
    expect(merged).toHaveLength(0);
  });

  it("filters out edges that net to negative after consolidation", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 1000 },
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: -3000 },
    ];
    const merged = consolidateEdges(edges);
    expect(merged).toHaveLength(0);
  });
});

describe("simplifyDebts with cross-expense opposing edges", () => {
  it("cancels fully opposing edges from two expenses", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 },
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 },
    ];
    const result = simplifyDebts(edges, twoParticipants);
    expect(result.simplifiedEdges).toHaveLength(0);
    assertConservation(edges, result.simplifiedEdges);
  });

  it("nets partially opposing edges from two expenses to a single edge", () => {
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
    assertConservation(edges, result.simplifiedEdges);
  });

  it("resolves cross-expense cycle among 3 users", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 5000 },
      { fromUserId: "user-carlos", toUserId: "user-alice", amountCents: 5000 },
    ];
    const result = simplifyDebts(edges, participants);
    expect(result.simplifiedEdges).toHaveLength(0);
    assertConservation(edges, result.simplifiedEdges);
  });

  it("resolves cross-expense cycle among 3 users with unequal amounts", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 6000 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 4000 },
      { fromUserId: "user-carlos", toUserId: "user-alice", amountCents: 3000 },
    ];
    const result = simplifyDebts(edges, participants);
    expect(result.simplifiedEdges.length).toBeLessThanOrEqual(2);
    assertConservation(edges, result.simplifiedEdges);
  });

  it("simplifies 4-user cross-expense cycle", () => {
    const dave = makeUser("user-dave", "Dave");
    const fourUsers = [userAlice, userBob, userCarlos, dave];
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 3000 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 3000 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 3000 },
      { fromUserId: "user-dave", toUserId: "user-alice", amountCents: 3000 },
    ];
    const result = simplifyDebts(edges, fourUsers);
    expect(result.simplifiedEdges).toHaveLength(0);
    assertConservation(edges, result.simplifiedEdges);
  });

  it("handles mixed cumulative and opposing edges from multiple expenses", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 },
      { fromUserId: "user-alice", toUserId: "user-carlos", amountCents: 3000 },
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 2000 },
      { fromUserId: "user-carlos", toUserId: "user-bob", amountCents: 4000 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 1000 },
    ];
    const result = simplifyDebts(edges, participants);
    assertConservation(edges, result.simplifiedEdges);
    expect(result.simplifiedEdges.length).toBeLessThanOrEqual(edges.length);
    for (const e of result.simplifiedEdges) {
      expect(e.amountCents).toBeGreaterThan(0);
    }
  });

  it("handles two expenses where one payer becomes a debtor in the second", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 10000 },
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 7000 },
      { fromUserId: "user-carlos", toUserId: "user-bob", amountCents: 3000 },
    ];
    const result = simplifyDebts(edges, participants);
    assertConservation(edges, result.simplifiedEdges);
    expect(result.simplifiedEdges.length).toBeLessThanOrEqual(2);
  });
});

describe("participant edge cases", () => {
  it("resolves unknown user IDs to '?' in step descriptions", () => {
    const unknownUser = "user-unknown-xyz";
    const edges: DebtEdge[] = [
      { fromUserId: unknownUser, toUserId: "user-alice", amountCents: 5000 },
      { fromUserId: "user-alice", toUserId: unknownUser, amountCents: 3000 },
    ];
    const result = simplifyDebts(edges, [userAlice]);
    const allDescriptions = result.steps.map((s) => s.description).join(" ");
    expect(allDescriptions).toContain("?");
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0].amountCents).toBe(2000);
  });

  it("handles participants with zero balance (not appearing in any edge)", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 },
    ];
    const result = simplifyDebts(edges, participants);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0]).toMatchObject({
      fromUserId: "user-alice",
      toUserId: "user-bob",
      amountCents: 5000,
    });
    const involvedUsers = new Set(
      result.simplifiedEdges.flatMap((e) => [e.fromUserId, e.toUserId]),
    );
    expect(involvedUsers.has("user-carlos")).toBe(false);
  });

  it("handles newly-added participant who has no edges in existing expense", () => {
    const dave = makeUser("user-dave", "Dave");
    const fourUsers = [userAlice, userBob, userCarlos, dave];
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 3000 },
      { fromUserId: "user-carlos", toUserId: "user-bob", amountCents: 2000 },
    ];
    const result = simplifyDebts(edges, fourUsers);
    expect(result.simplifiedEdges).toHaveLength(2);
    const involvedUsers = new Set(
      result.simplifiedEdges.flatMap((e) => [e.fromUserId, e.toUserId]),
    );
    expect(involvedUsers.has("user-dave")).toBe(false);
    assertConservation(edges, result.simplifiedEdges);
  });

  it("handles participant who left (edges remain but user not in participants array)", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 },
      { fromUserId: "user-carlos", toUserId: "user-bob", amountCents: 3000 },
    ];
    const withoutCarlos = [userAlice, userBob];
    const result = simplifyDebts(edges, withoutCarlos);
    expect(result.simplifiedEdges).toHaveLength(2);
    assertConservation(edges, result.simplifiedEdges);
  });

  it("handles simplification when participant leaves mid-chain (A→B→C but B left)", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5000 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 5000 },
    ];
    const withoutBob = [userAlice, userCarlos];
    const result = simplifyDebts(edges, withoutBob);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0]).toMatchObject({
      fromUserId: "user-alice",
      toUserId: "user-carlos",
      amountCents: 5000,
    });
    assertConservation(edges, result.simplifiedEdges);
  });

  it("simplifies correctly with many participants but only 2 having debts", () => {
    const users = Array.from({ length: 8 }, (_, i) => makeUser(`user-${i}`, `User ${i}`));
    const edges: DebtEdge[] = [
      { fromUserId: "user-3", toUserId: "user-7", amountCents: 15000 },
    ];
    const result = simplifyDebts(edges, users);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0].amountCents).toBe(15000);
    assertConservation(edges, result.simplifiedEdges);
  });

  it("handles all participants having mutual debts that fully cancel", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 2000 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 2000 },
      { fromUserId: "user-carlos", toUserId: "user-alice", amountCents: 2000 },
    ];
    const result = simplifyDebts(edges, participants);
    expect(result.simplifiedEdges).toHaveLength(0);
    assertConservation(edges, result.simplifiedEdges);
  });

  it("handles duplicate edges from same expense (consolidateEdges should merge)", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 1000 },
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 1000 },
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 1000 },
    ];
    const consolidated = consolidateEdges(edges);
    expect(consolidated).toHaveLength(1);
    expect(consolidated[0].amountCents).toBe(3000);
    const result = simplifyDebts(edges, twoParticipants);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0].amountCents).toBe(3000);
  });

  it("preserves conservation with 5-user star topology from multiple expenses", () => {
    const hub = makeUser("user-hub", "Hub");
    const spoke1 = makeUser("user-s1", "Spoke1");
    const spoke2 = makeUser("user-s2", "Spoke2");
    const spoke3 = makeUser("user-s3", "Spoke3");
    const spoke4 = makeUser("user-s4", "Spoke4");
    const allUsers = [hub, spoke1, spoke2, spoke3, spoke4];

    const edges: DebtEdge[] = [
      { fromUserId: "user-s1", toUserId: "user-hub", amountCents: 3000 },
      { fromUserId: "user-s2", toUserId: "user-hub", amountCents: 5000 },
      { fromUserId: "user-s3", toUserId: "user-hub", amountCents: 2000 },
      { fromUserId: "user-s4", toUserId: "user-hub", amountCents: 4000 },
      { fromUserId: "user-hub", toUserId: "user-s1", amountCents: 1000 },
      { fromUserId: "user-hub", toUserId: "user-s3", amountCents: 1500 },
    ];
    const result = simplifyDebts(edges, allUsers);
    assertConservation(edges, result.simplifiedEdges);
    expect(result.simplifiedEdges.length).toBeLessThanOrEqual(edges.length);
    for (const e of result.simplifiedEdges) {
      expect(e.amountCents).toBeGreaterThan(0);
    }
  });

  it("handles single user appearing in all edges of a complex graph", () => {
    const dave = makeUser("user-dave", "Dave");
    const fourUsers = [userAlice, userBob, userCarlos, dave];
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-dave", amountCents: 2000 },
      { fromUserId: "user-bob", toUserId: "user-dave", amountCents: 3000 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 4000 },
      { fromUserId: "user-dave", toUserId: "user-alice", amountCents: 1000 },
      { fromUserId: "user-dave", toUserId: "user-bob", amountCents: 1500 },
      { fromUserId: "user-dave", toUserId: "user-carlos", amountCents: 500 },
    ];
    const result = simplifyDebts(edges, fourUsers);
    assertConservation(edges, result.simplifiedEdges);
    expect(result.simplifiedEdges.length).toBeLessThanOrEqual(edges.length);
  });
});
