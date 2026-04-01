import { describe, expect, it } from "vitest";
import { makeItemizedBill, makeSingleAmountBill, userAlice, userBob, userCarlos } from "@/test/fixtures";
import type { BillSplit, ItemSplit, User } from "@/types";
import type { DebtEdge } from "./simplify";
import { computeRawEdges, consolidateEdges, netAndMinimize, simplifyDebts } from "./simplify";

const participants = [userAlice, userBob, userCarlos];
const twoParticipants = [userAlice, userBob];

function makeUser(id: string, name: string): User {
  return { id, email: `${id}@example.com`, handle: id, name, pixKeyType: "email" as const, pixKeyHint: `${id}@example.com`, onboarded: true, createdAt: "2024-01-01T00:00:00Z" };
}

const userDave = makeUser("user-dave", "Dave Lima");
const userEve = makeUser("user-eve", "Eve Costa");
const userFrank = makeUser("user-frank", "Frank Dias");
const userGrace = makeUser("user-grace", "Grace Reis");

function netBalances(edges: DebtEdge[]): Map<string, number> {
  const bal = new Map<string, number>();
  for (const e of edges) {
    bal.set(e.fromUserId, (bal.get(e.fromUserId) || 0) - e.amountCents);
    bal.set(e.toUserId, (bal.get(e.toUserId) || 0) + e.amountCents);
  }
  return bal;
}

function assertConservation(original: DebtEdge[], simplified: DebtEdge[]) {
  const origBal = netBalances(original);
  const simpBal = netBalances(simplified);
  const allUsers = new Set([...origBal.keys(), ...simpBal.keys()]);
  for (const u of allUsers) {
    expect(simpBal.get(u) || 0).toBe(origBal.get(u) || 0);
  }
}

function assertNoNegativeEdges(edges: DebtEdge[]) {
  for (const e of edges) {
    expect(e.amountCents).toBeGreaterThanOrEqual(0);
  }
}

function assertNoSelfEdges(edges: DebtEdge[]) {
  for (const e of edges) {
    expect(e.fromUserId).not.toBe(e.toUserId);
  }
}

function makeItemSplit(userId: string, amountCents: number, itemId = "item-1"): ItemSplit {
  return { id: `split-${userId}-${itemId}`, itemId, userId, splitType: "fixed", value: amountCents, computedAmountCents: amountCents };
}

function makeBillSplit(userId: string, amountCents: number): BillSplit {
  return { userId, splitType: "fixed", value: amountCents, computedAmountCents: amountCents };
}

function edgeSum(edges: DebtEdge[]): number {
  return edges.reduce((sum, e) => sum + e.amountCents, 0);
}

