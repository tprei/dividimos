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
    createdAt: new Date().toISOString(),
  };
}

describe("Itemized bill flows", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
  });

  it("Flow 1: classic restaurant — 3 people, 3 items, 10% service, one payer", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createBill("Restaurante", "itemized", "Churrascaria");
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);

    store.addItem({ description: "Picanha", quantity: 1, unitPriceCents: 8000, totalPriceCents: 8000 });
    store.addItem({ description: "Cerveja x3", quantity: 3, unitPriceCents: 1200, totalPriceCents: 3600 });
    store.addItem({ description: "Sobremesa", quantity: 1, unitPriceCents: 2500, totalPriceCents: 2500 });

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
    expect(useBillStore.getState().bill!.payers[0].amountCents).toBe(15510);

    store.computeLedger();
    const { ledger } = useBillStore.getState();

    expect(ledger.length).toBeGreaterThanOrEqual(1);
    expect(ledger.every((e) => e.toUserId === "user-alice")).toBe(true);
    expect(ledger.every((e) => e.status === "pending")).toBe(true);

    const totalOwed = ledger.reduce((s, e) => s + e.amountCents, 0);
    const bobTotal = useBillStore.getState().getParticipantTotal("user-bob");
    const carlosTotal = useBillStore.getState().getParticipantTotal("user-carlos");
    expect(Math.abs(totalOwed - (bobTotal + carlosTotal))).toBeLessThanOrEqual(2);
  });

  it("Flow 2: 5-person dinner with two payers", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createBill("Jantar", "itemized");
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);
    const dave = makeUser("dave", "Dave");
    const eve = makeUser("eve", "Eve");
    store.addParticipant(dave);
    store.addParticipant(eve);

    store.addItem({ description: "Entrada", quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000 });
    store.addItem({ description: "Prato principal", quantity: 5, unitPriceCents: 4000, totalPriceCents: 20000 });

    const items = useBillStore.getState().items;

    store.splitItemEqually(items[0].id, ["user-alice", "user-bob", "user-carlos", "dave", "eve"]);
    store.splitItemEqually(items[1].id, ["user-alice", "user-bob", "user-carlos", "dave", "eve"]);

    store.updateBill({ fixedFees: 2500 });

    const grandTotal = useBillStore.getState().getGrandTotal();
    store.setPayerAmount("user-alice", Math.ceil(grandTotal * 0.6));
    store.setPayerAmount("user-bob", grandTotal - Math.ceil(grandTotal * 0.6));

    store.computeLedger();

    const { ledger } = useBillStore.getState();
    expect(ledger.length).toBeGreaterThan(0);

    const totalLedger = ledger.reduce((s, e) => s + e.amountCents, 0);
    expect(totalLedger).toBeGreaterThan(0);
  });

  it("Flow 3: adding and removing items mid-flow", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createBill("Test", "itemized");
    store.addParticipant(userBob);

    store.addItem({ description: "Item1", quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000 });
    store.addItem({ description: "Item2", quantity: 1, unitPriceCents: 3000, totalPriceCents: 3000 });

    let items = useBillStore.getState().items;
    store.splitItemEqually(items[0].id, ["user-alice", "user-bob"]);
    store.splitItemEqually(items[1].id, ["user-alice", "user-bob"]);

    expect(useBillStore.getState().splits).toHaveLength(4);

    store.removeItem(items[0].id);
    expect(useBillStore.getState().items).toHaveLength(1);
    expect(useBillStore.getState().splits).toHaveLength(2);
    expect(useBillStore.getState().bill!.totalAmount).toBe(3000);

    store.addItem({ description: "Item3", quantity: 2, unitPriceCents: 2000, totalPriceCents: 4000 });
    expect(useBillStore.getState().bill!.totalAmount).toBe(7000);
  });
});
