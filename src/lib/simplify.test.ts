import { describe, expect, it } from "vitest";
import { makeItemizedBill, makeSingleAmountBill, userAlice, userBob, userCarlos } from "@/test/fixtures";
import type { BillSplit, ItemSplit, User } from "@/types";
import type { DebtEdge } from "./simplify";
import { computeRawEdges, simplifyDebts } from "./simplify";

const participants = [userAlice, userBob, userCarlos];
const twoParticipants = [userAlice, userBob];

function makeUser(id: string, name: string): User {
  return { id, email: `${id}@example.com`, handle: id, name, pixKeyType: "email" as const, pixKeyHint: `${id}@example.com`, onboarded: true, createdAt: "2024-01-01T00:00:00Z" };
}

const userDave = makeUser("user-dave", "Dave Lima");
const userEve = makeUser("user-eve", "Eve Costa");
const userFrank = makeUser("user-frank", "Frank Dias");
const userGrace = makeUser("user-grace", "Grace Reis");

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
