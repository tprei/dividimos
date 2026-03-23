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

describe("Single amount bill flows", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
  });

  it("Flow 1: equal split R$300 between 3, one payer", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Almoço", "single_amount");
    store.updateBill({ totalAmountInput: 30000 });
    store.addParticipant(bob);
    store.addParticipant(carol);

    store.splitBillEqually(["alice", "bob", "carol"]);
    store.setPayerFull("alice");
    store.computeLedger();

    const { ledger } = useBillStore.getState();
    expect(ledger).toHaveLength(2);

    const bobEntry = ledger.find((e) => e.fromUserId === "bob");
    const carolEntry = ledger.find((e) => e.fromUserId === "carol");
    expect(bobEntry!.amountCents).toBe(10000);
    expect(carolEntry!.amountCents).toBe(10000);
  });

  it("Flow 2: percentage split 60/40", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Bar", "single_amount");
    store.updateBill({ totalAmountInput: 10000 });
    store.addParticipant(bob);

    store.splitBillByPercentage([
      { userId: "alice", percentage: 60 },
      { userId: "bob", percentage: 40 },
    ]);
    store.setPayerFull("alice");
    store.computeLedger();

    const { ledger } = useBillStore.getState();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].fromUserId).toBe("bob");
    expect(ledger[0].toUserId).toBe("alice");
    expect(ledger[0].amountCents).toBe(4000);
  });

  it("Flow 3: fixed split with unequal amounts", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Cinema", "single_amount");
    store.updateBill({ totalAmountInput: 8000 });
    store.addParticipant(bob);
    store.addParticipant(carol);

    store.splitBillByFixed([
      { userId: "alice", amountCents: 2000 },
      { userId: "bob", amountCents: 3000 },
      { userId: "carol", amountCents: 3000 },
    ]);
    store.setPayerFull("alice");
    store.computeLedger();

    const { ledger } = useBillStore.getState();
    // Bob owes 3000, Carol owes 3000 to Alice
    expect(ledger).toHaveLength(2);
    const totalOwed = ledger.reduce((s, e) => s + e.amountCents, 0);
    expect(totalOwed).toBe(6000);
  });

  it("Flow 4: two payers, equal consumption", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Uber", "single_amount");
    store.updateBill({ totalAmountInput: 6000 });
    store.addParticipant(bob);
    store.addParticipant(carol);

    store.splitBillEqually(["alice", "bob", "carol"]);
    // Alice pays R$40, Bob pays R$20
    store.setPayerAmount("alice", 4000);
    store.setPayerAmount("bob", 2000);
    store.computeLedger();

    const { ledger } = useBillStore.getState();
    // Alice consumed 2000, paid 4000 → creditor 2000
    // Bob consumed 2000, paid 2000 → balanced
    // Carol consumed 2000, paid 0 → debtor 2000
    // Carol owes Alice 2000
    expect(ledger).toHaveLength(1);
    expect(ledger[0].fromUserId).toBe("carol");
    expect(ledger[0].toUserId).toBe("alice");
    expect(ledger[0].amountCents).toBe(2000);
  });

  it("Flow 5: everyone paid their share → no ledger entries, settled", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Test", "single_amount");
    store.updateBill({ totalAmountInput: 6000 });
    store.addParticipant(bob);
    store.addParticipant(carol);

    store.splitBillEqually(["alice", "bob", "carol"]);
    store.splitPaymentEqually(["alice", "bob", "carol"]);
    store.computeLedger();

    const { ledger, bill } = useBillStore.getState();
    expect(ledger).toHaveLength(0);
    expect(bill!.status).toBe("settled");
  });
});
