import { describe, it, expect } from "vitest";
import {
  computeRawEdges,
  simplifyDebts,
  type DebtEdge,
} from "@/lib/simplify";
import type { Bill, BillSplit, ItemSplit, User } from "@/types";

// --- Helpers ---

function makeUser(id: string, name: string): User {
  return {
    id,
    email: `${id}@test.com`,
    handle: id,
    name,
    pixKeyType: "email",
    pixKeyHint: `${id}@test.com`,
    onboarded: true,
    createdAt: new Date().toISOString(),
  };
}

function totalFlow(edges: DebtEdge[]): number {
  return edges.reduce((s, e) => s + e.amountCents, 0);
}

function netBalances(edges: DebtEdge[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of edges) {
    m.set(e.fromUserId, (m.get(e.fromUserId) || 0) - e.amountCents);
    m.set(e.toUserId, (m.get(e.toUserId) || 0) + e.amountCents);
  }
  return m;
}

function balancesEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  const allKeys = new Set([...a.keys(), ...b.keys()]);
  for (const k of allKeys) {
    if (Math.abs((a.get(k) || 0) - (b.get(k) || 0)) > 1) return false;
  }
  return true;
}

const alice = makeUser("alice", "Alice");
const bob = makeUser("bob", "Bob");
const carol = makeUser("carol", "Carol");
const dave = makeUser("dave", "Dave");
const eve = makeUser("eve", "Eve");

// --- computeRawEdges tests ---

describe("computeRawEdges", () => {
  it("single payer, equal split, 3 people", () => {
    const bill: Bill = {
      id: "b1",
      creatorId: "alice",
      billType: "single_amount",
      title: "Dinner",
      status: "active",
      serviceFeePercent: 0,
      fixedFees: 0,
      totalAmount: 0,
      totalAmountInput: 9000, // R$90
      payers: [{ userId: "alice", amountCents: 9000 }],
      createdAt: "",
      updatedAt: "",
    };

    const billSplits: BillSplit[] = [
      { userId: "alice", splitType: "equal", value: 33.33, computedAmountCents: 3000 },
      { userId: "bob", splitType: "equal", value: 33.33, computedAmountCents: 3000 },
      { userId: "carol", splitType: "equal", value: 33.33, computedAmountCents: 3000 },
    ];

    const edges = computeRawEdges(bill, [alice, bob, carol], [], billSplits, []);

    // Bob and Carol each owe Alice R$30
    expect(edges).toHaveLength(2);
    expect(edges.find((e) => e.fromUserId === "bob")?.amountCents).toBe(3000);
    expect(edges.find((e) => e.fromUserId === "carol")?.amountCents).toBe(3000);
    expect(edges.every((e) => e.toUserId === "alice")).toBe(true);
  });

  it("two payers, proportional debt", () => {
    const bill: Bill = {
      id: "b2",
      creatorId: "alice",
      billType: "single_amount",
      title: "Lunch",
      status: "active",
      serviceFeePercent: 0,
      fixedFees: 0,
      totalAmount: 0,
      totalAmountInput: 10000,
      payers: [
        { userId: "alice", amountCents: 7000 },
        { userId: "bob", amountCents: 3000 },
      ],
      createdAt: "",
      updatedAt: "",
    };

    const billSplits: BillSplit[] = [
      { userId: "carol", splitType: "fixed", value: 10000, computedAmountCents: 10000 },
    ];

    const edges = computeRawEdges(bill, [alice, bob, carol], [], billSplits, []);

    // Carol consumed everything (R$100). She owes:
    // Alice: 10000 * (7000/10000) = 7000
    // Bob:   10000 * (3000/10000) = 3000
    expect(edges).toHaveLength(2);
    expect(edges.find((e) => e.toUserId === "alice")?.amountCents).toBe(7000);
    expect(edges.find((e) => e.toUserId === "bob")?.amountCents).toBe(3000);
  });

  it("no self-debt: payer who consumed generates no edge to self", () => {
    const bill: Bill = {
      id: "b3",
      creatorId: "alice",
      billType: "single_amount",
      title: "Solo",
      status: "active",
      serviceFeePercent: 0,
      fixedFees: 0,
      totalAmount: 0,
      totalAmountInput: 5000,
      payers: [{ userId: "alice", amountCents: 5000 }],
      createdAt: "",
      updatedAt: "",
    };

    const billSplits: BillSplit[] = [
      { userId: "alice", splitType: "equal", value: 100, computedAmountCents: 5000 },
    ];

    const edges = computeRawEdges(bill, [alice], [], billSplits, []);
    expect(edges).toHaveLength(0);
  });

  it("itemized bill with service fee and fixed fees", () => {
    const bill: Bill = {
      id: "b4",
      creatorId: "alice",
      billType: "itemized",
      title: "Restaurant",
      status: "active",
      serviceFeePercent: 10,
      fixedFees: 600, // R$6 couvert (R$3 each)
      totalAmount: 10000,
      totalAmountInput: 0,
      payers: [{ userId: "alice", amountCents: 11600 }], // items(10000) + service(1000) + fixed(600)
      createdAt: "",
      updatedAt: "",
    };

    const items = [
      { totalPriceCents: 6000 }, // item1
      { totalPriceCents: 4000 }, // item2
    ];

    const itemSplits: ItemSplit[] = [
      { id: "s1", itemId: "i1", userId: "alice", splitType: "fixed", value: 6000, computedAmountCents: 6000 },
      { id: "s2", itemId: "i2", userId: "bob", splitType: "fixed", value: 4000, computedAmountCents: 4000 },
    ];

    const edges = computeRawEdges(bill, [alice, bob], itemSplits, [], items);

    // Bob consumed: items(4000) + service(4000/10000 * 1000 = 400) + fixed(300) = 4700
    // Alice consumed: items(6000) + service(6000/10000 * 1000 = 600) + fixed(300) = 6900
    // Alice paid 11600, consumed 6900 → creditor for 4700
    // Bob paid 0, consumed 4700 → debtor for 4700
    const bobEdge = edges.find((e) => e.fromUserId === "bob");
    expect(bobEdge).toBeDefined();
    expect(bobEdge!.amountCents).toBe(4700);
    expect(bobEdge!.toUserId).toBe("alice");
  });

  it("returns empty edges when totalPaid is 0", () => {
    const bill: Bill = {
      id: "b5",
      creatorId: "alice",
      billType: "single_amount",
      title: "Empty",
      status: "draft",
      serviceFeePercent: 0,
      fixedFees: 0,
      totalAmount: 0,
      totalAmountInput: 0,
      payers: [],
      createdAt: "",
      updatedAt: "",
    };

    const edges = computeRawEdges(bill, [alice, bob], [], [], []);
    expect(edges).toHaveLength(0);
  });
});