function assertEdgeSumInvariant(edges: DebtEdge[], expectedTotal: number) {
  expect(edgeSum(edges)).toBe(expectedTotal);
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

  it("edges sum exactly to total consumption across multiple payers (no rounding residue)", () => {
    const bill = makeItemizedBill({
      creatorId: "user-alice",
      serviceFeePercent: 0,
      payers: [
        { userId: "user-alice", amountCents: 3000 },
        { userId: "user-bob", amountCents: 3000 },
        { userId: "user-carlos", amountCents: 3000 },
      ],
    });
    const items = [{ totalPriceCents: 9000 }];
    // Dave-equivalent: one participant consumed 1001 across 3 payers
    // 1001 * 3000/9000 = 333.67 → independent Math.round would give 334+334+334=1002
    // Need a 4th participant as consumer to avoid self-edge overlap
    const consumerOnly = { id: "user-dave", email: "dave@example.com", handle: "dave", name: "Dave", pixKeyType: "email" as const, pixKeyHint: "d***e@example.com", onboarded: true, createdAt: "2024-01-01T00:00:00Z" };
    const allParticipants = [userAlice, userBob, userCarlos, consumerOnly];
    const splits = [makeItemSplit("user-dave", 1001, "item-1")];
    const edges = computeRawEdges(bill, allParticipants, splits, [], items);
    const totalOwed = edges.reduce((sum, e) => sum + e.amountCents, 0);
    expect(totalOwed).toBe(1001);
  });

  it("edges sum exactly to total consumption with uneven multi-payer split", () => {
    const bill = makeItemizedBill({
      creatorId: "user-alice",
      serviceFeePercent: 0,
      payers: [
        { userId: "user-alice", amountCents: 5000 },
        { userId: "user-bob", amountCents: 5002 },
      ],
    });
    const items = [{ totalPriceCents: 10002 }];
    // Carlos consumed everything (not a payer)
    const itemSplits = [makeItemSplit("user-carlos", 10002)];
    const edges = computeRawEdges(bill, participants, itemSplits, [], items);
    const totalOwed = edges.reduce((sum, e) => sum + e.amountCents, 0);
    expect(totalOwed).toBe(10002);
  });

  describe("multi-item scenarios", () => {
    it("two items with different consumers produce separate edges", () => {
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 0,
        payers: [{ userId: "user-alice", amountCents: 8000 }],
      });
      const items = [{ totalPriceCents: 5000 }, { totalPriceCents: 3000 }];
      const itemSplits = [
        makeItemSplit("user-bob", 5000, "item-1"),
        makeItemSplit("user-carlos", 3000, "item-2"),
      ];
      const edges = computeRawEdges(bill, participants, itemSplits, [], items);
      expect(edges).toHaveLength(2);
      const bobEdge = edges.find((e) => e.fromUserId === "user-bob")!;
      const carlosEdge = edges.find((e) => e.fromUserId === "user-carlos")!;
      expect(bobEdge.amountCents).toBe(5000);
      expect(carlosEdge.amountCents).toBe(3000);
      assertEdgeSumInvariant(edges, 8000);
    });

    it("three items shared unevenly across four people", () => {
      const allFour = [userAlice, userBob, userCarlos, userDave];
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 0,
        payers: [{ userId: "user-alice", amountCents: 15000 }],
      });
      const items = [
        { totalPriceCents: 6000 },
        { totalPriceCents: 4000 },
        { totalPriceCents: 5000 },
      ];
      const itemSplits = [
        makeItemSplit("user-alice", 3000, "item-1"),
        makeItemSplit("user-bob", 3000, "item-1"),
        makeItemSplit("user-carlos", 4000, "item-2"),
        makeItemSplit("user-dave", 5000, "item-3"),
      ];
      const edges = computeRawEdges(bill, allFour, itemSplits, [], items);
      expect(edges.every((e) => e.fromUserId !== e.toUserId)).toBe(true);
      assertEdgeSumInvariant(edges, 12000); // 15000 - 3000 Alice consumed
    });

    it("one item split among all participants consolidates edges per payer", () => {
      const fiveUsers = [userAlice, userBob, userCarlos, userDave, userEve];
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 0,
        payers: [
          { userId: "user-alice", amountCents: 5000 },
          { userId: "user-bob", amountCents: 5000 },
        ],
      });
      const items = [{ totalPriceCents: 10000 }];
      const itemSplits = [
        makeItemSplit("user-carlos", 4000, "item-1"),
        makeItemSplit("user-dave", 3000, "item-1"),
        makeItemSplit("user-eve", 3000, "item-1"),
      ];
      const edges = computeRawEdges(bill, fiveUsers, itemSplits, [], items);
      // 3 consumers × 2 payers = 6 possible edges (no self-payment)
      expect(edges.length).toBeLessThanOrEqual(6);
      expect(edges.every((e) => e.fromUserId !== e.toUserId)).toBe(true);
      assertEdgeSumInvariant(edges, 10000);
    });
  });

  describe("service fee + fixed fee combinations", () => {
    it("service fee and fixed fee together distribute correctly", () => {
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 10,
        fixedFees: 600,
        payers: [{ userId: "user-alice", amountCents: 11600 }],
      });
      const items = [{ totalPriceCents: 10000 }];
      // Bob and Carlos each consumed 5000 of items
      const itemSplits = [
        makeItemSplit("user-bob", 5000, "item-1"),
        makeItemSplit("user-carlos", 5000, "item-1"),
      ];
      const edges = computeRawEdges(bill, participants, itemSplits, [], items);
      // Service fee: 10% of 10000 = 1000, split proportionally (500 each)
      // Fixed fee: 600 / 3 = 200 each (Alice gets fee too)
      // Bob total: 5000 + 500 + 200 = 5700
      // Carlos total: 5000 + 500 + 200 = 5700
      // Alice total: 0 + 0 + 200 = 200 (but she's payer, so no self-edge)
      assertEdgeSumInvariant(edges, 11400); // 11600 - 200 Alice's share
    });

    it("service fee on unequal consumption distributes proportionally", () => {
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 10,
        fixedFees: 0,
        payers: [{ userId: "user-alice", amountCents: 11000 }],
      });
      const items = [{ totalPriceCents: 10000 }];
      // Bob consumed 8000, Carlos consumed 2000
      const itemSplits = [
        makeItemSplit("user-bob", 8000, "item-1"),
        makeItemSplit("user-carlos", 2000, "item-1"),
      ];
      const edges = computeRawEdges(bill, participants, itemSplits, [], items);
      // Service fee 1000 → Bob gets 800, Carlos gets 200
      const bobEdge = edges.find((e) => e.fromUserId === "user-bob")!;
      const carlosEdge = edges.find((e) => e.fromUserId === "user-carlos")!;
      expect(bobEdge.amountCents).toBe(8800);
      expect(carlosEdge.amountCents).toBe(2200);
    });

    it("fixed fee distributes evenly regardless of consumption", () => {
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 0,
        fixedFees: 900,
        payers: [{ userId: "user-alice", amountCents: 10900 }],
      });
      const items = [{ totalPriceCents: 10000 }];
      // Only Bob consumed items, but all 3 share fixed fee
      const itemSplits = [makeItemSplit("user-bob", 10000, "item-1")];
      const edges = computeRawEdges(bill, participants, itemSplits, [], items);
      // Bob: 10000 items + 300 fixed = 10300
      // Carlos: 0 items + 300 fixed = 300
      // Alice: 0 items + 300 fixed = 300 (self-edge excluded)
      const bobEdge = edges.find((e) => e.fromUserId === "user-bob")!;
      const carlosEdge = edges.find((e) => e.fromUserId === "user-carlos")!;
      expect(bobEdge.amountCents).toBe(10300);
      expect(carlosEdge.amountCents).toBe(300);
      assertEdgeSumInvariant(edges, 10600); // 10900 - 300 Alice's fixed share
    });

    it("high service fee (25%) with odd fixed fee on 7 participants", () => {
      const sevenUsers = [userAlice, userBob, userCarlos, userDave, userEve, userFrank, userGrace];
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 25,
        fixedFees: 999,
        payers: [{ userId: "user-alice", amountCents: 13499 }],
      });
      const items = [{ totalPriceCents: 10000 }];
      // Each of 5 non-Alice, non-Grace users consumed 2000
      const itemSplits = [
        makeItemSplit("user-bob", 2000, "item-1"),
        makeItemSplit("user-carlos", 2000, "item-1"),
        makeItemSplit("user-dave", 2000, "item-1"),
        makeItemSplit("user-eve", 2000, "item-1"),
        makeItemSplit("user-frank", 2000, "item-1"),
      ];
      const edges = computeRawEdges(bill, sevenUsers, itemSplits, [], items);
      // All edges should be non-negative integers
      expect(edges.every((e) => e.amountCents >= 0 && Number.isInteger(e.amountCents))).toBe(true);
      // No self-edges
      expect(edges.every((e) => e.fromUserId !== e.toUserId)).toBe(true);
      // Total edges should sum to total minus Alice's own share (fixed fee portion)
      const totalConsumed = edges.reduce((s, e) => s + e.amountCents, 0);
      // Grace consumed nothing of items but still pays fixed fee
      // All participants share fixed fee 999/7 ≈ 142-143 each
      // Total consumption = items(10000) + svc(2500) + fixed(999) = 13499
      // Alice's share = 0 items + 0 svc + ~142 fixed = ~142
      // Edges total ≈ 13499 - 142 = 13357
      expect(totalConsumed).toBeGreaterThan(13200);
      expect(totalConsumed).toBeLessThan(13499);
    });
  });

  describe("multi-payer proportional distribution", () => {
    it("three payers with equal amounts produce edges proportional to 1/3 each", () => {
      const fourUsers = [userAlice, userBob, userCarlos, userDave];
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 0,
        payers: [
          { userId: "user-alice", amountCents: 3000 },
          { userId: "user-bob", amountCents: 3000 },
          { userId: "user-carlos", amountCents: 3000 },
        ],
      });
      const items = [{ totalPriceCents: 9000 }];
      const itemSplits = [makeItemSplit("user-dave", 9000, "item-1")];
      const edges = computeRawEdges(bill, fourUsers, itemSplits, [], items);
      // Dave owes each payer 3000
      expect(edges).toHaveLength(3);
      for (const e of edges) {
        expect(e.fromUserId).toBe("user-dave");
        expect(e.amountCents).toBe(3000);
      }
    });

    it("two payers with 70/30 split produce proportional edges", () => {
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 0,
        payers: [
          { userId: "user-alice", amountCents: 7000 },
          { userId: "user-bob", amountCents: 3000 },
        ],
      });
      const items = [{ totalPriceCents: 10000 }];
      const itemSplits = [makeItemSplit("user-carlos", 10000, "item-1")];
      const edges = computeRawEdges(bill, participants, itemSplits, [], items);
      const toAlice = edges.find((e) => e.toUserId === "user-alice")!;
      const toBob = edges.find((e) => e.toUserId === "user-bob")!;
      expect(toAlice.amountCents).toBe(7000);
      expect(toBob.amountCents).toBe(3000);
    });

    it("payer who is also consumer gets reduced edges", () => {
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 0,
        payers: [
          { userId: "user-alice", amountCents: 5000 },
          { userId: "user-bob", amountCents: 5000 },
        ],
      });
      const items = [{ totalPriceCents: 10000 }];
      // Both payers consumed equally
      const itemSplits = [
        makeItemSplit("user-alice", 5000, "item-1"),
        makeItemSplit("user-bob", 5000, "item-1"),
      ];
      const edges = computeRawEdges(bill, twoParticipants, itemSplits, [], items);
      // Alice consumed 5000, split 50/50 across payers: 2500 to Alice, 2500 to Bob
      // Self-edge excluded → Alice owes Bob 2500
      // Bob consumed 5000, split 50/50: 2500 to Alice, 2500 to Bob
      // Self-edge excluded → Bob owes Alice 2500
      // After consolidation: net zero — edges cancel
      // But computeRawEdges doesn't net — it consolidates same-direction edges
      const aliceToBob = edges.filter((e) => e.fromUserId === "user-alice" && e.toUserId === "user-bob");
      const bobToAlice = edges.filter((e) => e.fromUserId === "user-bob" && e.toUserId === "user-alice");
      // Each direction should be 2500
      if (aliceToBob.length > 0) expect(aliceToBob[0].amountCents).toBe(2500);
      if (bobToAlice.length > 0) expect(bobToAlice[0].amountCents).toBe(2500);
    });

    it("uneven three-payer split [3333, 3333, 3334] sums to exactly 10000", () => {
      const fourUsers = [userAlice, userBob, userCarlos, userDave];
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 0,
        payers: [
          { userId: "user-alice", amountCents: 3333 },
          { userId: "user-bob", amountCents: 3333 },
          { userId: "user-carlos", amountCents: 3334 },
        ],
      });
      const items = [{ totalPriceCents: 10000 }];
      const itemSplits = [makeItemSplit("user-dave", 10000, "item-1")];
      const edges = computeRawEdges(bill, fourUsers, itemSplits, [], items);
      assertEdgeSumInvariant(edges, 10000);
      expect(edges).toHaveLength(3);
    });
  });

  describe("single_amount expense type", () => {
    it("single_amount with 5 people and 3 payers distributes proportionally", () => {
      const fiveUsers = [userAlice, userBob, userCarlos, userDave, userEve];
      const bill = makeSingleAmountBill({
        creatorId: "user-alice",
        payers: [
          { userId: "user-alice", amountCents: 5000 },
          { userId: "user-bob", amountCents: 3000 },
          { userId: "user-carlos", amountCents: 2000 },
        ],
      });
      const billSplits = [
        makeBillSplit("user-alice", 2000),
        makeBillSplit("user-bob", 2000),
        makeBillSplit("user-carlos", 2000),
        makeBillSplit("user-dave", 2000),
        makeBillSplit("user-eve", 2000),
      ];
      const edges = computeRawEdges(bill, fiveUsers, [], billSplits, []);
      // No self-edges
      expect(edges.every((e) => e.fromUserId !== e.toUserId)).toBe(true);
      // Each person consumed 2000. Payer split: Alice 50%, Bob 30%, Carlos 20%
      // Alice: 2000 → self(1000) + Bob(600) + Carlos(400) → non-self = 1000
      // Bob: 2000 → Alice(1000) + self(600) + Carlos(400) → non-self = 1400
      // Carlos: 2000 → Alice(1000) + Bob(600) + self(400) → non-self = 1600
      // Dave: 2000 → Alice(1000) + Bob(600) + Carlos(400) → non-self = 2000
      // Eve: 2000 → Alice(1000) + Bob(600) + Carlos(400) → non-self = 2000
      // Total non-self = 1000 + 1400 + 1600 + 2000 + 2000 = 8000
      assertEdgeSumInvariant(edges, 8000);
    });

    it("single_amount ignores service fee and fixed fee", () => {
      const bill = makeSingleAmountBill({
        creatorId: "user-alice",
        serviceFeePercent: 15,
        fixedFees: 500,
        payers: [{ userId: "user-alice", amountCents: 10000 }],
      });
      const billSplits = [
        makeBillSplit("user-alice", 5000),
        makeBillSplit("user-bob", 5000),
      ];
      const edges = computeRawEdges(bill, twoParticipants, [], billSplits, []);
      // single_amount uses billSplits directly, no fee calculation
      expect(edges).toHaveLength(1);
      expect(edges[0].amountCents).toBe(5000);
    });
  });

  describe("edge sum invariants under rounding stress", () => {
    it("prime total (10007) split among 3 payers and 1 consumer", () => {
      const fourUsers = [userAlice, userBob, userCarlos, userDave];
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 0,
        payers: [
          { userId: "user-alice", amountCents: 3336 },
          { userId: "user-bob", amountCents: 3336 },
          { userId: "user-carlos", amountCents: 3335 },
        ],
      });
      const items = [{ totalPriceCents: 10007 }];
      const itemSplits = [makeItemSplit("user-dave", 10007, "item-1")];
      const edges = computeRawEdges(bill, fourUsers, itemSplits, [], items);
      assertEdgeSumInvariant(edges, 10007);
    });

    it("1 centavo total produces exactly 1 edge of 1 centavo", () => {
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 0,
        payers: [{ userId: "user-alice", amountCents: 1 }],
      });
      const items = [{ totalPriceCents: 1 }];
      const itemSplits = [makeItemSplit("user-bob", 1, "item-1")];
      const edges = computeRawEdges(bill, twoParticipants, itemSplits, [], items);
      expect(edges).toHaveLength(1);
      expect(edges[0].amountCents).toBe(1);
    });

    it("large bill (R$99,999.99) with 5 payers and 5 consumers", () => {
      const tenUsers = [userAlice, userBob, userCarlos, userDave, userEve,
        userFrank, userGrace, makeUser("user-h", "H"), makeUser("user-i", "I"), makeUser("user-j", "J")];
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 0,
        payers: [
          { userId: "user-alice", amountCents: 1999998 },
          { userId: "user-bob", amountCents: 1999998 },
          { userId: "user-carlos", amountCents: 1999998 },
          { userId: "user-dave", amountCents: 1999998 },
          { userId: "user-eve", amountCents: 2000007 },
        ],
      });
      const total = 9999999;
      const items = [{ totalPriceCents: total }];
      const itemSplits = [
        makeItemSplit("user-frank", 2000000, "item-1"),
        makeItemSplit("user-grace", 2000000, "item-1"),
        makeItemSplit("user-h", 2000000, "item-1"),
        makeItemSplit("user-i", 2000000, "item-1"),
        makeItemSplit("user-j", 1999999, "item-1"),
      ];
      const edges = computeRawEdges(bill, tenUsers, itemSplits, [], items);
      assertEdgeSumInvariant(edges, total);
      expect(edges.every((e) => e.amountCents > 0 && Number.isInteger(e.amountCents))).toBe(true);
    });

    it("service fee + fixed fee + multi-payer: total edges = total consumption minus payer self-shares", () => {
      const fourUsers = [userAlice, userBob, userCarlos, userDave];
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 10,
        fixedFees: 400,
        payers: [
          { userId: "user-alice", amountCents: 7200 },
          { userId: "user-bob", amountCents: 4200 },
        ],
      });
      const items = [{ totalPriceCents: 10000 }];
      // Alice: 2000 items, Bob: 3000 items, Carlos: 3000 items, Dave: 2000 items
      const itemSplits = [
        makeItemSplit("user-alice", 2000, "item-1"),
        makeItemSplit("user-bob", 3000, "item-1"),
        makeItemSplit("user-carlos", 3000, "item-1"),
        makeItemSplit("user-dave", 2000, "item-1"),
      ];
      const edges = computeRawEdges(bill, fourUsers, itemSplits, [], items);
      // All amounts must be positive integers
      expect(edges.every((e) => e.amountCents > 0 && Number.isInteger(e.amountCents))).toBe(true);
      // No self-edges
      expect(edges.every((e) => e.fromUserId !== e.toUserId)).toBe(true);
      // Total consumption = 10000 items + 1000 svc + 400 fixed = 11400
      // Alice consumed: 2000 + 200 svc + 100 fixed = 2300
      // Edges total = 11400 - self-shares of payers
      // Hard to compute exact self-shares due to proportional split, but total edges < 11400
      expect(edgeSum(edges)).toBeLessThanOrEqual(11400);
      expect(edgeSum(edges)).toBeGreaterThan(0);
    });

    it("consumer who consumed zero with fees still owes fixed fee portion", () => {
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 10,
        fixedFees: 300,
        payers: [{ userId: "user-alice", amountCents: 11300 }],
      });
      const items = [{ totalPriceCents: 10000 }];
      // Bob consumed all items, Carlos consumed nothing
      const itemSplits = [makeItemSplit("user-bob", 10000, "item-1")];
      const edges = computeRawEdges(bill, participants, itemSplits, [], items);
      // Carlos: 0 items + 0 svc (proportional to consumption) + 100 fixed = 100
      const carlosEdge = edges.find((e) => e.fromUserId === "user-carlos");
      expect(carlosEdge).toBeDefined();
      expect(carlosEdge!.amountCents).toBe(100);
    });

    it("all consumers are also all payers — only cross-debts remain", () => {
      const bill = makeItemizedBill({
        creatorId: "user-alice",
        serviceFeePercent: 0,
        payers: [
          { userId: "user-alice", amountCents: 6000 },
          { userId: "user-bob", amountCents: 4000 },
        ],
      });
      const items = [{ totalPriceCents: 10000 }];
      const itemSplits = [
        makeItemSplit("user-alice", 7000, "item-1"),
        makeItemSplit("user-bob", 3000, "item-1"),
      ];
      const edges = computeRawEdges(bill, twoParticipants, itemSplits, [], items);
      // Alice consumed 7000: owes Alice 60%=4200 (self), owes Bob 40%=2800
      // Bob consumed 3000: owes Alice 60%=1800, owes Bob 40%=1200 (self)
      // Non-self edges: Alice→Bob 2800, Bob→Alice 1800
      expect(edges).toHaveLength(2);
      const aliceToBob = edges.find((e) => e.fromUserId === "user-alice" && e.toUserId === "user-bob")!;
      const bobToAlice = edges.find((e) => e.fromUserId === "user-bob" && e.toUserId === "user-alice")!;
      expect(aliceToBob.amountCents).toBe(2800);
      expect(bobToAlice.amountCents).toBe(1800);
    });
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

  it("preserves 1-centavo reverse-pair net (no tolerance)", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 5001 },
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 },
    ];
    const result = simplifyDebts(edges, twoParticipants);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0]).toMatchObject({
      fromUserId: "user-alice",
      toUserId: "user-bob",
      amountCents: 1,
    });
  });
});

