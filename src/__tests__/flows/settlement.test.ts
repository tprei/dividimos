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

describe("Settlement flows", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
    const store = useBillStore.getState();
    store.setCurrentUser(alice);
    store.createBill("Test", "single_amount");
    store.updateBill({ totalAmountInput: 9000 });
    store.addParticipant(bob);
    store.addParticipant(carol);
    store.splitBillEqually(["alice", "bob", "carol"]);
    store.setPayerFull("alice");
    store.computeLedger();
  });

  it("full settlement lifecycle: pending → paid → confirmed", () => {
    const { ledger } = useBillStore.getState();
    const bobEntry = ledger.find((e) => e.fromUserId === "bob")!;

    // Step 1: pending
    expect(bobEntry.status).toBe("pending");
    expect(bobEntry.paidAt).toBeUndefined();

    // Step 2: mark paid
    useBillStore.getState().markPaid(bobEntry.id);
    const updated = useBillStore.getState().ledger.find((e) => e.id === bobEntry.id)!;
    expect(updated.status).toBe("paid_unconfirmed");
    expect(updated.paidAt).toBeDefined();

    // Step 3: confirm
    useBillStore.getState().confirmPayment(bobEntry.id);
    const confirmed = useBillStore.getState().ledger.find((e) => e.id === bobEntry.id)!;
    expect(confirmed.status).toBe("settled");
    expect(confirmed.confirmedAt).toBeDefined();

    // Bill should be partially_settled (carol still pending)
    expect(useBillStore.getState().bill!.status).toBe("partially_settled");
  });

  it("settling all entries → bill settled", () => {
    const { ledger } = useBillStore.getState();

    for (const entry of ledger) {
      useBillStore.getState().confirmPayment(entry.id);
    }

    expect(useBillStore.getState().bill!.status).toBe("settled");
  });

  it("settling first entry only → partially_settled", () => {
    const { ledger } = useBillStore.getState();
    useBillStore.getState().confirmPayment(ledger[0].id);

    expect(useBillStore.getState().bill!.status).toBe("partially_settled");
  });

  it("ledger entries have correct bill reference", () => {
    const { ledger, bill } = useBillStore.getState();
    for (const entry of ledger) {
      expect(entry.billId).toBe(bill!.id);
    }
  });
});
