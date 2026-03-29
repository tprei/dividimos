import { describe, it, expect, beforeEach } from "vitest";
import { useBillStore } from "@/stores/bill-store";
import { userAlice, userBob, userCarlos } from "@/test/fixtures";
import type { User } from "@/types";

function makeUser(id: string, name: string): User {
  return {
    id,
    email: `${id}@test.com`,
    handle: id,
    name,
    pixKeyType: "email",
    pixKeyHint: `${id}@test.com`,
    onboarded: true,
    twoFactorEnabled: false,
    createdAt: new Date().toISOString(),
  };
}

describe("Edge cases", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
  });

  it("payer consumed nothing → full debt transfer to consumer", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Gift", "single_amount");
    store.updateExpense({ totalAmountInput: 5000 });
    store.addParticipant(userBob);

    store.splitBillByFixed([{ userId: "user-bob", amountCents: 5000 }]);
    store.setPayerFull("user-alice");
    store.computeLedger();

    const { previewDebts } = useBillStore.getState();
    expect(previewDebts).toHaveLength(1);
    expect(previewDebts[0].fromUserId).toBe("user-bob");
    expect(previewDebts[0].toUserId).toBe("user-alice");
    expect(previewDebts[0].amountCents).toBe(5000);
  });

  it("everyone consumed and paid equally → no debts", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Split", "single_amount");
    store.updateExpense({ totalAmountInput: 9000 });
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);

    store.splitBillEqually(["user-alice", "user-bob", "user-carlos"]);
    store.splitPaymentEqually(["user-alice", "user-bob", "user-carlos"]);
    store.computeLedger();

    const { previewDebts, expense } = useBillStore.getState();
    expect(previewDebts).toHaveLength(0);
    expect(expense!.status).toBe("settled");
  });

  it("R$0.01 between 3 people → handles sub-cent gracefully", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Tiny", "single_amount");
    store.updateExpense({ totalAmountInput: 1 });
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);

    store.splitBillEqually(["user-alice", "user-bob", "user-carlos"]);
    const splits = useBillStore.getState().billSplits;

    const total = splits.reduce((s, bs) => s + bs.computedAmountCents, 0);
    expect(total).toBe(1);

    store.setPayerFull("user-alice");
    store.computeLedger();

    const { previewDebts } = useBillStore.getState();
    expect(previewDebts.length).toBeLessThanOrEqual(1);
  });

  it("switching expense type clears data properly", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Test", "itemized");
    store.addParticipant(userBob);

    store.addItem({ description: "Pizza", quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000 });
    const itemId = useBillStore.getState().items[0].id;
    store.splitItemEqually(itemId, ["user-alice", "user-bob"]);
    store.setPayerFull("user-alice");

    store.setExpenseType("single_amount");
    expect(useBillStore.getState().items).toHaveLength(0);
    expect(useBillStore.getState().splits).toHaveLength(0);
    expect(useBillStore.getState().expense!.serviceFeePercent).toBe(0);

    store.updateExpense({ totalAmountInput: 10000 });
    store.splitBillEqually(["user-alice", "user-bob"]);
    store.setPayerFull("user-alice");
    store.computeLedger();

    const { previewDebts } = useBillStore.getState();
    expect(previewDebts).toHaveLength(1);
    expect(previewDebts[0].amountCents).toBe(5000);
  });

  it("switching from single_amount to itemized clears billSplits", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Test", "single_amount");
    store.updateExpense({ totalAmountInput: 10000 });
    store.addParticipant(userBob);
    store.splitBillEqually(["user-alice", "user-bob"]);
    expect(useBillStore.getState().billSplits).toHaveLength(2);

    store.setExpenseType("itemized");
    expect(useBillStore.getState().billSplits).toHaveLength(0);
    expect(useBillStore.getState().expense!.serviceFeePercent).toBe(10);
  });

  it("large expense: R$10,000 split 5 ways", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Expensive", "single_amount");
    store.updateExpense({ totalAmountInput: 1000000 });
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);
    const dave = makeUser("dave", "Dave");
    const eve = makeUser("eve", "Eve");
    store.addParticipant(dave);
    store.addParticipant(eve);

    store.splitBillEqually(["user-alice", "user-bob", "user-carlos", "dave", "eve"]);
    store.setPayerFull("user-alice");
    store.computeLedger();

    const { previewDebts } = useBillStore.getState();
    expect(previewDebts).toHaveLength(4);
    const total = previewDebts.reduce((s, e) => s + e.amountCents, 0);
    expect(total).toBe(800000);
  });

  it("no payers set → defaults to creator", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Test", "single_amount");
    store.updateExpense({ totalAmountInput: 6000 });
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);

    store.splitBillEqually(["user-alice", "user-bob", "user-carlos"]);
    store.computeLedger();

    const { previewDebts } = useBillStore.getState();
    expect(previewDebts).toHaveLength(2);
    expect(previewDebts.every((e) => e.toUserId === "user-alice")).toBe(true);
  });

  it("rounding: 3-way split totals match", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Test", "single_amount");
    store.updateExpense({ totalAmountInput: 10000 });
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);

    store.splitBillEqually(["user-alice", "user-bob", "user-carlos"]);

    const splits = useBillStore.getState().billSplits;
    const total = splits.reduce((s, bs) => s + bs.computedAmountCents, 0);
    expect(total).toBe(10000);
  });

  it("itemized rounding: service fee on odd split", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Test", "itemized");
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);

    store.addItem({ description: "Shared", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    store.splitItemEqually(itemId, ["user-alice", "user-bob", "user-carlos"]);

    const splits = useBillStore.getState().splits;
    const splitTotal = splits.reduce((s, sp) => s + sp.computedAmountCents, 0);
    expect(splitTotal).toBe(10000);

    const aliceTotal = store.getParticipantTotal("user-alice");
    const bobTotal = store.getParticipantTotal("user-bob");
    const carlosTotal = store.getParticipantTotal("user-carlos");
    expect(Math.abs(aliceTotal + bobTotal + carlosTotal - 11000)).toBeLessThanOrEqual(3);
  });

  it("reset clears everything", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Test", "itemized");
    store.addParticipant(userBob);
    store.addItem({ description: "Pizza", quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000 });

    store.reset();

    const state = useBillStore.getState();
    expect(state.expense).toBeNull();
    expect(state.participants).toHaveLength(0);
    expect(state.items).toHaveLength(0);
    expect(state.splits).toHaveLength(0);
    expect(state.billSplits).toHaveLength(0);
    expect(state.previewDebts).toHaveLength(0);
  });
});