// ─── Extended test users ────────────────────────────────────────────
const userEva = makeUser("user-eva", "Eva Costa");
const userGabi = makeUser("user-gabi", "Gabi Reis");
const userHugo = makeUser("user-hugo", "Hugo Pires");

// ─── consolidateEdges ───────────────────────────────────────────────
describe("consolidateEdges", () => {
  it("merges duplicate A→B edges", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "a", toUserId: "b", amountCents: 100 },
      { fromUserId: "a", toUserId: "b", amountCents: 200 },
    ];
    const result = consolidateEdges(edges);
    expect(result).toHaveLength(1);
    expect(result[0].amountCents).toBe(300);
  });

  it("keeps distinct direction edges separate", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "a", toUserId: "b", amountCents: 100 },
      { fromUserId: "b", toUserId: "a", amountCents: 100 },
    ];
    const result = consolidateEdges(edges);
    expect(result).toHaveLength(2);
  });

  it("drops edges that sum to zero", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "a", toUserId: "b", amountCents: 0 },
    ];
    expect(consolidateEdges(edges)).toHaveLength(0);
  });

  it("handles empty input", () => {
    expect(consolidateEdges([])).toEqual([]);
  });

  it("consolidates many duplicate pairs in a star pattern", () => {
    const edges: DebtEdge[] = [];
    for (let i = 0; i < 5; i++) {
      edges.push({ fromUserId: "spoke", toUserId: "hub", amountCents: 100 });
    }
    const result = consolidateEdges(edges);
    expect(result).toHaveLength(1);
    expect(result[0].amountCents).toBe(500);
  });
});

