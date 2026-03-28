import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userAlice, userBob, userCarlos } from "@/test/fixtures";
import { useBillStore } from "./bill-store";

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

describe("createExpense", () => {
  it("creates an itemized expense with 10% service fee", () => {
    setup().createExpense("Jantar", "itemized");
    const { expense } = useBillStore.getState();
    expect(expense?.expenseType).toBe("itemized");
    expect(expense?.serviceFeePercent).toBe(10);
    expect(expense?.status).toBe("draft");
  });

  it("creates a single_amount expense with 0% service fee", () => {
    setup().createExpense("Aluguel", "single_amount");
    const { expense } = useBillStore.getState();
    expect(expense?.expenseType).toBe("single_amount");
    expect(expense?.serviceFeePercent).toBe(0);
  });

  it("sets currentUser as first participant", () => {
    setup().createExpense("Test", "itemized");
    const { participants } = useBillStore.getState();
    expect(participants).toHaveLength(1);
    expect(participants[0].id).toBe("user-alice");
  });

  it("sets groupId when provided", () => {
    setup().createExpense("Test", "itemized", undefined, "group-123");
    const { expense } = useBillStore.getState();
    expect(expense?.groupId).toBe("group-123");
  });

  it("defaults groupId to empty string when not provided", () => {
    setup().createExpense("Test", "itemized");
    const { expense } = useBillStore.getState();
    expect(expense?.groupId).toBe("");
  });
});

