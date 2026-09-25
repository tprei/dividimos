import { describe, it, expect, beforeEach } from "vitest";
import { useBillStore, selectPreviewDebts } from "@/stores/bill-store";
import { userAlice, userBob, userCarlos } from "@/test/fixtures";

describe("Itemized expense flows", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
  });

  it("Flow 1: classic restaurant — 3 people, 3 items, 10% service, one payer", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Restaurante", "itemized", "Churrascaria");
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);

    store.addItem({ description: "Picanha", quantity: 1000, unitPriceCents: 8000, totalPriceCents: 8000 });
    store.addItem({ description: "Cerveja x3", quantity: 3000, unitPriceCents: 1200, totalPriceCents: 3600 });
    store.addItem({ description: "Sobremesa", quantity: 1000, unitPriceCents: 2500, totalPriceCents: 2500 });

    const items = useBillStore.getState().items;
    expect(items).toHaveLength(3);

    store.assignItem(items[0].id, "user-alice", "fixed", 8000);
    store.splitItemEqually(items[1].id, ["user-alice", "user-bob", "user-carlos"]);
    store.assignItem(items[2].id, "user-carlos", "fixed", 2500);

    const splits = useBillStore.getState().splits;
    const aliceItemTotal = splits.filter((s) => s.userId === "user-alice").reduce((sum, s) => sum + s.computedAmountCents, 0);
    const bobItemTotal = splits.filter((s) => s.userId === "user-bob").reduce((sum, s) => sum + s.computedAmountCents, 0);
    const carlosItemTotal = splits.filter((s) => s.userId === "user-carlos").reduce((sum, s) => sum + s.computedAmountCents, 0);

    expect(aliceItemTotal).toBe(8000 + 1200);
    expect(bobItemTotal).toBe(1200);
    expect(carlosItemTotal).toBe(2500 + 1200);

    expect(useBillStore.getState().getGrandTotal()).toBe(15510);

    store.setPayerFull("user-alice");
    expect(useBillStore.getState().payers[0].amountCents).toBe(15510);

    const debts = selectPreviewDebts(useBillStore.getState());

    expect(debts.length).toBeGreaterThanOrEqual(1);
    expect(debts.every((e) => e.toUserId === "user-alice")).toBe(true);

    const totalOwed = debts.reduce((s, e) => s + e.amountCents, 0);
    const bobTotal = useBillStore.getState().getParticipantTotal("user-bob");
    const carlosTotal = useBillStore.getState().getParticipantTotal("user-carlos");
    expect(Math.abs(totalOwed - (bobTotal + carlosTotal))).toBeLessThanOrEqual(2);
  });

  it("Flow 3: adding and removing items mid-flow", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Test", "itemized");
    store.addParticipant(userBob);

    store.addItem({ description: "Item1", quantity: 1000, unitPriceCents: 5000, totalPriceCents: 5000 });
    store.addItem({ description: "Item2", quantity: 1000, unitPriceCents: 3000, totalPriceCents: 3000 });

    const items = useBillStore.getState().items;
    store.splitItemEqually(items[0].id, ["user-alice", "user-bob"]);
    store.splitItemEqually(items[1].id, ["user-alice", "user-bob"]);

    expect(useBillStore.getState().splits).toHaveLength(4);

    store.removeItem(items[0].id);
    expect(useBillStore.getState().items).toHaveLength(1);
    expect(useBillStore.getState().splits).toHaveLength(2);
    expect(useBillStore.getState().expense!.totalAmount).toBe(3000);

    store.addItem({ description: "Item3", quantity: 2000, unitPriceCents: 2000, totalPriceCents: 4000 });
    expect(useBillStore.getState().expense!.totalAmount).toBe(7000);
  });
});