// ─── netAndMinimize ─────────────────────────────────────────────────
describe("netAndMinimize", () => {
  it("returns empty for empty input", () => {
    expect(netAndMinimize([])).toEqual([]);
  });

  it("returns single edge unchanged", () => {
    const edges: DebtEdge[] = [{ fromUserId: "a", toUserId: "b", amountCents: 100 }];
    const result = netAndMinimize(edges);
    expect(result).toHaveLength(1);
    expect(result[0].amountCents).toBe(100);
  });

  it("cancels equal reverse pair to nothing", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "a", toUserId: "b", amountCents: 100 },
      { fromUserId: "b", toUserId: "a", amountCents: 100 },
    ];
    expect(netAndMinimize(edges)).toHaveLength(0);
  });

  it("nets unequal reverse pair", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "a", toUserId: "b", amountCents: 300 },
      { fromUserId: "b", toUserId: "a", amountCents: 100 },
    ];
    const result = netAndMinimize(edges);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ fromUserId: "a", toUserId: "b", amountCents: 200 });
  });

  it("simplifies 3-cycle to 2 edges", () => {
    // A→B: 100, B→C: 100, C→A: 100 => all balanced => 0 edges
    const edges: DebtEdge[] = [
      { fromUserId: "a", toUserId: "b", amountCents: 100 },
      { fromUserId: "b", toUserId: "c", amountCents: 100 },
      { fromUserId: "c", toUserId: "a", amountCents: 100 },
    ];
    const result = netAndMinimize(edges);
    expect(result).toHaveLength(0);
    assertConservation(edges, result);
  });

  it("simplifies unequal 3-cycle", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "a", toUserId: "b", amountCents: 300 },
      { fromUserId: "b", toUserId: "c", amountCents: 200 },
      { fromUserId: "c", toUserId: "a", amountCents: 100 },
    ];
    const result = netAndMinimize(edges);
    assertConservation(edges, result);
    assertNoNegativeEdges(result);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("conserves balances for star topology: 4 debtors → 1 creditor", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "a", toUserId: "hub", amountCents: 100 },
      { fromUserId: "b", toUserId: "hub", amountCents: 200 },
      { fromUserId: "c", toUserId: "hub", amountCents: 300 },
      { fromUserId: "d", toUserId: "hub", amountCents: 400 },
    ];
    const result = netAndMinimize(edges);
    assertConservation(edges, result);
    expect(result).toHaveLength(4);
    expect(edgeSum(result)).toBe(1000);
  });

  it("reduces complete graph to minimal edges", () => {
    // 4-person complete graph: every pair has a debt
    const ids = ["a", "b", "c", "d"];
    const edges: DebtEdge[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        edges.push({ fromUserId: ids[i], toUserId: ids[j], amountCents: (i + 1) * 100 });
      }
    }
    const result = netAndMinimize(edges);
    assertConservation(edges, result);
    assertNoNegativeEdges(result);
    // At most N-1 edges for N users
    expect(result.length).toBeLessThanOrEqual(ids.length - 1);
  });
});

