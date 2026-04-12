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
    const s = setupSingleAmountExpense();
    s.addParticipant(userBob);
    s.splitBillByPercentage([
      { userId: "user-alice", percentage: 40 },
      { userId: "user-bob", percentage: 40 },
    ]);
    expect(useBillStore.getState().billSplits).toHaveLength(0);
  });

  it("rejects assignments that sum to more than 100%", () => {
    const s = setupSingleAmountExpense();
    s.addParticipant(userBob);
    s.splitBillByPercentage([
      { userId: "user-alice", percentage: 60 },
      { userId: "user-bob", percentage: 60 },
    ]);
    expect(useBillStore.getState().billSplits).toHaveLength(0);
  });

  it("accepts assignments that sum to exactly 100 with floating point", () => {
    const s = setupSingleAmountExpense();
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
    s.createExpense("Test", "itemized");
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
    s.createExpense("Test", "itemized");
    useBillStore.getState().updateExpense({ fixedFees: 100 });
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
  it("clears all state fields including guests", () => {
    const s = setup();
    s.createExpense("Test", "itemized");
    s.addParticipant(userBob);
    s.addGuest("Diana");
    s.addItem({ description: "Pizza", quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000 });
    s.setPayerFull("user-alice");

    s.reset();

    const state = useBillStore.getState();
    expect(state.expense).toBeNull();
    expect(state.totalAmountInput).toBe(0);
    expect(state.participants).toHaveLength(0);
    expect(state.guests).toHaveLength(0);
    expect(state.items).toHaveLength(0);
    expect(state.payers).toHaveLength(0);
    expect(state.splits).toHaveLength(0);
    expect(state.billSplits).toHaveLength(0);
    expect(state.previewDebts).toHaveLength(0);
  });
});

describe("hydrateFromVoice", () => {
  it("creates a single_amount expense from voice result", () => {
    setup();
    useBillStore.getState().hydrateFromVoice(
      {
        title: "Uber",
        amountCents: 2500,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      },
      "group-1",
    );

    const { expense, totalAmountInput, items, participants } = useBillStore.getState();
    expect(expense?.title).toBe("Uber");
    expect(expense?.expenseType).toBe("single_amount");
    expect(expense?.groupId).toBe("group-1");
    expect(expense?.status).toBe("draft");
    expect(expense?.serviceFeePercent).toBe(0);
    expect(totalAmountInput).toBe(2500);
    expect(items).toHaveLength(0);
    expect(participants).toHaveLength(1);
    expect(participants[0].id).toBe("user-alice");
  });

  it("creates an itemized expense with items from voice result", () => {
    setup();
    useBillStore.getState().hydrateFromVoice(
      {
        title: "Bar do Zé",
        amountCents: 5500,
        expenseType: "itemized",
        items: [
          { description: "Cerveja", quantity: 2, unitPriceCents: 1500, totalCents: 3000 },
          { description: "Pizza", quantity: 1, unitPriceCents: 2500, totalCents: 2500 },
        ],
        participants: [],
        merchantName: "Bar do Zé",
      },
      "group-1",
    );

    const { expense, items, totalAmountInput } = useBillStore.getState();
    expect(expense?.expenseType).toBe("itemized");
    expect(expense?.merchantName).toBe("Bar do Zé");
    expect(expense?.serviceFeePercent).toBe(10);
    expect(expense?.totalAmount).toBe(5500);
    expect(items).toHaveLength(2);
    expect(items[0].description).toBe("Cerveja");
    expect(items[0].totalPriceCents).toBe(3000);
    expect(items[1].description).toBe("Pizza");
    expect(items[1].totalPriceCents).toBe(2500);
    expect(totalAmountInput).toBe(0);
  });

  it("resets previous state before hydrating", () => {
    setup();
    useBillStore.getState().createExpense("Old", "itemized");
    useBillStore.getState().addItem({
      description: "Old item",
      quantity: 1,
      unitPriceCents: 1000,
      totalPriceCents: 1000,
    });

    useBillStore.getState().hydrateFromVoice(
      {
        title: "New",
        amountCents: 500,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      },
    );

    const { expense, items } = useBillStore.getState();
    expect(expense?.title).toBe("New");
    expect(items).toHaveLength(0);
  });

  it("does nothing when currentUser is not set", () => {
    useBillStore.getState().reset();
    useBillStore.setState({ currentUser: null });

    useBillStore.getState().hydrateFromVoice(
      {
        title: "Test",
        amountCents: 1000,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      },
    );

    expect(useBillStore.getState().expense).toBeNull();
  });

  it("uses fallback title when voice result title is empty", () => {
    setup();
    useBillStore.getState().hydrateFromVoice(
      {
        title: "",
        amountCents: 1000,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      },
    );

    expect(useBillStore.getState().expense?.title).toBe("Despesa por voz");
  });

  it("defaults groupId to empty string when not provided", () => {
    setup();
    useBillStore.getState().hydrateFromVoice({
      title: "Test",
      amountCents: 1000,
      expenseType: "single_amount",
      items: [],
      participants: [],
      merchantName: null,
    });

    expect(useBillStore.getState().expense?.groupId).toBe("");
  });
});

