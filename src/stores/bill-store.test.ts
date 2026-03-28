import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userAlice, userBob, userCarlos, makeItemizedBill, makeSingleAmountBill, makeBillItem } from "@/test/fixtures";
import { useBillStore, calculateShares, computeEdgesFromShares } from "./bill-store";
import type { ExpenseShare, ItemSplit, BillSplit } from "@/types";

vi.mock("@/lib/supabase/payment-actions", () => ({
  recordPayment: vi.fn(),
}));

import { recordPayment } from "@/lib/supabase/payment-actions";

function setup() {
  const s = useBillStore.getState();
  s.setCurrentUser(userAlice);
  return s;
}

beforeEach(() => {
  useBillStore.getState().reset();
  useBillStore.setState({ currentUser: null });
});

afterEach(() => {
  useBillStore.getState().reset();
  useBillStore.setState({ currentUser: null });
});

describe("createBill", () => {
  it("creates an itemized bill with 10% service fee", () => {
    setup().createBill("Jantar", "itemized");
    const { bill } = useBillStore.getState();
    expect(bill?.billType).toBe("itemized");
    expect(bill?.serviceFeePercent).toBe(10);
    expect(bill?.status).toBe("draft");
  });

  it("creates a single_amount bill with 0% service fee", () => {
    setup().createBill("Aluguel", "single_amount");
    const { bill } = useBillStore.getState();
    expect(bill?.billType).toBe("single_amount");
    expect(bill?.serviceFeePercent).toBe(0);
  });

  it("sets currentUser as first participant", () => {
    setup().createBill("Test", "itemized");
    const { participants } = useBillStore.getState();
    expect(participants).toHaveLength(1);
    expect(participants[0].id).toBe("user-alice");
  });
});