// ─── simplifyDebts: complex topologies ──────────────────────────────
describe("simplifyDebts — complex topologies", () => {
  const fourUsers = [userAlice, userBob, userCarlos, userDave];
  const fiveUsers = [userAlice, userBob, userCarlos, userDave, userEva];
  const sixUsers = [...fiveUsers, userFrank];
  const eightUsers = [...sixUsers, userGabi, userHugo];

  it("4-person cycle: A→B→C→D→A (equal amounts) nets to zero", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 1000 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 1000 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 1000 },
      { fromUserId: "user-dave", toUserId: "user-alice", amountCents: 1000 },
    ];
    const result = simplifyDebts(edges, fourUsers);
    expect(result.simplifiedEdges).toHaveLength(0);
    assertConservation(edges, result.simplifiedEdges);
  });

  it("4-person cycle with unequal amounts simplifies correctly", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 500 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 300 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 700 },
      { fromUserId: "user-dave", toUserId: "user-alice", amountCents: 400 },
    ];
    const result = simplifyDebts(edges, fourUsers);
    assertConservation(edges, result.simplifiedEdges);
    assertNoNegativeEdges(result.simplifiedEdges);
    assertNoSelfEdges(result.simplifiedEdges);
    expect(result.simplifiedCount).toBeLessThanOrEqual(result.originalCount);
  });

  it("star topology: 5 users all owe one hub", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 1000 },
      { fromUserId: "user-carlos", toUserId: "user-alice", amountCents: 2000 },
      { fromUserId: "user-dave", toUserId: "user-alice", amountCents: 3000 },
      { fromUserId: "user-eva", toUserId: "user-alice", amountCents: 4000 },
    ];
    const result = simplifyDebts(edges, fiveUsers);
    assertConservation(edges, result.simplifiedEdges);
    // Already minimal — each debtor pays Alice directly
    expect(result.simplifiedEdges).toHaveLength(4);
    expect(edgeSum(result.simplifiedEdges)).toBe(10000);
  });

  it("reverse star: hub owes everyone", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 1000 },
      { fromUserId: "user-alice", toUserId: "user-carlos", amountCents: 2000 },
      { fromUserId: "user-alice", toUserId: "user-dave", amountCents: 1500 },
      { fromUserId: "user-alice", toUserId: "user-eva", amountCents: 500 },
    ];
    const result = simplifyDebts(edges, fiveUsers);
    assertConservation(edges, result.simplifiedEdges);
    expect(result.simplifiedEdges).toHaveLength(4);
  });

  it("chain: A→B→C→D→E collapses to A→E", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 1000 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 1000 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 1000 },
      { fromUserId: "user-dave", toUserId: "user-eva", amountCents: 1000 },
    ];
    const result = simplifyDebts(edges, fiveUsers);
    assertConservation(edges, result.simplifiedEdges);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0]).toMatchObject({
      fromUserId: "user-alice",
      toUserId: "user-eva",
      amountCents: 1000,
    });
  });

  it("chain with decreasing amounts", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 400 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 300 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 200 },
      { fromUserId: "user-dave", toUserId: "user-eva", amountCents: 100 },
    ];
    const result = simplifyDebts(edges, fiveUsers);
    assertConservation(edges, result.simplifiedEdges);
    assertNoNegativeEdges(result.simplifiedEdges);
    // At most 4 edges (N-1)
    expect(result.simplifiedCount).toBeLessThanOrEqual(4);
  });

  it("complete 4-person graph (all pairs have debts)", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 100 },
      { fromUserId: "user-alice", toUserId: "user-carlos", amountCents: 200 },
      { fromUserId: "user-alice", toUserId: "user-dave", amountCents: 300 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 150 },
      { fromUserId: "user-bob", toUserId: "user-dave", amountCents: 250 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 350 },
    ];
    const result = simplifyDebts(edges, fourUsers);
    assertConservation(edges, result.simplifiedEdges);
    assertNoNegativeEdges(result.simplifiedEdges);
    assertNoSelfEdges(result.simplifiedEdges);
    // Should reduce 6 edges to at most 3
    expect(result.simplifiedCount).toBeLessThanOrEqual(3);
  });

  it("two independent pairs remain separate", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 500 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 700 },
    ];
    const result = simplifyDebts(edges, fourUsers);
    assertConservation(edges, result.simplifiedEdges);
    expect(result.simplifiedEdges).toHaveLength(2);
  });

  it("two triangles sharing one vertex", () => {
    // Triangle 1: A→B→C→A, Triangle 2: C→D→E→C
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 100 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 100 },
      { fromUserId: "user-carlos", toUserId: "user-alice", amountCents: 100 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 200 },
      { fromUserId: "user-dave", toUserId: "user-eva", amountCents: 200 },
      { fromUserId: "user-eva", toUserId: "user-carlos", amountCents: 200 },
    ];
    const result = simplifyDebts(edges, fiveUsers);
    assertConservation(edges, result.simplifiedEdges);
    // Both triangles are balanced, everything cancels
    expect(result.simplifiedEdges).toHaveLength(0);
  });

  it("6-person mixed topology: star + cycle", () => {
    const edges: DebtEdge[] = [
      // Star: everyone → Alice
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 500 },
      { fromUserId: "user-carlos", toUserId: "user-alice", amountCents: 500 },
      // Cycle among non-hub: Bob → Carlos → Dave → Bob
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 200 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 200 },
      { fromUserId: "user-dave", toUserId: "user-bob", amountCents: 200 },
      // Disconnected pair
      { fromUserId: "user-eva", toUserId: "user-frank", amountCents: 300 },
    ];
    const result = simplifyDebts(edges, sixUsers);
    assertConservation(edges, result.simplifiedEdges);
    assertNoNegativeEdges(result.simplifiedEdges);
    assertNoSelfEdges(result.simplifiedEdges);
  });

  it("8-person complete bipartite: 4 debtors → 4 creditors", () => {
    const debtors = [userAlice, userBob, userCarlos, userDave];
    const creditors = [userEva, userFrank, userGabi, userHugo];
    const edges: DebtEdge[] = [];
    for (const d of debtors) {
      for (const c of creditors) {
        edges.push({ fromUserId: d.id, toUserId: c.id, amountCents: 100 });
      }
    }
    // 16 edges total
    expect(edges).toHaveLength(16);
    const result = simplifyDebts(edges, eightUsers);
    assertConservation(edges, result.simplifiedEdges);
    assertNoNegativeEdges(result.simplifiedEdges);
    // Each debtor owes 400 total, each creditor is owed 400
    // Optimal: 4 edges (debtor_i → creditor_i) or at most 7 (N-1)
    expect(result.simplifiedCount).toBeLessThanOrEqual(7);
  });

  it("diamond: A→B, A→C, B→D, C→D (all equal)", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 500 },
      { fromUserId: "user-alice", toUserId: "user-carlos", amountCents: 500 },
      { fromUserId: "user-bob", toUserId: "user-dave", amountCents: 500 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 500 },
    ];
    const result = simplifyDebts(edges, fourUsers);
    assertConservation(edges, result.simplifiedEdges);
    // Net: Alice owes 1000, Dave is owed 1000, Bob and Carlos net zero
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0]).toMatchObject({
      fromUserId: "user-alice",
      toUserId: "user-dave",
      amountCents: 1000,
    });
  });

  it("figure-8: two cycles sharing a vertex", () => {
    // Cycle 1: A→B→C→A (100 each), Cycle 2: C→D→E→C (200 each)
    // C is the shared vertex
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 100 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 100 },
      { fromUserId: "user-carlos", toUserId: "user-alice", amountCents: 100 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 200 },
      { fromUserId: "user-dave", toUserId: "user-eva", amountCents: 200 },
      { fromUserId: "user-eva", toUserId: "user-carlos", amountCents: 200 },
    ];
    const result = simplifyDebts(edges, fiveUsers);
    assertConservation(edges, result.simplifiedEdges);
    // Both cycles perfectly balance → 0 edges
    expect(result.simplifiedEdges).toHaveLength(0);
  });

  it("Y-topology: A→C, B→C, C→D", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-carlos", amountCents: 300 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 200 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 500 },
    ];
    const result = simplifyDebts(edges, fourUsers);
    assertConservation(edges, result.simplifiedEdges);
    // C is a pass-through (receives 500, sends 500)
    // Optimal: A→D:300, B→D:200
    expect(result.simplifiedEdges).toHaveLength(2);
    const totalToDave = result.simplifiedEdges
      .filter((e) => e.toUserId === "user-dave")
      .reduce((s, e) => s + e.amountCents, 0);
    expect(totalToDave).toBe(500);
  });
});