describe("splitItemEqually", () => {
  function setupItemizedExpense() {
    const s = setup();
    s.createExpense("Test", "itemized");
    s.addItem({ description: "Pizza", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    return useBillStore.getState();
  }

  it("splits 10000 cents equally among 3 people", () => {
    const s = setupItemizedExpense();
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
    const s = setupItemizedExpense();
    useBillStore.getState().updateItem(useBillStore.getState().items[0].id, { totalPriceCents: 100, unitPriceCents: 100 });
    const itemId = useBillStore.getState().items[0].id;
    s.addParticipant(userBob);
    s.splitItemEqually(itemId, ["user-alice", "user-bob"]);
    const amounts = useBillStore.getState().splits.map((s) => s.computedAmountCents);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(amounts.every((a) => a === 50)).toBe(true);
  });

  it("splits 100 cents among 3 people with remainder distribution", () => {
    const s = setupItemizedExpense();
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
    const s = setupItemizedExpense();
    const itemId = useBillStore.getState().items[0].id;
    s.splitItemEqually(itemId, []);
    expect(useBillStore.getState().splits).toHaveLength(0);
  });
});

describe("splitBillEqually", () => {
  function setupSingleAmountExpense(totalAmountInput: number) {
    const s = setup();
    s.createExpense("Test", "single_amount");
    s.updateExpense({ totalAmountInput });
    s.addParticipant(userBob);
    return useBillStore.getState();
  }

  it("splits total equally and sum matches totalAmountInput", () => {
    const s = setupSingleAmountExpense(10000);
    s.splitBillEqually(["user-alice", "user-bob"]);
    const splits = useBillStore.getState().billSplits;
    expect(splits).toHaveLength(2);
    expect(splits.reduce((sum, s) => sum + s.computedAmountCents, 0)).toBe(10000);
  });

  it("applies remainder to first person when not evenly divisible", () => {
    const s = setupSingleAmountExpense(10001);
    s.splitBillEqually(["user-alice", "user-bob"]);
    const amounts = useBillStore.getState().billSplits.map((s) => s.computedAmountCents).sort((a, b) => b - a);
    expect(amounts[0]).toBe(5001);
    expect(amounts[1]).toBe(5000);
  });
});

describe("splitBillByPercentage", () => {
  function setupSingleAmountExpense() {
    const s = setup();
    s.createExpense("Test", "single_amount");
    s.updateExpense({ totalAmountInput: 10000 });
    return useBillStore.getState();
  }

  it("50/50 split of 10000 cents", () => {
    const s = setupSingleAmountExpense();
    s.splitBillByPercentage([
      { userId: "user-alice", percentage: 50 },
      { userId: "user-bob", percentage: 50 },
    ]);
    const splits = useBillStore.getState().billSplits;
    expect(splits.every((s) => s.computedAmountCents === 5000)).toBe(true);
  });

  it("100% to one person", () => {
    const s = setupSingleAmountExpense();
    s.splitBillByPercentage([{ userId: "user-alice", percentage: 100 }]);
    expect(useBillStore.getState().billSplits[0].computedAmountCents).toBe(10000);
  });

  it("rejects assignments that sum to less than 100%", () => {
    const s = setupSingleAmountBill();
    s.addParticipant(userBob);
    s.splitBillByPercentage([
      { userId: "user-alice", percentage: 40 },
      { userId: "user-bob", percentage: 40 },
    ]);
    expect(useBillStore.getState().billSplits).toHaveLength(0);
  });

  it("rejects assignments that sum to more than 100%", () => {
    const s = setupSingleAmountBill();
    s.addParticipant(userBob);
    s.splitBillByPercentage([
      { userId: "user-alice", percentage: 60 },
      { userId: "user-bob", percentage: 60 },
    ]);
    expect(useBillStore.getState().billSplits).toHaveLength(0);
  });

  it("accepts assignments that sum to exactly 100 with floating point", () => {
    const s = setupSingleAmountBill();
    s.addParticipant(userBob);
    s.addParticipant(userCarlos);
    // 33.33 + 33.33 + 33.34 = 100
    s.splitBillByPercentage([
      { userId: "user-alice", percentage: 33.33 },
      { userId: "user-bob", percentage: 33.33 },
      { userId: "user-carlos", percentage: 33.34 },
    ]);
    const splits = useBillStore.getState().billSplits;
    expect(splits).toHaveLength(3);
    expect(splits.reduce((sum, sp) => sum + sp.computedAmountCents, 0)).toBe(10000);
  });

  it("is a no-op when no bill exists", () => {
    useBillStore.getState().splitBillByPercentage([
      { userId: "user-alice", percentage: 50 },
      { userId: "user-bob", percentage: 50 },
    ]);
    expect(useBillStore.getState().billSplits).toHaveLength(0);
  });
});

describe("splitPaymentEqually", () => {
  it("splits grand total equally and sum matches", () => {
    const s = setup();
    s.createExpense("Test", "single_amount");
    s.updateExpense({ totalAmountInput: 9999 });
    s.addParticipant(userBob);
    s.addParticipant(userCarlos);
    s.splitPaymentEqually(["user-alice", "user-bob", "user-carlos"]);
    const { payers } = useBillStore.getState();
    expect(payers).toHaveLength(3);
    expect(payers.reduce((sum, p) => sum + p.amountCents, 0)).toBe(9999);
  });
});

describe("getGrandTotal", () => {
  it("returns 0 when no expense", () => {
    expect(useBillStore.getState().getGrandTotal()).toBe(0);
  });

  it("returns totalAmountInput for single_amount expense", () => {
    setup().createExpense("Test", "single_amount");
    useBillStore.getState().updateExpense({ totalAmountInput: 5000 });
    expect(useBillStore.getState().getGrandTotal()).toBe(5000);
  });

  it("returns items + service fee + fixed fees for itemized expense", () => {
    setup().createExpense("Test", "itemized");
    useBillStore.getState().addItem({ description: "X", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    useBillStore.getState().updateExpense({ fixedFees: 500 });
    // 10000 items + 10% service fee (1000) + 500 fixed = 11500
    expect(useBillStore.getState().getGrandTotal()).toBe(11500);
  });

  it("returns 0 for empty itemized expense with no items", () => {
    setup().createExpense("Test", "itemized");
    expect(useBillStore.getState().getGrandTotal()).toBe(0);
  });
});

describe("getParticipantTotal", () => {
  it("returns 0 when no expense", () => {
    expect(useBillStore.getState().getParticipantTotal("user-alice")).toBe(0);
  });

  it("returns matching billSplit amount for single_amount expense", () => {
    setup().createExpense("Test", "single_amount");
    useBillStore.getState().updateExpense({ totalAmountInput: 10000 });
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().splitBillEqually(["user-alice", "user-bob"]);
    expect(useBillStore.getState().getParticipantTotal("user-alice")).toBe(5000);
  });

  it("sum of all participant totals equals getGrandTotal (invariant)", () => {
    setup().createExpense("Test", "itemized");
    const { addParticipant, addItem, splitItemEqually, getGrandTotal, getParticipantTotal } = useBillStore.getState();
    addParticipant(userBob);
    addItem({ description: "Pizza", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    splitItemEqually(itemId, ["user-alice", "user-bob"]);
    const grandTotal = getGrandTotal();
    const participantSum = ["user-alice", "user-bob"].reduce((sum, id) => sum + getParticipantTotal(id), 0);
    expect(participantSum).toBe(grandTotal);
  });

  it("participant totals sum exactly to grandTotal with 3-way split and service fee", () => {
    const s = setup();
    s.createBill("Test", "itemized");
    const { addParticipant, addItem, splitItemEqually, getGrandTotal, getParticipantTotal } = useBillStore.getState();
    addParticipant(userBob);
    addParticipant(userCarlos);
    addItem({ description: "Pizza", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    splitItemEqually(itemId, ["user-alice", "user-bob", "user-carlos"]);
    const grandTotal = getGrandTotal();
    const participantSum = ["user-alice", "user-bob", "user-carlos"].reduce(
      (sum, id) => sum + getParticipantTotal(id), 0,
    );
    expect(participantSum).toBe(grandTotal);
  });

  it("participant totals sum exactly with fixed fees", () => {
    const s = setup();
    s.createBill("Test", "itemized");
    useBillStore.getState().updateBill({ fixedFees: 100 });
    const { addParticipant, addItem, splitItemEqually, getGrandTotal, getParticipantTotal } = useBillStore.getState();
    addParticipant(userBob);
    addItem({ description: "Pizza", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    splitItemEqually(itemId, ["user-alice", "user-bob"]);
    const grandTotal = getGrandTotal();
    const participantSum = ["user-alice", "user-bob"].reduce(
      (sum, id) => sum + getParticipantTotal(id), 0,
    );
    expect(participantSum).toBe(grandTotal);
  });
});

describe("computeLedger", () => {
  it("produces one debt edge for two participants with one payer", () => {
    const s = setup();
    s.createExpense("Test", "itemized");
    useBillStore.getState().addParticipant(userBob);
    const { addItem, splitItemEqually, setPayerFull, computeLedger } = useBillStore.getState();
    addItem({ description: "X", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    splitItemEqually(itemId, ["user-alice", "user-bob"]);
    setPayerFull("user-alice");
    computeLedger();
    const { previewDebts } = useBillStore.getState();
    expect(previewDebts).toHaveLength(1);
    // 5000 item split + 10% service fee (500) = 5500 owed by Bob
    expect(previewDebts[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5500 });
  });

  it("produces no debts when payer consumed everything", () => {
    const s = setup();
    s.createExpense("Test", "itemized");
    const { addItem, assignItem, setPayerFull, computeLedger } = useBillStore.getState();
    addItem({ description: "X", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    assignItem(itemId, "user-alice", "fixed", 10000);
    setPayerFull("user-alice");
    computeLedger();
    const { previewDebts, expense } = useBillStore.getState();
    expect(previewDebts).toHaveLength(0);
    expect(expense?.status).toBe("settled");
  });

  it("uses creator as fallback payer when payers array is empty", () => {
    const s = setup();
    s.createExpense("Test", "single_amount");
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().updateExpense({ totalAmountInput: 10000 });
    useBillStore.getState().splitBillEqually(["user-alice", "user-bob"]);
    // Don't set payers — should fall back to creator (alice)
    useBillStore.getState().computeLedger();
    const { previewDebts } = useBillStore.getState();
    expect(previewDebts).toHaveLength(1);
    expect(previewDebts[0].toUserId).toBe("user-alice");
  });

  it("previewDebts are DebtEdge[] without payment tracking fields", () => {
    const s = setup();
    s.createExpense("Test", "single_amount");
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().updateExpense({ totalAmountInput: 10000 });
    useBillStore.getState().splitBillEqually(["user-alice", "user-bob"]);
    useBillStore.getState().setPayerFull("user-alice");
    useBillStore.getState().computeLedger();
    const { previewDebts } = useBillStore.getState();
    expect(previewDebts).toHaveLength(1);
    const debt = previewDebts[0];
    expect(debt).toHaveProperty("fromUserId");
    expect(debt).toHaveProperty("toUserId");
    expect(debt).toHaveProperty("amountCents");
    // Should NOT have legacy LedgerEntry fields
    expect(debt).not.toHaveProperty("id");
    expect(debt).not.toHaveProperty("status");
    expect(debt).not.toHaveProperty("paidAmountCents");
  });
});

describe("getExpenseShares", () => {
  it("returns shares for single_amount expense", () => {
    const s = setup();
    s.createExpense("Test", "single_amount");
    s.updateExpense({ totalAmountInput: 10000 });
    s.addParticipant(userBob);
    s.splitBillEqually(["user-alice", "user-bob"]);
    const shares = useBillStore.getState().getExpenseShares();
    expect(shares).toHaveLength(2);
    expect(shares.reduce((sum, sh) => sum + sh.shareAmountCents, 0)).toBe(10000);
    expect(shares.every((sh) => sh.expenseId === useBillStore.getState().expense?.id)).toBe(true);
  });

  it("returns shares with fees for itemized expense", () => {
    const s = setup();
    s.createExpense("Test", "itemized");
    s.addParticipant(userBob);
    s.addItem({ description: "X", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    s.splitItemEqually(itemId, ["user-alice", "user-bob"]);
    const shares = useBillStore.getState().getExpenseShares();
    expect(shares).toHaveLength(2);
    // 10000 items + 10% service fee = 11000 total, split equally
    const totalShares = shares.reduce((sum, sh) => sum + sh.shareAmountCents, 0);
    expect(totalShares).toBe(11000);
  });

  it("excludes participants with zero consumption", () => {
    const s = setup();
    s.createExpense("Test", "itemized");
    s.addParticipant(userBob);
    s.addItem({ description: "X", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    // Only assign to alice, not bob
    s.assignItem(itemId, "user-alice", "fixed", 10000);
    const shares = useBillStore.getState().getExpenseShares();
    // Alice gets the item + service fee, bob has no consumption
    expect(shares).toHaveLength(1);
    expect(shares[0].userId).toBe("user-alice");
  });
});

describe("payers as top-level state", () => {
  it("setPayerFull stores payer at top level with expenseId", () => {
    const s = setup();
    s.createExpense("Test", "single_amount");
    s.updateExpense({ totalAmountInput: 5000 });
    s.setPayerFull("user-alice");
    const { payers, expense } = useBillStore.getState();
    expect(payers).toHaveLength(1);
    expect(payers[0].expenseId).toBe(expense?.id);
    expect(payers[0].userId).toBe("user-alice");
    expect(payers[0].amountCents).toBe(5000);
  });

  it("setPayerAmount adds or updates payer", () => {
    const s = setup();
    s.createExpense("Test", "single_amount");
    s.setPayerAmount("user-alice", 3000);
    s.setPayerAmount("user-bob", 2000);
    expect(useBillStore.getState().payers).toHaveLength(2);
    s.setPayerAmount("user-alice", 4000);
    const { payers } = useBillStore.getState();
    expect(payers).toHaveLength(2);
    expect(payers.find((p) => p.userId === "user-alice")?.amountCents).toBe(4000);
  });

  it("removePayerEntry removes payer", () => {
    const s = setup();
    s.createExpense("Test", "single_amount");
    s.setPayerAmount("user-alice", 3000);
    s.setPayerAmount("user-bob", 2000);
    s.removePayerEntry("user-alice");
    expect(useBillStore.getState().payers).toHaveLength(1);
    expect(useBillStore.getState().payers[0].userId).toBe("user-bob");
  });

  it("reset clears payers", () => {
    const s = setup();
    s.createExpense("Test", "single_amount");
    s.setPayerFull("user-alice");
    s.reset();
    expect(useBillStore.getState().payers).toHaveLength(0);
  });
});

describe("reset", () => {
  it("clears all state fields", () => {
    const s = setup();
    s.createExpense("Test", "itemized");
    s.addParticipant(userBob);
    s.addItem({ description: "Pizza", quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000 });
    s.setPayerFull("user-alice");

    s.reset();

    const state = useBillStore.getState();
    expect(state.expense).toBeNull();
    expect(state.totalAmountInput).toBe(0);
    expect(state.participants).toHaveLength(0);
    expect(state.items).toHaveLength(0);
    expect(state.payers).toHaveLength(0);
    expect(state.splits).toHaveLength(0);
    expect(state.billSplits).toHaveLength(0);
    expect(state.previewDebts).toHaveLength(0);
  });
});