// --- simplifyDebts tests ---

describe("simplifyDebts", () => {
  it("Scenario A: triangle → simplified", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "alice", toUserId: "bob", amountCents: 10000 },
      { fromUserId: "bob", toUserId: "carol", amountCents: 8000 },
      { fromUserId: "carol", toUserId: "alice", amountCents: 6000 },
    ];

    const result = simplifyDebts(edges, [alice, bob, carol]);

    // Net balances: Alice = -10000+6000 = -4000, Bob = +10000-8000 = +2000, Carol = +8000-6000 = +2000
    // Simplified: Alice → Bob: 2000, Alice → Carol: 2000 (or equivalent)
    expect(result.simplifiedCount).toBeLessThanOrEqual(result.originalCount);

    // Verify net balances are preserved
    const origBal = netBalances(result.originalEdges);
    const simpBal = netBalances(result.simplifiedEdges);
    expect(balancesEqual(origBal, simpBal)).toBe(true);
  });

  it("Scenario B: full cycle cancels to zero", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "alice", toUserId: "bob", amountCents: 5000 },
      { fromUserId: "bob", toUserId: "carol", amountCents: 5000 },
      { fromUserId: "carol", toUserId: "alice", amountCents: 5000 },
    ];

    const result = simplifyDebts(edges, [alice, bob, carol]);
    expect(result.simplifiedEdges).toHaveLength(0);
    expect(result.simplifiedCount).toBe(0);
  });

  it("Scenario C: star topology already minimal", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "alice", toUserId: "bob", amountCents: 10000 },
      { fromUserId: "carol", toUserId: "bob", amountCents: 8000 },
      { fromUserId: "dave", toUserId: "bob", amountCents: 6000 },
    ];

    const result = simplifyDebts(edges, [alice, bob, carol, dave]);
    expect(result.simplifiedCount).toBe(3);
  });

  it("Scenario D: reverse pair cancellation", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "alice", toUserId: "bob", amountCents: 8000 },
      { fromUserId: "bob", toUserId: "alice", amountCents: 3000 },
    ];

    const result = simplifyDebts(edges, [alice, bob]);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0].fromUserId).toBe("alice");
    expect(result.simplifiedEdges[0].toUserId).toBe("bob");
    expect(result.simplifiedEdges[0].amountCents).toBe(5000);
  });

  it("Scenario E: 5-person realistic restaurant", () => {
    // Complex scenario: multiple edges from a real bill
    const edges: DebtEdge[] = [
      { fromUserId: "alice", toUserId: "bob", amountCents: 5000 },
      { fromUserId: "carol", toUserId: "bob", amountCents: 3000 },
      { fromUserId: "dave", toUserId: "bob", amountCents: 4000 },
      { fromUserId: "alice", toUserId: "eve", amountCents: 2000 },
      { fromUserId: "carol", toUserId: "eve", amountCents: 1500 },
      { fromUserId: "dave", toUserId: "eve", amountCents: 2500 },
    ];

    const result = simplifyDebts(edges, [alice, bob, carol, dave, eve]);

    // Verify conservation of money
    const origBal = netBalances(result.originalEdges);
    const simpBal = netBalances(result.simplifiedEdges);
    expect(balancesEqual(origBal, simpBal)).toBe(true);

    // Should not increase edge count
    expect(result.simplifiedCount).toBeLessThanOrEqual(result.originalCount);
  });

  it("preserves step history for visualization", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "alice", toUserId: "bob", amountCents: 5000 },
      { fromUserId: "bob", toUserId: "carol", amountCents: 5000 },
    ];

    const result = simplifyDebts(edges, [alice, bob, carol]);
    // Should have at least the initial state step
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.steps[0].description).toBe("Dividas originais");
  });

  it("handles empty edges", () => {
    const result = simplifyDebts([], [alice, bob]);
    expect(result.simplifiedEdges).toHaveLength(0);
    expect(result.simplifiedCount).toBe(0);
  });

  it("handles single edge (no simplification possible)", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "alice", toUserId: "bob", amountCents: 5000 },
    ];

    const result = simplifyDebts(edges, [alice, bob]);
    expect(result.simplifiedEdges).toHaveLength(1);
    expect(result.simplifiedEdges[0].amountCents).toBe(5000);
  });

  it("reverse pair with equal amounts cancels completely", () => {
    const edges: DebtEdge[] = [
      { fromUserId: "alice", toUserId: "bob", amountCents: 5000 },
      { fromUserId: "bob", toUserId: "alice", amountCents: 5000 },
    ];

    const result = simplifyDebts(edges, [alice, bob]);
    expect(result.simplifiedEdges).toHaveLength(0);
  });
});
