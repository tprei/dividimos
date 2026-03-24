import { describe, it, expect, beforeEach } from "vitest";
import { useBillStore } from "@/stores/bill-store";
import { userAlice, userBob, userCarlos } from "@/test/fixtures";

describe("Settlement flows", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createBill("Test", "single_amount");
    store.updateBill({ totalAmountInput: 9000 });
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);
    store.splitBillEqually(["user-alice", "user-bob", "user-carlos"]);
    store.setPayerFull("user-alice");
    store.computeLedger();
  });

  it("full settlement lifecycle: pending → paid → confirmed", () => {
    const { ledger } = useBillStore.getState();
    const bobEntry = ledger.find((e) => e.fromUserId === "user-bob")!;

    expect(bobEntry.status).toBe("pending");
    expect(bobEntry.paidAt).toBeUndefined();

    useBillStore.getState().markPaid(bobEntry.id);
    const updated = useBillStore.getState().ledger.find((e) => e.id === bobEntry.id)!;
    expect(updated.status).toBe("paid_unconfirmed");
    expect(updated.paidAt).toBeDefined();

    useBillStore.getState().confirmPayment(bobEntry.id);
    const confirmed = useBillStore.getState().ledger.find((e) => e.id === bobEntry.id)!;
    expect(confirmed.status).toBe("settled");
    expect(confirmed.confirmedAt).toBeDefined();

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