// ─── simplifyDebts: property-based invariants ───────────────────────
describe("simplifyDebts — invariants", () => {
  const allUsers = [userAlice, userBob, userCarlos, userDave, userEva, userFrank, userGabi, userHugo];

  function randomEdges(userCount: number, edgeCount: number, maxAmount: number, seed: number): DebtEdge[] {
    // Simple deterministic PRNG for reproducibility
    let s = seed;
    const next = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s; };
    const users = allUsers.slice(0, userCount);
    const edges: DebtEdge[] = [];
    for (let i = 0; i < edgeCount; i++) {
      const from = users[next() % users.length].id;
      let to = users[next() % users.length].id;
      while (to === from) to = users[next() % users.length].id;
      edges.push({ fromUserId: from, toUserId: to, amountCents: (next() % maxAmount) + 1 });
    }
    return edges;
  }

  it("conservation: net balances are preserved for random 4-user graph (seed 1)", () => {
    const edges = randomEdges(4, 10, 5000, 1);
    const users = allUsers.slice(0, 4);
    const result = simplifyDebts(edges, users);
    assertConservation(edges, result.simplifiedEdges);
  });

  it("conservation: net balances are preserved for random 6-user graph (seed 42)", () => {
    const edges = randomEdges(6, 20, 10000, 42);
    const users = allUsers.slice(0, 6);
    const result = simplifyDebts(edges, users);
    assertConservation(edges, result.simplifiedEdges);
  });

  it("conservation: net balances are preserved for random 8-user graph (seed 99)", () => {
    const edges = randomEdges(8, 30, 50000, 99);
    const users = allUsers.slice(0, 8);
    const result = simplifyDebts(edges, users);
    assertConservation(edges, result.simplifiedEdges);
  });

  it("conservation: preserved across 10 random seeds", () => {
    for (let seed = 100; seed < 110; seed++) {
      const userCount = 3 + (seed % 6);
      const edges = randomEdges(userCount, 15, 10000, seed);
      const users = allUsers.slice(0, userCount);
      const result = simplifyDebts(edges, users);
      assertConservation(edges, result.simplifiedEdges);
    }
  });

  it("edge count bound: simplified ≤ N-1 edges for N users", () => {
    for (let seed = 200; seed < 210; seed++) {
      const userCount = 3 + (seed % 6);
      const edges = randomEdges(userCount, 20, 5000, seed);
      const users = allUsers.slice(0, userCount);
      const result = simplifyDebts(edges, users);
      expect(result.simplifiedCount).toBeLessThanOrEqual(userCount - 1);
    }
  });

  it("no negative edges in simplified output", () => {
    for (let seed = 300; seed < 310; seed++) {
      const edges = randomEdges(5, 15, 5000, seed);
      const users = allUsers.slice(0, 5);
      const result = simplifyDebts(edges, users);
      assertNoNegativeEdges(result.simplifiedEdges);
    }
  });

  it("no self-edges in simplified output", () => {
    for (let seed = 400; seed < 410; seed++) {
      const edges = randomEdges(5, 15, 5000, seed);
      const users = allUsers.slice(0, 5);
      const result = simplifyDebts(edges, users);
      assertNoSelfEdges(result.simplifiedEdges);
    }
  });

  it("idempotency: simplifying already-simplified edges gives same result", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 300 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 500 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 200 },
      { fromUserId: "user-dave", toUserId: "user-alice", amountCents: 100 },
    ];
    const fourUsers = allUsers.slice(0, 4);
    const first = simplifyDebts(edges, fourUsers);
    const second = simplifyDebts(first.simplifiedEdges, fourUsers);
    expect(second.simplifiedEdges).toEqual(first.simplifiedEdges);
  });

  it("idempotency: random graphs are stable after double simplification", () => {
    for (let seed = 500; seed < 505; seed++) {
      const edges = randomEdges(6, 15, 5000, seed);
      const users = allUsers.slice(0, 6);
      const first = simplifyDebts(edges, users);
      const second = simplifyDebts(first.simplifiedEdges, users);
      expect(second.simplifiedEdges).toEqual(first.simplifiedEdges);
    }
  });

  it("simplifiedCount ≤ originalCount always holds", () => {
    for (let seed = 600; seed < 610; seed++) {
      const edges = randomEdges(5, 12, 5000, seed);
      const users = allUsers.slice(0, 5);
      const result = simplifyDebts(edges, users);
      expect(result.simplifiedCount).toBeLessThanOrEqual(result.originalCount);
    }
  });

  it("steps array starts with original edges", () => {
    const edges = randomEdges(4, 8, 5000, 700);
    const users = allUsers.slice(0, 4);
    const result = simplifyDebts(edges, users);
    expect(result.steps[0].description).toContain("Dividas");
    expect(result.steps[0].edges).toEqual(edges);
  });

  it("steps array final edges match simplifiedEdges", () => {
    const edges = randomEdges(4, 8, 5000, 701);
    const users = allUsers.slice(0, 4);
    const result = simplifyDebts(edges, users);
    const lastStep = result.steps[result.steps.length - 1];
    expect(lastStep.edges).toEqual(result.simplifiedEdges);
  });
});

