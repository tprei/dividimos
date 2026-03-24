import { describe, it, expect, beforeEach } from "vitest";
import { useBillStore } from "@/stores/bill-store";
import { userAlice, userBob, userCarlos } from "@/test/fixtures";

describe("Single amount bill flows", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
  });

  it("Flow 1: equal split R$300 between 3, one payer", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createBill("Almoço", "single_amount");
    store.updateBill({ totalAmountInput: 30000 });
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);

    store.splitBillEqually(["user-alice", "user-bob", "user-carlos"]);
    store.setPayerFull("user-alice");
    store.computeLedger();

    const { ledger } = useBillStore.getState();
    expect(ledger).toHaveLength(2);

    const bobEntry = ledger.find((e) => e.fromUserId === "user-bob");
    const carlosEntry = ledger.find((e) => e.fromUserId === "user-carlos");
    expect(bobEntry!.amountCents).toBe(10000);
    expect(carlosEntry!.amountCents).toBe(10000);
  });

  it("Flow 2: percentage split 60/40", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createBill("Bar", "single_amount");
    store.updateBill({ totalAmountInput: 10000 });
    store.addParticipant(userBob);

    store.splitBillByPercentage([
      { userId: "user-alice", percentage: 60 },
      { userId: "user-bob", percentage: 40 },
    ]);
    store.setPayerFull("user-alice");
    store.computeLedger();

    const { ledger } = useBillStore.getState();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].fromUserId).toBe("user-bob");
    expect(ledger[0].toUserId).toBe("user-alice");
    expect(ledger[0].amountCents).toBe(4000);
  });

  it("Flow 3: fixed split with unequal amounts", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createBill("Cinema", "single_amount");
    store.updateBill({ totalAmountInput: 8000 });
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);

    store.splitBillByFixed([
      { userId: "user-alice", amountCents: 2000 },
      { userId: "user-bob", amountCents: 3000 },
      { userId: "user-carlos", amountCents: 3000 },
    ]);
    store.setPayerFull("user-alice");
    store.computeLedger();

    const { ledger } = useBillStore.getState();
    expect(ledger).toHaveLength(2);
    const totalOwed = ledger.reduce((s, e) => s + e.amountCents, 0);
    expect(totalOwed).toBe(6000);
  });

  it("Flow 4: two payers, equal consumption", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createBill("Uber", "single_amount");
    store.updateBill({ totalAmountInput: 6000 });
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);

    store.splitBillEqually(["user-alice", "user-bob", "user-carlos"]);
    store.setPayerAmount("user-alice", 4000);
    store.setPayerAmount("user-bob", 2000);
    store.computeLedger();

    const { ledger } = useBillStore.getState();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].fromUserId).toBe("user-carlos");
    expect(ledger[0].toUserId).toBe("user-alice");
    expect(ledger[0].amountCents).toBe(2000);
  });

  it("Flow 5: everyone paid their share → no ledger entries, settled", () => {
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createBill("Test", "single_amount");
    store.updateBill({ totalAmountInput: 6000 });
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);

    store.splitBillEqually(["user-alice", "user-bob", "user-carlos"]);
    store.splitPaymentEqually(["user-alice", "user-bob", "user-carlos"]);
    store.computeLedger();

    const { ledger, bill } = useBillStore.getState();
    expect(ledger).toHaveLength(0);
    expect(bill!.status).toBe("settled");
  });
});
