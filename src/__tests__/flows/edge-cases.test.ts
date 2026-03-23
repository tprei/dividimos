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

describe("Edge cases", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
  });

  it("payer consumed nothing → full debt transfer to consumer", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Gift", "single_amount");
    store.updateBill({ totalAmountInput: 5000 });
    store.addParticipant(bob);

    // Only Bob consumed
    store.splitBillByFixed([{ userId: "bob", amountCents: 5000 }]);
    store.setPayerFull("alice");
    store.computeLedger();

    const { ledger } = useBillStore.getState();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].fromUserId).toBe("bob");
    expect(ledger[0].toUserId).toBe("alice");
    expect(ledger[0].amountCents).toBe(5000);
  });

  it("everyone consumed and paid equally → no debts", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Split", "single_amount");
    store.updateBill({ totalAmountInput: 9000 });
    store.addParticipant(bob);
    store.addParticipant(carol);

    store.splitBillEqually(["alice", "bob", "carol"]);
    store.splitPaymentEqually(["alice", "bob", "carol"]);
    store.computeLedger();

    const { ledger, bill } = useBillStore.getState();
    expect(ledger).toHaveLength(0);
    expect(bill!.status).toBe("settled");
  });

  it("R$0.01 between 3 people → handles sub-cent gracefully", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Tiny", "single_amount");
    store.updateBill({ totalAmountInput: 1 });
    store.addParticipant(bob);
    store.addParticipant(carol);

    store.splitBillEqually(["alice", "bob", "carol"]);
    const splits = useBillStore.getState().billSplits;

    // 1 / 3 = 0 remainder 1, so [1, 0, 0] or [0, 0, 1]
    const total = splits.reduce((s, bs) => s + bs.computedAmountCents, 0);
    expect(total).toBe(1);

    store.setPayerFull("alice");
    store.computeLedger();

    // Should not crash, ledger may have 0 or 1 entry
    const { ledger } = useBillStore.getState();
    expect(ledger.length).toBeLessThanOrEqual(1);
  });

  it("switching bill type clears data properly", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Test", "itemized");
    store.addParticipant(bob);

    store.addItem({ description: "Pizza", quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000 });
    const itemId = useBillStore.getState().items[0].id;
    store.splitItemEqually(itemId, ["alice", "bob"]);
    store.setPayerFull("alice");

    // Switch to single_amount
    store.setBillType("single_amount");
    expect(useBillStore.getState().items).toHaveLength(0);
    expect(useBillStore.getState().splits).toHaveLength(0);
    expect(useBillStore.getState().bill!.serviceFeePercent).toBe(0);

    // Should be able to continue with single_amount flow
    store.updateBill({ totalAmountInput: 10000 });
    store.splitBillEqually(["alice", "bob"]);
    store.setPayerFull("alice");
    store.computeLedger();

    const { ledger } = useBillStore.getState();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amountCents).toBe(5000);
  });

  it("switching from single_amount to itemized clears billSplits", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Test", "single_amount");
    store.updateBill({ totalAmountInput: 10000 });
    store.addParticipant(bob);
    store.splitBillEqually(["alice", "bob"]);
    expect(useBillStore.getState().billSplits).toHaveLength(2);

    store.setBillType("itemized");
    expect(useBillStore.getState().billSplits).toHaveLength(0);
    expect(useBillStore.getState().bill!.serviceFeePercent).toBe(10);
  });

  it("large bill: R$10,000 split 5 ways", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Expensive", "single_amount");
    store.updateBill({ totalAmountInput: 1000000 });
    store.addParticipant(bob);
    store.addParticipant(carol);
    const dave = makeUser("dave", "Dave");
    const eve = makeUser("eve", "Eve");
    store.addParticipant(dave);
    store.addParticipant(eve);

    store.splitBillEqually(["alice", "bob", "carol", "dave", "eve"]);
    store.setPayerFull("alice");
    store.computeLedger();

    const { ledger } = useBillStore.getState();
    expect(ledger).toHaveLength(4); // 4 people owe alice
    const total = ledger.reduce((s, e) => s + e.amountCents, 0);
    expect(total).toBe(800000); // 4 × R$2000
  });

  it("no payers set → defaults to creator", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Test", "single_amount");
    store.updateBill({ totalAmountInput: 6000 });
    store.addParticipant(bob);
    store.addParticipant(carol);

    store.splitBillEqually(["alice", "bob", "carol"]);
    // Do NOT set payers — should default to creator
    store.computeLedger();

    const { ledger } = useBillStore.getState();
    expect(ledger).toHaveLength(2);
    expect(ledger.every((e) => e.toUserId === "alice")).toBe(true);
  });

  it("rounding: 3-way split totals match", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Test", "single_amount");
    store.updateBill({ totalAmountInput: 10000 });
    store.addParticipant(bob);
    store.addParticipant(carol);

    store.splitBillEqually(["alice", "bob", "carol"]);

    const splits = useBillStore.getState().billSplits;
    const total = splits.reduce((s, bs) => s + bs.computedAmountCents, 0);
    expect(total).toBe(10000); // Must sum exactly
  });

  it("itemized rounding: service fee on odd split", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Test", "itemized");
    store.addParticipant(bob);
    store.addParticipant(carol);

    // R$100 item split 3 ways
    store.addItem({ description: "Shared", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000 });
    const itemId = useBillStore.getState().items[0].id;
    store.splitItemEqually(itemId, ["alice", "bob", "carol"]);

    // Verify split sums to item total
    const splits = useBillStore.getState().splits;
    const splitTotal = splits.reduce((s, sp) => s + sp.computedAmountCents, 0);
    expect(splitTotal).toBe(10000);

    // Verify participant totals with service fee
    const aliceTotal = store.getParticipantTotal("alice");
    const bobTotal = store.getParticipantTotal("bob");
    const carolTotal = store.getParticipantTotal("carol");

    // Each should be around 3667 (3333 + 333 service fee)
    // Allow rounding tolerance
    expect(Math.abs(aliceTotal + bobTotal + carolTotal - 11000)).toBeLessThanOrEqual(3);
  });

  it("reset clears everything", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Test", "itemized");
    store.addParticipant(bob);
    store.addItem({ description: "Pizza", quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000 });

    store.reset();

    const state = useBillStore.getState();
    expect(state.bill).toBeNull();
    expect(state.participants).toHaveLength(0);
    expect(state.items).toHaveLength(0);
    expect(state.splits).toHaveLength(0);
    expect(state.billSplits).toHaveLength(0);
    expect(state.ledger).toHaveLength(0);
  });
});