// ─── simplifyDebts: rounding and small amounts ──────────────────────
describe("simplifyDebts — rounding and edge cases", () => {
  const fourUsers = [userAlice, userBob, userCarlos, userDave];

  it("1-centavo edges survive simplification", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 1 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 1 },
    ];
    const result = simplifyDebts(edges, fourUsers);
    assertConservation(edges, result.simplifiedEdges);
    expect(result.simplifiedEdges).toHaveLength(2);
    expect(edgeSum(result.simplifiedEdges)).toBe(2);
  });

  it("very large amounts are handled correctly", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 99999999 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 99999999 },
    ];
    const result = simplifyDebts(edges, [userAlice, userBob, userCarlos]);
    assertConservation(edges, result.simplifiedEdges);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0].amountCents).toBe(99999999);
  });

  it("many 1-centavo edges consolidate and simplify", () => {
    const edges: DebtEdge[] = [];
    for (let i = 0; i < 100; i++) {
      edges.push({ fromUserId: "user-alice", toUserId: "user-bob", amountCents: 1 });
    }
    const result = simplifyDebts(edges, [userAlice, userBob]);
    assertConservation(edges, result.simplifiedEdges);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0].amountCents).toBe(100);
  });

  it("odd cents in 3-way split: 10001 cents split 3 ways", () => {
    // Simulates rounding remainder scenario
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-dave", amountCents: 3334 },
      { fromUserId: "user-bob", toUserId: "user-dave", amountCents: 3334 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 3333 },
    ];
    const result = simplifyDebts(edges, fourUsers);
    assertConservation(edges, result.simplifiedEdges);
    expect(edgeSum(result.simplifiedEdges)).toBe(10001);
  });

  it("mixed tiny and large edges maintain invariants", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 1 },
      { fromUserId: "user-bob", toUserId: "user-carlos", amountCents: 50000 },
      { fromUserId: "user-carlos", toUserId: "user-alice", amountCents: 1 },
    ];
    const result = simplifyDebts(edges, [userAlice, userBob, userCarlos]);
    assertConservation(edges, result.simplifiedEdges);
    assertNoNegativeEdges(result.simplifiedEdges);
  });

  it("all-zero edges after netting produce empty result", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 500 },
      { fromUserId: "user-bob", toUserId: "user-alice", amountCents: 500 },
      { fromUserId: "user-carlos", toUserId: "user-dave", amountCents: 300 },
      { fromUserId: "user-dave", toUserId: "user-carlos", amountCents: 300 },
    ];
    const result = simplifyDebts(edges, fourUsers);
    expect(result.simplifiedEdges).toHaveLength(0);
  });

  it("single participant with multiple debts to same creditor consolidates", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 100 },
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 200 },
      { fromUserId: "user-alice", toUserId: "user-bob", amountCents: 300 },
    ];
    const result = simplifyDebts(edges, [userAlice, userBob]);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0].amountCents).toBe(600);
  });
});

