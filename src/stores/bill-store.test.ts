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
  it("produces one ledger entry for two participants with one payer", () => {
    const s = setup();
    s.createBill("Test", "itemized");
    useBillStore.getState().addParticipant(userBob);
    const { addItem, splitItemEqually, setPayerFull, computeLedger } = useBillStore.getState();
    addItem({ description: "X", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    splitItemEqually(itemId, ["user-alice", "user-bob"]);
    setPayerFull("user-alice");
    computeLedger();
    const { ledger } = useBillStore.getState();
    expect(ledger).toHaveLength(1);
    // 5000 item split + 10% service fee (500) = 5500 owed by Bob
    expect(ledger[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice", amountCents: 5500 });
  });

  it("produces no ledger entries when payer consumed everything", () => {
    const s = setup();
    s.createBill("Test", "itemized");
    const { addItem, assignItem, setPayerFull, computeLedger } = useBillStore.getState();
    addItem({ description: "X", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    assignItem(itemId, "user-alice", "fixed", 10000);
    setPayerFull("user-alice");
    computeLedger();
    const { ledger, bill } = useBillStore.getState();
    expect(ledger).toHaveLength(0);
    expect(bill?.status).toBe("settled");
  });

  it("uses creator as fallback payer when payers array is empty", () => {
    const s = setup();
    s.createBill("Test", "single_amount");
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().updateBill({ totalAmountInput: 10000 });
    useBillStore.getState().splitBillEqually(["user-alice", "user-bob"]);
    // Don't set payers — should fall back to creator (alice)
    useBillStore.getState().computeLedger();
    const { ledger } = useBillStore.getState();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].toUserId).toBe("user-alice");
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
    useBillStore.getState().computeLedger();
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
    useBillStore.getState().computeLedger();
    const { ledger } = useBillStore.getState();
    expect(ledger.length).toBeGreaterThan(1);
    useBillStore.getState().markPaid(ledger[0].id);
    expect(useBillStore.getState().bill?.status).toBe("partially_settled");
  });
});