describe("splitItemEqually", () => {
  function setupItemizedBill() {
    const s = setup();
    s.createBill("Test", "itemized");
    s.addItem({ description: "Pizza", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    return useBillStore.getState();
  }

  it("splits 10000 cents equally among 3 people", () => {
    const s = setupItemizedBill();
    const itemId = useBillStore.getState().items[0].id;
    s.addParticipant(userBob);
    s.addParticipant(userCarlos);
    s.splitItemEqually(itemId, ["user-alice", "user-bob", "user-carlos"]);
    const splits = useBillStore.getState().splits;
    const amounts = splits.map((s) => s.computedAmountCents).sort((a, b) => b - a);
    expect(amounts).toEqual([3334, 3333, 3333]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it("splits 100 cents equally among 2 people", () => {
    const s = setupItemizedBill();
    useBillStore.getState().updateItem(useBillStore.getState().items[0].id, { totalPriceCents: 100, unitPriceCents: 100 });
    const itemId = useBillStore.getState().items[0].id;
    s.addParticipant(userBob);
    s.splitItemEqually(itemId, ["user-alice", "user-bob"]);
    const amounts = useBillStore.getState().splits.map((s) => s.computedAmountCents);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(amounts.every((a) => a === 50)).toBe(true);
  });

  it("splits 100 cents among 3 people with remainder distribution", () => {
    const s = setupItemizedBill();
    useBillStore.getState().updateItem(useBillStore.getState().items[0].id, { totalPriceCents: 100, unitPriceCents: 100 });
    const itemId = useBillStore.getState().items[0].id;
    s.addParticipant(userBob);
    s.addParticipant(userCarlos);
    s.splitItemEqually(itemId, ["user-alice", "user-bob", "user-carlos"]);
    const amounts = useBillStore.getState().splits.map((s) => s.computedAmountCents).sort((a, b) => b - a);
    expect(amounts).toEqual([34, 33, 33]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("is a no-op when userIds is empty", () => {
    const s = setupItemizedBill();
    const itemId = useBillStore.getState().items[0].id;
    s.splitItemEqually(itemId, []);
    expect(useBillStore.getState().splits).toHaveLength(0);
  });
});

describe("splitBillEqually", () => {
  function setupSingleAmountBill(totalAmountInput: number) {
    const s = setup();
    s.createBill("Test", "single_amount");
    s.updateBill({ totalAmountInput });
    s.addParticipant(userBob);
    return useBillStore.getState();
  }

  it("splits total equally and sum matches totalAmountInput", () => {
    const s = setupSingleAmountBill(10000);
    s.splitBillEqually(["user-alice", "user-bob"]);
    const splits = useBillStore.getState().billSplits;
    expect(splits).toHaveLength(2);
    expect(splits.reduce((sum, s) => sum + s.computedAmountCents, 0)).toBe(10000);
  });

  it("applies remainder to first person when not evenly divisible", () => {
    const s = setupSingleAmountBill(10001);
    s.splitBillEqually(["user-alice", "user-bob"]);
    const amounts = useBillStore.getState().billSplits.map((s) => s.computedAmountCents).sort((a, b) => b - a);
    expect(amounts[0]).toBe(5001);
    expect(amounts[1]).toBe(5000);
  });
});

describe("splitBillByPercentage", () => {
  function setupSingleAmountBill() {
    const s = setup();
    s.createBill("Test", "single_amount");
    s.updateBill({ totalAmountInput: 10000 });
    return useBillStore.getState();
  }

  it("50/50 split of 10000 cents", () => {
    const s = setupSingleAmountBill();
    s.splitBillByPercentage([
      { userId: "user-alice", percentage: 50 },
      { userId: "user-bob", percentage: 50 },
    ]);
    const splits = useBillStore.getState().billSplits;
    expect(splits.every((s) => s.computedAmountCents === 5000)).toBe(true);
  });

  it("100% to one person", () => {
    const s = setupSingleAmountBill();
    s.splitBillByPercentage([{ userId: "user-alice", percentage: 100 }]);
    expect(useBillStore.getState().billSplits[0].computedAmountCents).toBe(10000);
  });
});

describe("splitPaymentEqually", () => {
  it("splits grand total equally and sum matches", () => {
    const s = setup();
    s.createBill("Test", "single_amount");
    s.updateBill({ totalAmountInput: 9999 });
    s.addParticipant(userBob);
    s.addParticipant(userCarlos);
    s.splitPaymentEqually(["user-alice", "user-bob", "user-carlos"]);
    const payers = useBillStore.getState().bill!.payers;
    expect(payers).toHaveLength(3);
    expect(payers.reduce((sum, p) => sum + p.amountCents, 0)).toBe(9999);
  });
});

describe("getGrandTotal", () => {
  it("returns 0 when no bill", () => {
    expect(useBillStore.getState().getGrandTotal()).toBe(0);
  });

  it("returns totalAmountInput for single_amount bill", () => {
    setup().createBill("Test", "single_amount");
    useBillStore.getState().updateBill({ totalAmountInput: 5000 });
    expect(useBillStore.getState().getGrandTotal()).toBe(5000);
  });

  it("returns items + service fee + fixed fees for itemized bill", () => {
    setup().createBill("Test", "itemized");
    useBillStore.getState().addItem({ description: "X", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    useBillStore.getState().updateBill({ fixedFees: 500 });
    // 10000 items + 10% service fee (1000) + 500 fixed = 11500
    expect(useBillStore.getState().getGrandTotal()).toBe(11500);
  });

  it("returns 0 for empty itemized bill with no items", () => {
    setup().createBill("Test", "itemized");
    expect(useBillStore.getState().getGrandTotal()).toBe(0);
  });
});

describe("getParticipantTotal", () => {
  it("returns 0 when no bill", () => {
    expect(useBillStore.getState().getParticipantTotal("user-alice")).toBe(0);
  });

  it("returns matching billSplit amount for single_amount bill", () => {
    setup().createBill("Test", "single_amount");
    useBillStore.getState().updateBill({ totalAmountInput: 10000 });
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().splitBillEqually(["user-alice", "user-bob"]);
    expect(useBillStore.getState().getParticipantTotal("user-alice")).toBe(5000);
  });

  it("sum of all participant totals equals getGrandTotal (invariant)", () => {
    setup().createBill("Test", "itemized");
    const { addParticipant, addItem, splitItemEqually, getGrandTotal, getParticipantTotal } = useBillStore.getState();
    addParticipant(userBob);
    addItem({ description: "Pizza", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    splitItemEqually(itemId, ["user-alice", "user-bob"]);
    const grandTotal = getGrandTotal();
    const participantSum = ["user-alice", "user-bob"].reduce((sum, id) => sum + getParticipantTotal(id), 0);
    // Allow 1-centavo rounding tolerance across fee distributions
    expect(Math.abs(participantSum - grandTotal)).toBeLessThanOrEqual(1);
  });
});

describe("computeShares", () => {
  it("produces shares for two participants with one payer", () => {
    const s = setup();
    s.createBill("Test", "itemized");
    useBillStore.getState().addParticipant(userBob);
    const { addItem, splitItemEqually, setPayerFull, computeShares } = useBillStore.getState();
    addItem({ description: "X", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    splitItemEqually(itemId, ["user-alice", "user-bob"]);
    setPayerFull("user-alice");
    computeShares();
    const { shares } = useBillStore.getState();
    expect(shares).toHaveLength(2);

    const alice = shares.find((s) => s.userId === "user-alice")!;
    const bob = shares.find((s) => s.userId === "user-bob")!;

    // Alice paid 11000 (10000 items + 1000 service fee), owed 5500 (5000 + 500 fee)
    expect(alice.paidCents).toBe(11000);
    expect(alice.owedCents).toBe(5500);
    expect(alice.netCents).toBe(5500); // creditor

    // Bob paid 0, owed 5500 (5000 + 500 fee)
    expect(bob.paidCents).toBe(0);
    expect(bob.owedCents).toBe(5500);
    expect(bob.netCents).toBe(-5500); // debtor
  });

  it("produces net-zero shares when payer consumed everything", () => {
    const s = setup();
    s.createBill("Test", "itemized");
    const { addItem, assignItem, setPayerFull, computeShares } = useBillStore.getState();
    addItem({ description: "X", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    assignItem(itemId, "user-alice", "fixed", 10000);
    setPayerFull("user-alice");
    computeShares();
    const { shares, bill } = useBillStore.getState();
    expect(shares).toHaveLength(1);
    expect(shares[0].netCents).toBe(0);
    expect(bill?.status).toBe("settled");
  });

  it("uses creator as fallback payer when payers array is empty", () => {
    const s = setup();
    s.createBill("Test", "single_amount");
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().updateBill({ totalAmountInput: 10000 });
    useBillStore.getState().splitBillEqually(["user-alice", "user-bob"]);
    // Don't set payers — should fall back to creator (alice)
    useBillStore.getState().computeShares();
    const { shares } = useBillStore.getState();
    const alice = shares.find((s) => s.userId === "user-alice")!;
    expect(alice.paidCents).toBe(10000);
    expect(alice.owedCents).toBe(5000);
    expect(alice.netCents).toBe(5000);
  });

  it("sets bill status to active when shares have non-zero net", () => {
    setup().createBill("Test", "single_amount");
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().updateBill({ totalAmountInput: 10000 });
    useBillStore.getState().splitBillEqually(["user-alice", "user-bob"]);
    useBillStore.getState().setPayerFull("user-alice");
    useBillStore.getState().computeShares();
    expect(useBillStore.getState().bill?.status).toBe("active");
  });
});

describe("calculateShares (standalone)", () => {
  it("returns empty array when no participants", () => {
    const bill = makeItemizedBill();
    const shares = calculateShares(bill, [], [], [], []);
    expect(shares).toEqual([]);
  });

  it("handles single_amount bill correctly", () => {
    const bill = makeSingleAmountBill({ payers: [{ userId: "user-alice", amountCents: 10000 }] });
    const billSplits: BillSplit[] = [
      { userId: "user-alice", splitType: "equal", value: 50, computedAmountCents: 5000 },
      { userId: "user-bob", splitType: "equal", value: 50, computedAmountCents: 5000 },
    ];
    const shares = calculateShares(bill, [userAlice, userBob], [], [], billSplits);

    expect(shares).toHaveLength(2);
    const alice = shares.find((s) => s.userId === "user-alice")!;
    const bob = shares.find((s) => s.userId === "user-bob")!;
    expect(alice.paidCents).toBe(10000);
    expect(alice.owedCents).toBe(5000);
    expect(alice.netCents).toBe(5000);
    expect(bob.paidCents).toBe(0);
    expect(bob.owedCents).toBe(5000);
    expect(bob.netCents).toBe(-5000);
  });

  it("handles itemized bill with service fee distributed proportionally", () => {
    const bill = makeItemizedBill({
      payers: [{ userId: "user-alice", amountCents: 11000 }],
    });
    const items = [makeBillItem({ totalPriceCents: 10000 })];
    const splits: ItemSplit[] = [
      { id: "s1", itemId: "item-1", userId: "user-alice", splitType: "fixed", value: 6000, computedAmountCents: 6000 },
      { id: "s2", itemId: "item-1", userId: "user-bob", splitType: "fixed", value: 4000, computedAmountCents: 4000 },
    ];

    const shares = calculateShares(bill, [userAlice, userBob], items, splits, []);

    const alice = shares.find((s) => s.userId === "user-alice")!;
    const bob = shares.find((s) => s.userId === "user-bob")!;

    // Service fee = 10% of 10000 = 1000, distributed proportionally:
    // Alice: 6000/10000 * 1000 = 600, total owed = 6600
    // Bob: 4000/10000 * 1000 = 400, total owed = 4400
    expect(alice.owedCents).toBe(6600);
    expect(bob.owedCents).toBe(4400);
    expect(alice.netCents).toBe(11000 - 6600);
    expect(bob.netCents).toBe(-4400);
  });

  it("handles itemized bill with fixed fees distributed evenly", () => {
    const bill = makeItemizedBill({
      payers: [{ userId: "user-alice", amountCents: 11000 }],
      fixedFees: 300,
    });
    const items = [makeBillItem({ totalPriceCents: 10000 })];
    const splits: ItemSplit[] = [
      { id: "s1", itemId: "item-1", userId: "user-alice", splitType: "equal", value: 50, computedAmountCents: 5000 },
      { id: "s2", itemId: "item-1", userId: "user-bob", splitType: "equal", value: 50, computedAmountCents: 5000 },
    ];

    const shares = calculateShares(bill, [userAlice, userBob], items, splits, []);

    // Service fee = 1000, fixed fee = 300
    // Alice: 5000 item + 500 svc + 150 fixed = 5650
    // Bob: 5000 item + 500 svc + 150 fixed = 5650
    const alice = shares.find((s) => s.userId === "user-alice")!;
    const bob = shares.find((s) => s.userId === "user-bob")!;
    expect(alice.owedCents).toBe(5650);
    expect(bob.owedCents).toBe(5650);
  });

  it("preserves netCents invariant: sum of all netCents equals totalPaid minus totalOwed (should be ~0)", () => {
    const bill = makeItemizedBill({
      payers: [
        { userId: "user-alice", amountCents: 7000 },
        { userId: "user-bob", amountCents: 4000 },
      ],
    });
    const items = [makeBillItem({ totalPriceCents: 10000 })];
    const splits: ItemSplit[] = [
      { id: "s1", itemId: "item-1", userId: "user-alice", splitType: "fixed", value: 7000, computedAmountCents: 7000 },
      { id: "s2", itemId: "item-1", userId: "user-bob", splitType: "fixed", value: 3000, computedAmountCents: 3000 },
    ];

    const shares = calculateShares(bill, [userAlice, userBob], items, splits, []);
    const netSum = shares.reduce((sum, s) => sum + s.netCents, 0);
    // Net should be zero (paid - owed for everyone sums to 0)
    expect(Math.abs(netSum)).toBeLessThanOrEqual(1);
  });
});

describe("computeEdgesFromShares", () => {
  it("produces one edge for simple debtor-creditor pair", () => {
    const shares: ExpenseShare[] = [
      { billId: "bill-1", userId: "user-alice", paidCents: 10000, owedCents: 5000, netCents: 5000, createdAt: "" },
      { billId: "bill-1", userId: "user-bob", paidCents: 0, owedCents: 5000, netCents: -5000, createdAt: "" },
    ];
    const edges = computeEdgesFromShares(shares);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5000 });
  });

  it("produces no edges when all shares are net-zero", () => {
    const shares: ExpenseShare[] = [
      { billId: "bill-1", userId: "user-alice", paidCents: 5000, owedCents: 5000, netCents: 0, createdAt: "" },
      { billId: "bill-1", userId: "user-bob", paidCents: 5000, owedCents: 5000, netCents: 0, createdAt: "" },
    ];
    const edges = computeEdgesFromShares(shares);
    expect(edges).toHaveLength(0);
  });

  it("produces two edges when one creditor and two debtors", () => {
    const shares: ExpenseShare[] = [
      { billId: "bill-1", userId: "user-alice", paidCents: 9000, owedCents: 3000, netCents: 6000, createdAt: "" },
      { billId: "bill-1", userId: "user-bob", paidCents: 0, owedCents: 3000, netCents: -3000, createdAt: "" },
      { billId: "bill-1", userId: "user-carlos", paidCents: 0, owedCents: 3000, netCents: -3000, createdAt: "" },
    ];
    const edges = computeEdgesFromShares(shares);
    expect(edges).toHaveLength(2);
    expect(edges.reduce((sum, e) => sum + e.amountCents, 0)).toBe(6000);
    // Both edges should go TO alice
    expect(edges.every((e) => e.toUserId === "user-alice")).toBe(true);
  });

  it("handles chain: multiple creditors and debtors", () => {
    // Alice is owed 4000, Carlos is owed 1000
    // Bob owes 3000
    const shares: ExpenseShare[] = [
      { billId: "bill-1", userId: "user-alice", paidCents: 10000, owedCents: 6000, netCents: 4000, createdAt: "" },
      { billId: "bill-1", userId: "user-bob", paidCents: 0, owedCents: 3000, netCents: -3000, createdAt: "" },
      { billId: "bill-1", userId: "user-carlos", paidCents: 2000, owedCents: 1000, netCents: 1000, createdAt: "" },
    ];
    const edges = computeEdgesFromShares(shares);
    // Total debt (3000) < total credit (5000), so flow = 3000
    const totalFlow = edges.reduce((sum, e) => sum + e.amountCents, 0);
    expect(totalFlow).toBe(3000);
    expect(edges.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores shares with netCents within rounding tolerance (-1 to 1)", () => {
    const shares: ExpenseShare[] = [
      { billId: "bill-1", userId: "user-alice", paidCents: 5001, owedCents: 5000, netCents: 1, createdAt: "" },
      { billId: "bill-1", userId: "user-bob", paidCents: 4999, owedCents: 5000, netCents: -1, createdAt: "" },
    ];
    const edges = computeEdgesFromShares(shares);
    expect(edges).toHaveLength(0);
  });

  it("edges preserve total debt amount invariant", () => {
    const shares: ExpenseShare[] = [
      { billId: "bill-1", userId: "user-alice", paidCents: 10000, owedCents: 2000, netCents: 8000, createdAt: "" },
      { billId: "bill-1", userId: "user-bob", paidCents: 0, owedCents: 4000, netCents: -4000, createdAt: "" },
      { billId: "bill-1", userId: "user-carlos", paidCents: 0, owedCents: 4000, netCents: -4000, createdAt: "" },
    ];
    const edges = computeEdgesFromShares(shares);
    const totalOwed = shares.filter((s) => s.netCents < 0).reduce((sum, s) => sum + Math.abs(s.netCents), 0);
    const totalEdges = edges.reduce((sum, e) => sum + e.amountCents, 0);
    expect(totalEdges).toBe(totalOwed);
  });

  it("works with computeEdgesFromShares chained after calculateShares", () => {
    const bill = makeSingleAmountBill({ payers: [{ userId: "user-alice", amountCents: 9000 }] });
    bill.totalAmountInput = 9000;
    const billSplits: BillSplit[] = [
      { userId: "user-alice", splitType: "equal", value: 33.33, computedAmountCents: 3000 },
      { userId: "user-bob", splitType: "equal", value: 33.33, computedAmountCents: 3000 },
      { userId: "user-carlos", splitType: "equal", value: 33.34, computedAmountCents: 3000 },
    ];
    const shares = calculateShares(bill, [userAlice, userBob, userCarlos], [], [], billSplits);
    const edges = computeEdgesFromShares(shares);

    // Alice paid 9000, owed 3000 → net +6000
    // Bob paid 0, owed 3000 → net -3000
    // Carlos paid 0, owed 3000 → net -3000
    expect(edges).toHaveLength(2);
    const totalFlow = edges.reduce((sum, e) => sum + e.amountCents, 0);
    expect(totalFlow).toBe(6000);
  });
});

describe("markPaid", () => {
  function setupLedger() {
    const s = setup();
    s.createBill("Test", "single_amount");
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().updateBill({ totalAmountInput: 10000 });
    useBillStore.getState().splitBillEqually(["user-alice", "user-bob"]);
    useBillStore.getState().setPayerFull("user-alice");
    useBillStore.getState().computeShares();
    // Compute edges and populate ledger from shares for markPaid tests
    const { shares } = useBillStore.getState();
    const edges = computeEdgesFromShares(shares);
    const now = new Date().toISOString();
    useBillStore.setState({
      ledger: edges.map((e, i) => ({
        id: `entry-${i}`,
        billId: useBillStore.getState().bill!.id,
        entryType: "debt" as const,
        fromUserId: e.fromUserId,
        toUserId: e.toUserId,
        amountCents: e.amountCents,
        paidAmountCents: 0,
        status: "pending" as const,
        createdAt: now,
      })),
    });
    return useBillStore.getState().ledger[0].id;
  }

  it("markPaid sets status to settled", () => {
    const entryId = setupLedger();
    useBillStore.getState().markPaid(entryId);
    const entry = useBillStore.getState().ledger.find((e) => e.id === entryId);
    expect(entry?.status).toBe("settled");
    expect(entry?.paidAt).toBeDefined();
  });

  it("bill status becomes settled when all entries paid", () => {
    const entryId = setupLedger();
    useBillStore.getState().markPaid(entryId);
    expect(useBillStore.getState().bill?.status).toBe("settled");
  });

  it("bill status becomes partially_settled when only some entries paid", () => {
    setup().createBill("Test", "single_amount");
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().addParticipant(userCarlos);
    useBillStore.getState().updateBill({ totalAmountInput: 9999 });
    useBillStore.getState().splitBillEqually(["user-alice", "user-bob", "user-carlos"]);
    useBillStore.getState().setPayerFull("user-alice");
    useBillStore.getState().computeShares();
    const { shares } = useBillStore.getState();
    const edges = computeEdgesFromShares(shares);
    const now = new Date().toISOString();
    useBillStore.setState({
      ledger: edges.map((e, i) => ({
        id: `entry-${i}`,
        billId: useBillStore.getState().bill!.id,
        entryType: "debt" as const,
        fromUserId: e.fromUserId,
        toUserId: e.toUserId,
        amountCents: e.amountCents,
        paidAmountCents: 0,
        status: "pending" as const,
        createdAt: now,
      })),
    });
    const { ledger } = useBillStore.getState();
    expect(ledger.length).toBeGreaterThan(1);
    useBillStore.getState().markPaid(ledger[0].id);
    expect(useBillStore.getState().bill?.status).toBe("partially_settled");
  });
});

describe("createPayment", () => {
  beforeEach(() => {
    vi.mocked(recordPayment).mockReset();
  });

  it("calls recordPayment and adds offsetting shares to store", async () => {
    vi.mocked(recordPayment).mockResolvedValue({ billId: "payment-bill-1" });
    setup().createBill("Test", "single_amount");

    const result = await useBillStore.getState().createPayment("user-bob", "user-alice", 5000);

    expect(recordPayment).toHaveBeenCalledWith("user-bob", "user-alice", 5000, undefined);
    expect(result.billId).toBe("payment-bill-1");
    const { shares } = useBillStore.getState();
    const paymentShares = shares.filter((s) => s.billId === "payment-bill-1");
    expect(paymentShares).toHaveLength(2);
    const bobShare = paymentShares.find((s) => s.userId === "user-bob")!;
    const aliceShare = paymentShares.find((s) => s.userId === "user-alice")!;
    expect(bobShare.paidCents).toBe(5000);
    expect(bobShare.owedCents).toBe(0);
    expect(bobShare.netCents).toBe(5000);
    expect(aliceShare.paidCents).toBe(0);
    expect(aliceShare.owedCents).toBe(5000);
    expect(aliceShare.netCents).toBe(-5000);
  });

  it("passes groupId to recordPayment", async () => {
    vi.mocked(recordPayment).mockResolvedValue({ billId: "payment-bill-1" });
    setup().createBill("Test", "single_amount");

    await useBillStore.getState().createPayment("user-bob", "user-alice", 3000, "group-1");

    expect(recordPayment).toHaveBeenCalledWith("user-bob", "user-alice", 3000, "group-1");
  });

  it("returns error when recordPayment fails", async () => {
    vi.mocked(recordPayment).mockResolvedValue({ error: "Not authorized" });
    setup().createBill("Test", "single_amount");

    const result = await useBillStore.getState().createPayment("user-bob", "user-alice", 5000);

    expect(result.error).toBe("Not authorized");
    expect(result.billId).toBeUndefined();
  });

  it("does not add shares when recordPayment fails", async () => {
    vi.mocked(recordPayment).mockResolvedValue({ error: "Fail" });
    setup().createBill("Test", "single_amount");

    const sharesBefore = useBillStore.getState().shares.length;
    await useBillStore.getState().createPayment("user-bob", "user-alice", 5000);
    expect(useBillStore.getState().shares.length).toBe(sharesBefore);
  });
});