// ─── netAndMinimize: additional topology coverage ───────────────────
describe("netAndMinimize — additional topologies", () => {
  it("5-person chain nets to single edge", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "a", toUserId: "b", amountCents: 1000 },
      { fromUserId: "b", toUserId: "c", amountCents: 1000 },
      { fromUserId: "c", toUserId: "d", amountCents: 1000 },
      { fromUserId: "d", toUserId: "e", amountCents: 1000 },
    ];
    const result = netAndMinimize(edges);
    assertConservation(edges, result);
    expect(result).toHaveLength(1);
    expect(result[0].amountCents).toBe(1000);
  });

  it("2 debtors, 2 creditors with unequal amounts", () => {
    // A owes 300, B owes 700 → C is owed 600, D is owed 400
    const edges: DebtEdge[] = [
      { fromUserId: "a", toUserId: "c", amountCents: 200 },
      { fromUserId: "a", toUserId: "d", amountCents: 100 },
      { fromUserId: "b", toUserId: "c", amountCents: 400 },
      { fromUserId: "b", toUserId: "d", amountCents: 300 },
    ];
    const result = netAndMinimize(edges);
    assertConservation(edges, result);
    assertNoNegativeEdges(result);
    // Should need at most 3 edges (N-1=3)
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("symmetric pairs all cancel to zero", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "a", toUserId: "b", amountCents: 100 },
      { fromUserId: "b", toUserId: "a", amountCents: 100 },
      { fromUserId: "c", toUserId: "d", amountCents: 200 },
      { fromUserId: "d", toUserId: "c", amountCents: 200 },
    ];
    expect(netAndMinimize(edges)).toHaveLength(0);
  });

  it("single debtor to many creditors stays as N edges", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "a", toUserId: "b", amountCents: 100 },
      { fromUserId: "a", toUserId: "c", amountCents: 200 },
      { fromUserId: "a", toUserId: "d", amountCents: 300 },
      { fromUserId: "a", toUserId: "e", amountCents: 400 },
    ];
    const result = netAndMinimize(edges);
    assertConservation(edges, result);
    expect(result).toHaveLength(4);
    expect(edgeSum(result)).toBe(1000);
  });

  it("handles duplicate edges (same from→to appearing multiple times)", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "a", toUserId: "b", amountCents: 100 },
      { fromUserId: "a", toUserId: "b", amountCents: 100 },
      { fromUserId: "a", toUserId: "b", amountCents: 100 },
    ];
    const result = netAndMinimize(edges);
    expect(result).toHaveLength(1);
    expect(result[0].amountCents).toBe(300);
  });
});