describe("guest management", () => {
  it("addGuest creates a guest with guest_ prefix ID", () => {
    setup().createExpense("Test", "itemized");
    const guestId = useBillStore.getState().addGuest("Diana");
    expect(guestId).toMatch(/^guest_/);
    const { guests } = useBillStore.getState();
    expect(guests).toHaveLength(1);
    expect(guests[0]).toEqual({ id: guestId, name: "Diana" });
  });

  it("addGuest allows multiple guests", () => {
    setup().createExpense("Test", "itemized");
    const s = useBillStore.getState();
    s.addGuest("Diana");
    s.addGuest("Eduardo");
    s.addGuest("Fernanda");
    expect(useBillStore.getState().guests).toHaveLength(3);
  });

  it("removeGuest removes the guest", () => {
    setup().createExpense("Test", "itemized");
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().addGuest("Eduardo");
    useBillStore.getState().removeGuest(guestId);
    const { guests } = useBillStore.getState();
    expect(guests).toHaveLength(1);
    expect(guests[0].name).toBe("Eduardo");
  });

  it("removeGuest cascades to splits", () => {
    setup().createExpense("Test", "itemized");
    const s = useBillStore.getState();
    s.addItem({ description: "Pizza", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().splitItemEqually(itemId, ["user-alice", guestId]);
    expect(useBillStore.getState().splits).toHaveLength(2);
    useBillStore.getState().removeGuest(guestId);
    expect(useBillStore.getState().splits).toHaveLength(1);
    expect(useBillStore.getState().splits[0].userId).toBe("user-alice");
  });

  it("removeGuest cascades to billSplits", () => {
    setup().createExpense("Test", "single_amount");
    useBillStore.getState().updateExpense({ totalAmountInput: 10000 });
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().splitBillEqually(["user-alice", guestId]);
    expect(useBillStore.getState().billSplits).toHaveLength(2);
    useBillStore.getState().removeGuest(guestId);
    expect(useBillStore.getState().billSplits).toHaveLength(1);
    expect(useBillStore.getState().billSplits[0].userId).toBe("user-alice");
  });

  it("updateGuest changes guest name", () => {
    setup().createExpense("Test", "itemized");
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().updateGuest(guestId, "Diana Silva");
    expect(useBillStore.getState().guests[0].name).toBe("Diana Silva");
  });

  it("createExpense clears guests", () => {
    setup().createExpense("Test", "itemized");
    useBillStore.getState().addGuest("Diana");
    expect(useBillStore.getState().guests).toHaveLength(1);
    useBillStore.getState().createExpense("New", "itemized");
    expect(useBillStore.getState().guests).toHaveLength(0);
  });
});

describe("guests in splits and ledger", () => {
  it("splitItemEqually works with mix of participants and guests", () => {
    setup().createExpense("Test", "itemized");
    const s = useBillStore.getState();
    s.addItem({ description: "Pizza", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().splitItemEqually(itemId, ["user-alice", guestId]);
    const splits = useBillStore.getState().splits;
    expect(splits).toHaveLength(2);
    expect(splits.reduce((sum, s) => sum + s.computedAmountCents, 0)).toBe(10000);
  });

  it("splitBillEqually works with guests", () => {
    setup().createExpense("Test", "single_amount");
    useBillStore.getState().updateExpense({ totalAmountInput: 9000 });
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().splitBillEqually(["user-alice", guestId]);
    const splits = useBillStore.getState().billSplits;
    expect(splits).toHaveLength(2);
    expect(splits.reduce((sum, s) => sum + s.computedAmountCents, 0)).toBe(9000);
  });

  it("computeLedger includes guest debt edges", () => {
    setup().createExpense("Test", "single_amount");
    useBillStore.getState().updateExpense({ totalAmountInput: 10000 });
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().splitBillEqually(["user-alice", guestId]);
    useBillStore.getState().setPayerFull("user-alice");
    useBillStore.getState().computeLedger();
    const { previewDebts } = useBillStore.getState();
    expect(previewDebts).toHaveLength(1);
    expect(previewDebts[0]).toMatchObject({
      fromUserId: guestId,
      toUserId: "user-alice",
      amountCents: 5000,
    });
  });

  it("computeLedger handles mix of participants and guests (itemized)", () => {
    setup().createExpense("Test", "itemized");
    useBillStore.getState().addParticipant(userBob);
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().addItem({ description: "Pizza", quantity: 1, unitPriceCents: 9000, totalPriceCents: 9000 });
    const itemId = useBillStore.getState().items[0].id;
    useBillStore.getState().splitItemEqually(itemId, ["user-alice", "user-bob", guestId]);
    useBillStore.getState().setPayerFull("user-alice");
    useBillStore.getState().computeLedger();
    const { previewDebts } = useBillStore.getState();
    // Bob and guest each owe alice for their share + service fee
    expect(previewDebts.length).toBeGreaterThanOrEqual(1);
    const guestDebt = previewDebts.find((d) => d.fromUserId === guestId);
    expect(guestDebt).toBeDefined();
    expect(guestDebt!.toUserId).toBe("user-alice");
  });

  it("getExpenseShares includes guest shares", () => {
    setup().createExpense("Test", "single_amount");
    useBillStore.getState().updateExpense({ totalAmountInput: 10000 });
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().splitBillEqually(["user-alice", guestId]);
    const shares = useBillStore.getState().getExpenseShares();
    expect(shares).toHaveLength(2);
    const guestShare = shares.find((s) => s.userId === guestId);
    expect(guestShare).toBeDefined();
    expect(guestShare!.shareAmountCents).toBe(5000);
  });

  it("getParticipantTotal works for guest IDs", () => {
    setup().createExpense("Test", "itemized");
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().addItem({ description: "Pizza", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    useBillStore.getState().splitItemEqually(itemId, ["user-alice", guestId]);
    const guestTotal = useBillStore.getState().getParticipantTotal(guestId);
    const aliceTotal = useBillStore.getState().getParticipantTotal("user-alice");
    expect(guestTotal).toBeGreaterThan(0);
    expect(guestTotal + aliceTotal).toBe(useBillStore.getState().getGrandTotal());
  });

  it("participant totals sum to grandTotal with guests and fees (invariant)", () => {
    setup().createExpense("Test", "itemized");
    useBillStore.getState().updateExpense({ fixedFees: 300 });
    useBillStore.getState().addParticipant(userBob);
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().addItem({ description: "Pizza", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    useBillStore.getState().splitItemEqually(itemId, ["user-alice", "user-bob", guestId]);
    const grandTotal = useBillStore.getState().getGrandTotal();
    const sum = ["user-alice", "user-bob", guestId].reduce(
      (s, id) => s + useBillStore.getState().getParticipantTotal(id), 0,
    );
    expect(sum).toBe(grandTotal);
  });
});

describe("participant and guest removal flows", () => {
  it("guest removal after itemized split shrinks splits to remaining participants", () => {
    setup().createExpense("Test", "itemized");
    useBillStore.getState().addItem({ description: "Pizza", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().splitItemEqually(itemId, ["user-alice", guestId]);
    expect(useBillStore.getState().splits).toHaveLength(2);

    useBillStore.getState().removeGuest(guestId);

    const { splits } = useBillStore.getState();
    expect(splits).toHaveLength(1);
    expect(splits[0].userId).toBe("user-alice");
  });

  it("guest removal after single_amount billSplit shrinks billSplits to remaining participants", () => {
    setup().createExpense("Test", "single_amount");
    useBillStore.getState().updateExpense({ totalAmountInput: 10000 });
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().splitBillEqually(["user-alice", guestId]);
    expect(useBillStore.getState().billSplits).toHaveLength(2);

    useBillStore.getState().removeGuest(guestId);

    const { billSplits } = useBillStore.getState();
    expect(billSplits).toHaveLength(1);
    expect(billSplits[0].userId).toBe("user-alice");
  });

  it("does not cascade guest removal to payers (documents current behavior)", () => {
    setup().createExpense("Test", "single_amount");
    useBillStore.getState().updateExpense({ totalAmountInput: 6000 });
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().setPayerAmount(guestId, 3000);
    expect(useBillStore.getState().payers).toHaveLength(1);

    useBillStore.getState().removeGuest(guestId);

    const { payers } = useBillStore.getState();
    expect(payers.find((p) => p.userId === guestId)).toBeDefined();
  });

  it("participant removal after itemized split removes that participant's splits", () => {
    setup().createExpense("Test", "itemized");
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().addItem({ description: "Pizza", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    useBillStore.getState().splitItemEqually(itemId, ["user-alice", "user-bob"]);
    expect(useBillStore.getState().splits).toHaveLength(2);

    useBillStore.getState().removeParticipant("user-bob");

    const { splits } = useBillStore.getState();
    expect(splits).toHaveLength(1);
    expect(splits[0].userId).toBe("user-alice");
  });

  it("does not cascade participant removal to payers (documents current behavior)", () => {
    setup().createExpense("Test", "single_amount");
    useBillStore.getState().updateExpense({ totalAmountInput: 10000 });
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().setPayerAmount("user-bob", 10000);
    expect(useBillStore.getState().payers).toHaveLength(1);

    useBillStore.getState().removeParticipant("user-bob");

    const { payers } = useBillStore.getState();
    expect(payers.find((p) => p.userId === "user-bob")).toBeDefined();
  });

  it("participant removal preserves other participants' splits with correct amounts", () => {
    setup().createExpense("Test", "itemized");
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().addParticipant(userCarlos);
    useBillStore.getState().addItem({ description: "Pizza", quantity: 1, unitPriceCents: 9000, totalPriceCents: 9000 });
    const itemId = useBillStore.getState().items[0].id;
    useBillStore.getState().splitItemEqually(itemId, ["user-alice", "user-bob", "user-carlos"]);
    expect(useBillStore.getState().splits).toHaveLength(3);

    useBillStore.getState().removeParticipant("user-bob");

    const { splits } = useBillStore.getState();
    expect(splits).toHaveLength(2);
    expect(splits.find((s) => s.userId === "user-bob")).toBeUndefined();
    const aliceSplit = splits.find((s) => s.userId === "user-alice");
    const carlosSplit = splits.find((s) => s.userId === "user-carlos");
    expect(aliceSplit).toBeDefined();
    expect(carlosSplit).toBeDefined();
    expect(aliceSplit!.computedAmountCents).toBe(3000);
    expect(carlosSplit!.computedAmountCents).toBe(3000);
  });

  it("computeLedger after participant removal reflects the remaining participant set", () => {
    setup().createExpense("Test", "itemized");
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().addParticipant(userCarlos);
    useBillStore.getState().addItem({ description: "Pizza", quantity: 1, unitPriceCents: 9000, totalPriceCents: 9000 });
    const itemId = useBillStore.getState().items[0].id;
    useBillStore.getState().splitItemEqually(itemId, ["user-alice", "user-bob", "user-carlos"]);
    useBillStore.getState().setPayerFull("user-alice");

    useBillStore.getState().removeParticipant("user-carlos");
    useBillStore.getState().computeLedger();

    const { previewDebts, participants } = useBillStore.getState();
    expect(participants.find((p) => p.id === "user-carlos")).toBeUndefined();
    expect(previewDebts.find((d) => d.fromUserId === "user-carlos")).toBeUndefined();
    expect(previewDebts.find((d) => d.toUserId === "user-carlos")).toBeUndefined();
    expect(previewDebts).toHaveLength(1);
    expect(previewDebts[0]).toMatchObject({ fromUserId: "user-bob", toUserId: "user-alice" });
  });

  it("removing all non-creator participants leaves only the creator", () => {
    setup().createExpense("Test", "itemized");
    useBillStore.getState().addParticipant(userBob);
    useBillStore.getState().addParticipant(userCarlos);
    useBillStore.getState().addItem({ description: "Pizza", quantity: 1, unitPriceCents: 9000, totalPriceCents: 9000 });
    const itemId = useBillStore.getState().items[0].id;
    useBillStore.getState().splitItemEqually(itemId, ["user-alice", "user-bob", "user-carlos"]);

    useBillStore.getState().removeParticipant("user-bob");
    useBillStore.getState().removeParticipant("user-carlos");

    const { participants, splits } = useBillStore.getState();
    expect(participants).toHaveLength(1);
    expect(participants[0].id).toBe("user-alice");
    expect(splits.find((s) => s.userId === "user-bob")).toBeUndefined();
    expect(splits.find((s) => s.userId === "user-carlos")).toBeUndefined();
  });

  it("guest removal then re-add produces clean state with no stale references", () => {
    setup().createExpense("Test", "single_amount");
    useBillStore.getState().updateExpense({ totalAmountInput: 10000 });
    const guestId = useBillStore.getState().addGuest("Diana");
    useBillStore.getState().splitBillEqually(["user-alice", guestId]);
    expect(useBillStore.getState().billSplits).toHaveLength(2);

    useBillStore.getState().removeGuest(guestId);
    const newGuestId = useBillStore.getState().addGuest("Eduardo");
    useBillStore.getState().splitBillEqually(["user-alice", newGuestId]);

    const { guests, billSplits } = useBillStore.getState();
    expect(guests).toHaveLength(1);
    expect(guests[0].name).toBe("Eduardo");
    expect(billSplits).toHaveLength(2);
    expect(billSplits.find((s) => s.userId === guestId)).toBeUndefined();
    expect(billSplits.find((s) => s.userId === newGuestId)).toBeDefined();
  });
});

describe("createExpenseFromDm", () => {
  it("creates a single_amount expense with groupId and counterparty", () => {
    setup().createExpenseFromDm("dm-group-1", userBob);
    const { expense, participants } = useBillStore.getState();

    expect(expense).not.toBeNull();
    expect(expense?.groupId).toBe("dm-group-1");
    expect(expense?.expenseType).toBe("single_amount");
    expect(expense?.serviceFeePercent).toBe(0);
    expect(expense?.status).toBe("draft");
    expect(participants).toHaveLength(2);
    expect(participants[0].id).toBe("user-alice");
    expect(participants[1].id).toBe("user-bob");
  });

  it("does nothing when currentUser is not set", () => {
    useBillStore.getState().createExpenseFromDm("dm-group-1", userBob);
    const { expense } = useBillStore.getState();
    expect(expense).toBeNull();
  });

  it("resets items, payers, splits, and guests", () => {
    const s = setup();
    s.createExpense("Old", "itemized");
    s.addItem({ description: "Pizza", quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000 });
    s.addGuest("Guest");

    s.createExpenseFromDm("dm-group-1", userBob);
    const state = useBillStore.getState();

    expect(state.items).toHaveLength(0);
    expect(state.guests).toHaveLength(0);
    expect(state.payers).toHaveLength(0);
    expect(state.splits).toHaveLength(0);
    expect(state.billSplits).toHaveLength(0);
    expect(state.previewDebts).toHaveLength(0);
    expect(state.totalAmountInput).toBe(0);
  });
});
