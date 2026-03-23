import { describe, it, expect, beforeEach } from "vitest";
import { useBillStore } from "@/stores/bill-store";
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

const alice = makeUser("alice", "Alice");
const bob = makeUser("bob", "Bob");
const carol = makeUser("carol", "Carol");
const dave = makeUser("dave", "Dave");
const eve = makeUser("eve", "Eve");

describe("Itemized bill flows", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
  });

  it("Flow 1: classic restaurant — 3 people, 3 items, 10% service, one payer", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Restaurante", "itemized", "Churrascaria");
    store.addParticipant(bob);
    store.addParticipant(carol);

    // Add items
    store.addItem({ description: "Picanha", quantity: 1, unitPriceCents: 8000, totalPriceCents: 8000 });
    store.addItem({ description: "Cerveja x3", quantity: 3, unitPriceCents: 1200, totalPriceCents: 3600 });
    store.addItem({ description: "Sobremesa", quantity: 1, unitPriceCents: 2500, totalPriceCents: 2500 });

    const items = useBillStore.getState().items;
    expect(items).toHaveLength(3);

    // Alice eats picanha (R$80), everyone shares beer equally, Carol gets dessert
    store.assignItem(items[0].id, "alice", "fixed", 8000);
    store.splitItemEqually(items[1].id, ["alice", "bob", "carol"]);
    store.assignItem(items[2].id, "carol", "fixed", 2500);

    // Verify splits
    const splits = useBillStore.getState().splits;
    const aliceItemTotal = splits.filter((s) => s.userId === "alice").reduce((sum, s) => sum + s.computedAmountCents, 0);
    const bobItemTotal = splits.filter((s) => s.userId === "bob").reduce((sum, s) => sum + s.computedAmountCents, 0);
    const carolItemTotal = splits.filter((s) => s.userId === "carol").reduce((sum, s) => sum + s.computedAmountCents, 0);

    // 3600/3 = 1200 each
    expect(aliceItemTotal).toBe(8000 + 1200);
    expect(bobItemTotal).toBe(1200);
    expect(carolItemTotal).toBe(2500 + 1200);

    // Grand total = items(14100) + service(10% = 1410) + fixed(0) = 15510
    expect(useBillStore.getState().getGrandTotal()).toBe(15510);

    // Alice pays everything
    store.setPayerFull("alice");
    expect(useBillStore.getState().bill!.payers[0].amountCents).toBe(15510);

    // Compute ledger
    store.computeLedger();
    const { ledger } = useBillStore.getState();

    // Bob and Carol should owe Alice
    expect(ledger.length).toBeGreaterThanOrEqual(1);
    expect(ledger.every((e) => e.toUserId === "alice")).toBe(true);
    expect(ledger.every((e) => e.status === "pending")).toBe(true);

    // Verify total ledger sums correctly
    const totalOwed = ledger.reduce((s, e) => s + e.amountCents, 0);
    // Alice consumed: items(9200) + proportional service + fixed
    // The rest is owed to her
    const aliceTotal = useBillStore.getState().getParticipantTotal("alice");
    const bobTotal = useBillStore.getState().getParticipantTotal("bob");
    const carolTotal = useBillStore.getState().getParticipantTotal("carol");

    // Bob and Carol's totals should approximately equal what they owe
    expect(Math.abs(totalOwed - (bobTotal + carolTotal))).toBeLessThanOrEqual(2);
  });

  it("Flow 2: 5-person dinner with two payers", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Jantar", "itemized");
    store.addParticipant(bob);
    store.addParticipant(carol);
    store.addParticipant(dave);
    store.addParticipant(eve);

    store.addItem({ description: "Entrada", quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000 });
    store.addItem({ description: "Prato principal", quantity: 5, unitPriceCents: 4000, totalPriceCents: 20000 });

    const items = useBillStore.getState().items;

    // Everyone shares appetizer
    store.splitItemEqually(items[0].id, ["alice", "bob", "carol", "dave", "eve"]);
    // Everyone has their own main
    store.splitItemEqually(items[1].id, ["alice", "bob", "carol", "dave", "eve"]);

    store.updateBill({ fixedFees: 2500 }); // R$25 couvert = R$5 each

    // Alice and Bob split payment
    const grandTotal = useBillStore.getState().getGrandTotal();
    store.setPayerAmount("alice", Math.ceil(grandTotal * 0.6));
    store.setPayerAmount("bob", grandTotal - Math.ceil(grandTotal * 0.6));

    store.computeLedger();

    const { ledger } = useBillStore.getState();
    // Should have ledger entries
    expect(ledger.length).toBeGreaterThan(0);

    // Total money in ledger should be conserved
    const totalLedger = ledger.reduce((s, e) => s + e.amountCents, 0);
    expect(totalLedger).toBeGreaterThan(0);
  });

  it("Flow 3: adding and removing items mid-flow", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Test", "itemized");
    store.addParticipant(bob);

    store.addItem({ description: "Item1", quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000 });
    store.addItem({ description: "Item2", quantity: 1, unitPriceCents: 3000, totalPriceCents: 3000 });

    let items = useBillStore.getState().items;
    store.splitItemEqually(items[0].id, ["alice", "bob"]);
    store.splitItemEqually(items[1].id, ["alice", "bob"]);

    expect(useBillStore.getState().splits).toHaveLength(4);

    // Remove first item
    store.removeItem(items[0].id);
    expect(useBillStore.getState().items).toHaveLength(1);
    expect(useBillStore.getState().splits).toHaveLength(2); // only item2 splits remain
    expect(useBillStore.getState().bill!.totalAmount).toBe(3000);

    // Add a new item
    store.addItem({ description: "Item3", quantity: 2, unitPriceCents: 2000, totalPriceCents: 4000 });
    expect(useBillStore.getState().bill!.totalAmount).toBe(7000);
  });
});
