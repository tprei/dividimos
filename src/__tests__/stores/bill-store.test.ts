import { describe, it, expect, beforeEach } from "vitest";
import { useBillStore } from "@/stores/bill-store";
import type { User } from "@/types";

// --- Helpers ---

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

describe("bill-store", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
  });

  // --- Bill creation ---

  describe("createBill", () => {
    it("creates an itemized bill with defaults", () => {
      const store = useBillStore.getState();
      store.setCurrentUser(alice);
      store.createBill("Dinner", "itemized", "Restaurant");

      const { bill, participants } = useBillStore.getState();
      expect(bill).not.toBeNull();
      expect(bill!.billType).toBe("itemized");
      expect(bill!.serviceFeePercent).toBe(10);
      expect(bill!.status).toBe("draft");
      expect(bill!.creatorId).toBe("alice");
      expect(participants).toHaveLength(1);
      expect(participants[0].id).toBe("alice");
    });

    it("creates a single_amount bill with 0% service fee", () => {
      const store = useBillStore.getState();
      store.setCurrentUser(alice);
      store.createBill("Quick split", "single_amount");

      const { bill } = useBillStore.getState();
      expect(bill!.billType).toBe("single_amount");
      expect(bill!.serviceFeePercent).toBe(0);
    });
  });

  // --- Participants ---

  describe("participants", () => {
    beforeEach(() => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "itemized");
    });

    it("adds a participant", () => {
      useBillStore.getState().addParticipant(bob);
      expect(useBillStore.getState().participants).toHaveLength(2);
    });

    it("does not add duplicate participant", () => {
      useBillStore.getState().addParticipant(bob);
      useBillStore.getState().addParticipant(bob);
      expect(useBillStore.getState().participants).toHaveLength(2);
    });

    it("removes participant and cascades to splits", () => {
      const store = useBillStore.getState();
      store.addParticipant(bob);
      store.addItem({
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 5000,
        totalPriceCents: 5000,
      });

      const itemId = useBillStore.getState().items[0].id;
      useBillStore.getState().splitItemEqually(itemId, ["alice", "bob"]);
      expect(useBillStore.getState().splits).toHaveLength(2);

      useBillStore.getState().removeParticipant("bob");
      expect(useBillStore.getState().participants).toHaveLength(1);
      expect(useBillStore.getState().splits).toHaveLength(1);
      expect(useBillStore.getState().splits[0].userId).toBe("alice");
    });
  });

  // --- Items ---

  describe("items", () => {
    beforeEach(() => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "itemized");
    });

    it("adds item and recalculates total", () => {
      useBillStore.getState().addItem({
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 5000,
        totalPriceCents: 5000,
      });

      expect(useBillStore.getState().items).toHaveLength(1);
      expect(useBillStore.getState().bill!.totalAmount).toBe(5000);
    });

    it("removes item and recalculates total", () => {
      useBillStore.getState().addItem({
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 5000,
        totalPriceCents: 5000,
      });
      useBillStore.getState().addItem({
        description: "Beer",
        quantity: 2,
        unitPriceCents: 1000,
        totalPriceCents: 2000,
      });
      expect(useBillStore.getState().bill!.totalAmount).toBe(7000);

      const pizzaId = useBillStore.getState().items[0].id;
      useBillStore.getState().removeItem(pizzaId);
      expect(useBillStore.getState().bill!.totalAmount).toBe(2000);
    });

    it("removes item and cleans up associated splits", () => {
      useBillStore.getState().addItem({
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 5000,
        totalPriceCents: 5000,
      });
      const itemId = useBillStore.getState().items[0].id;
      useBillStore.getState().splitItemEqually(itemId, ["alice"]);
      expect(useBillStore.getState().splits).toHaveLength(1);

      useBillStore.getState().removeItem(itemId);
      expect(useBillStore.getState().splits).toHaveLength(0);
    });

    it("updates item price and recalculates total", () => {
      useBillStore.getState().addItem({
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 5000,
        totalPriceCents: 5000,
      });
      const itemId = useBillStore.getState().items[0].id;
      useBillStore.getState().updateItem(itemId, { totalPriceCents: 8000, unitPriceCents: 8000 });
      expect(useBillStore.getState().bill!.totalAmount).toBe(8000);
    });
  });

  // --- Split item equally ---

  describe("splitItemEqually", () => {
    beforeEach(() => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "itemized");
      useBillStore.getState().addParticipant(bob);
      useBillStore.getState().addParticipant(carol);
    });

    it("splits R$10.00 three ways with correct remainder", () => {
      useBillStore.getState().addItem({
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 1000,
        totalPriceCents: 1000,
      });
      const itemId = useBillStore.getState().items[0].id;
      useBillStore.getState().splitItemEqually(itemId, ["alice", "bob", "carol"]);

      const splits = useBillStore.getState().splits;
      expect(splits).toHaveLength(3);

      const amounts = splits.map((s) => s.computedAmountCents).sort((a, b) => a - b);
      // 1000 / 3 = 333 remainder 1
      expect(amounts).toEqual([333, 333, 334]);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(1000);
    });

    it("splits R$10.01 two ways", () => {
      useBillStore.getState().addItem({
        description: "Beer",
        quantity: 1,
        unitPriceCents: 1001,
        totalPriceCents: 1001,
      });
      const itemId = useBillStore.getState().items[0].id;
      useBillStore.getState().splitItemEqually(itemId, ["alice", "bob"]);

      const splits = useBillStore.getState().splits;
      const amounts = splits.map((s) => s.computedAmountCents).sort((a, b) => a - b);
      expect(amounts).toEqual([500, 501]);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(1001);
    });

    it("replaces existing splits for the same item", () => {
      useBillStore.getState().addItem({
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 1000,
        totalPriceCents: 1000,
      });
      const itemId = useBillStore.getState().items[0].id;

      useBillStore.getState().splitItemEqually(itemId, ["alice", "bob"]);
      expect(useBillStore.getState().splits).toHaveLength(2);

      useBillStore.getState().splitItemEqually(itemId, ["alice", "bob", "carol"]);
      expect(useBillStore.getState().splits).toHaveLength(3);
    });
  });

  // --- Assign/unassign items ---

  describe("assignItem / unassignItem", () => {
    beforeEach(() => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "itemized");
      useBillStore.getState().addItem({
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 10000,
        totalPriceCents: 10000,
      });
    });

    it("assigns with percentage", () => {
      const itemId = useBillStore.getState().items[0].id;
      useBillStore.getState().assignItem(itemId, "alice", "percentage", 60);

      const split = useBillStore.getState().splits[0];
      expect(split.computedAmountCents).toBe(6000);
    });

    it("assigns with fixed amount", () => {
      const itemId = useBillStore.getState().items[0].id;
      useBillStore.getState().assignItem(itemId, "alice", "fixed", 3500);

      const split = useBillStore.getState().splits[0];
      expect(split.computedAmountCents).toBe(3500);
    });

    it("updates existing assignment", () => {
      const itemId = useBillStore.getState().items[0].id;
      useBillStore.getState().assignItem(itemId, "alice", "percentage", 60);
      useBillStore.getState().assignItem(itemId, "alice", "percentage", 40);

      expect(useBillStore.getState().splits).toHaveLength(1);
      expect(useBillStore.getState().splits[0].computedAmountCents).toBe(4000);
    });

    it("unassigns item", () => {
      const itemId = useBillStore.getState().items[0].id;
      useBillStore.getState().assignItem(itemId, "alice", "fixed", 5000);
      expect(useBillStore.getState().splits).toHaveLength(1);

      useBillStore.getState().unassignItem(itemId, "alice");
      expect(useBillStore.getState().splits).toHaveLength(0);
    });
  });

  // --- Payers ---

  describe("payers", () => {
    beforeEach(() => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "itemized");
      useBillStore.getState().addParticipant(bob);
      useBillStore.getState().addParticipant(carol);
      useBillStore.getState().addItem({
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 10000,
        totalPriceCents: 10000,
      });
    });

    it("setPayerFull sets single payer with grand total", () => {
      useBillStore.getState().setPayerFull("alice");

      const payers = useBillStore.getState().bill!.payers;
      expect(payers).toHaveLength(1);
      expect(payers[0].userId).toBe("alice");
      // Grand total = items(10000) + service(1000) + fixed(0) = 11000
      expect(payers[0].amountCents).toBe(11000);
    });

    it("splitPaymentEqually with 3 people on R$100", () => {
      // Set up a single_amount bill for clean numbers
      useBillStore.getState().reset();
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "single_amount");
      useBillStore.getState().updateBill({ totalAmountInput: 10000 });
      useBillStore.getState().addParticipant(bob);
      useBillStore.getState().addParticipant(carol);

      useBillStore.getState().splitPaymentEqually(["alice", "bob", "carol"]);

      const payers = useBillStore.getState().bill!.payers;
      expect(payers).toHaveLength(3);
      const amounts = payers.map((p) => p.amountCents).sort((a, b) => a - b);
      expect(amounts).toEqual([3333, 3333, 3334]);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(10000);
    });

    it("setPayerAmount adds and updates payer", () => {
      useBillStore.getState().setPayerAmount("alice", 7000);
      expect(useBillStore.getState().bill!.payers).toHaveLength(1);
      expect(useBillStore.getState().bill!.payers[0].amountCents).toBe(7000);

      useBillStore.getState().setPayerAmount("alice", 8000);
      expect(useBillStore.getState().bill!.payers).toHaveLength(1);
      expect(useBillStore.getState().bill!.payers[0].amountCents).toBe(8000);

      useBillStore.getState().setPayerAmount("bob", 3000);
      expect(useBillStore.getState().bill!.payers).toHaveLength(2);
    });

    it("removePayerEntry removes payer", () => {
      useBillStore.getState().setPayerAmount("alice", 7000);
      useBillStore.getState().setPayerAmount("bob", 3000);
      useBillStore.getState().removePayerEntry("alice");
      expect(useBillStore.getState().bill!.payers).toHaveLength(1);
      expect(useBillStore.getState().bill!.payers[0].userId).toBe("bob");
    });
  });

  // --- Single amount splits ---

  describe("single amount splits", () => {
    beforeEach(() => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "single_amount");
      useBillStore.getState().updateBill({ totalAmountInput: 10000 });
      useBillStore.getState().addParticipant(bob);
      useBillStore.getState().addParticipant(carol);
    });

    it("splitBillEqually with 3 people on R$100", () => {
      useBillStore.getState().splitBillEqually(["alice", "bob", "carol"]);

      const splits = useBillStore.getState().billSplits;
      expect(splits).toHaveLength(3);
      const amounts = splits.map((s) => s.computedAmountCents).sort((a, b) => a - b);
      expect(amounts).toEqual([3333, 3333, 3334]);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(10000);
    });

    it("splitBillByPercentage 60/40", () => {
      useBillStore.getState().splitBillByPercentage([
        { userId: "alice", percentage: 60 },
        { userId: "bob", percentage: 40 },
      ]);

      const splits = useBillStore.getState().billSplits;
      expect(splits).toHaveLength(2);
      expect(splits.find((s) => s.userId === "alice")!.computedAmountCents).toBe(6000);
      expect(splits.find((s) => s.userId === "bob")!.computedAmountCents).toBe(4000);
    });

    it("splitBillByFixed stores exact amounts", () => {
      useBillStore.getState().splitBillByFixed([
        { userId: "alice", amountCents: 7000 },
        { userId: "bob", amountCents: 3000 },
      ]);

      const splits = useBillStore.getState().billSplits;
      expect(splits.find((s) => s.userId === "alice")!.computedAmountCents).toBe(7000);
      expect(splits.find((s) => s.userId === "bob")!.computedAmountCents).toBe(3000);
    });
  });

  // --- getGrandTotal ---

  describe("getGrandTotal", () => {
    it("returns totalAmountInput for single_amount", () => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "single_amount");
      useBillStore.getState().updateBill({ totalAmountInput: 15000 });

      expect(useBillStore.getState().getGrandTotal()).toBe(15000);
    });

    it("calculates items + service + fixed for itemized", () => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "itemized");
      useBillStore.getState().addItem({
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 10000,
        totalPriceCents: 10000,
      });
      useBillStore.getState().updateBill({ fixedFees: 500 });

      // items(10000) + service(10% = 1000) + fixed(500) = 11500
      expect(useBillStore.getState().getGrandTotal()).toBe(11500);
    });

    it("returns 0 when no bill", () => {
      expect(useBillStore.getState().getGrandTotal()).toBe(0);
    });

    it("returns 0 when no items", () => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "itemized");
      expect(useBillStore.getState().getGrandTotal()).toBe(0);
    });
  });

  // --- computeLedger ---

  describe("computeLedger", () => {
    it("classic: 3 people equal split, single payer", () => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Dinner", "single_amount");
      useBillStore.getState().updateBill({ totalAmountInput: 9000 });
      useBillStore.getState().addParticipant(bob);
      useBillStore.getState().addParticipant(carol);

      useBillStore.getState().splitBillEqually(["alice", "bob", "carol"]);
      useBillStore.getState().setPayerFull("alice");
      useBillStore.getState().computeLedger();

      const { ledger, bill } = useBillStore.getState();
      expect(bill!.status).toBe("active");
      expect(ledger).toHaveLength(2);

      const bobEntry = ledger.find((e) => e.fromUserId === "bob");
      const carolEntry = ledger.find((e) => e.fromUserId === "carol");
      expect(bobEntry).toBeDefined();
      expect(carolEntry).toBeDefined();
      // 9000 / 3 = 3000 each, so bob and carol owe alice 3000
      expect(bobEntry!.amountCents).toBe(3000);
      expect(carolEntry!.amountCents).toBe(3000);
      expect(bobEntry!.toUserId).toBe("alice");
    });

    it("two payers scenario", () => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Lunch", "single_amount");
      useBillStore.getState().updateBill({ totalAmountInput: 10000 });
      useBillStore.getState().addParticipant(bob);
      useBillStore.getState().addParticipant(carol);

      // All consume equally
      useBillStore.getState().splitBillEqually(["alice", "bob", "carol"]);
      // Alice pays 70%, Bob pays 30%
      useBillStore.getState().setPayerAmount("alice", 7000);
      useBillStore.getState().setPayerAmount("bob", 3000);
      useBillStore.getState().computeLedger();

      const { ledger } = useBillStore.getState();
      // Alice consumed 3333, paid 7000 → creditor for 3667
      // Bob consumed 3334, paid 3000 → debtor for 334
      // Carol consumed 3333, paid 0 → debtor for 3333
      // Ledger should have entries that net out
      const totalOwed = ledger.reduce((s, e) => s + e.amountCents, 0);
      // Total owed should approximately equal the creditor's surplus
      expect(totalOwed).toBeGreaterThan(0);
      expect(ledger.every((e) => e.status === "pending")).toBe(true);
    });

    it("self-payment: payer consumed all → settled", () => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Solo", "single_amount");
      useBillStore.getState().updateBill({ totalAmountInput: 5000 });

      useBillStore.getState().splitBillEqually(["alice"]);
      useBillStore.getState().setPayerFull("alice");
      useBillStore.getState().computeLedger();

      const { ledger, bill } = useBillStore.getState();
      expect(ledger).toHaveLength(0);
      expect(bill!.status).toBe("settled");
    });

    it("itemized bill with service and fixed fees", () => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Restaurant", "itemized");
      useBillStore.getState().addParticipant(bob);

      useBillStore.getState().addItem({
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 6000,
        totalPriceCents: 6000,
      });
      useBillStore.getState().addItem({
        description: "Pasta",
        quantity: 1,
        unitPriceCents: 4000,
        totalPriceCents: 4000,
      });
      useBillStore.getState().updateBill({ fixedFees: 600 });

      const items = useBillStore.getState().items;
      useBillStore.getState().assignItem(items[0].id, "alice", "fixed", 6000);
      useBillStore.getState().assignItem(items[1].id, "bob", "fixed", 4000);
      useBillStore.getState().setPayerFull("alice");
      useBillStore.getState().computeLedger();

      const { ledger } = useBillStore.getState();
      expect(ledger).toHaveLength(1);
      expect(ledger[0].fromUserId).toBe("bob");
      expect(ledger[0].toUserId).toBe("alice");
      // Bob: items(4000) + service(4000/10000 * 1000 = 400) + fixed(300) = 4700
      expect(ledger[0].amountCents).toBe(4700);
    });
  });

  // --- Payment flow ---

  describe("payment flow", () => {
    beforeEach(() => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "single_amount");
      useBillStore.getState().updateBill({ totalAmountInput: 6000 });
      useBillStore.getState().addParticipant(bob);
      useBillStore.getState().addParticipant(carol);
      useBillStore.getState().splitBillEqually(["alice", "bob", "carol"]);
      useBillStore.getState().setPayerFull("alice");
      useBillStore.getState().computeLedger();
    });

    it("markPaid sets status and timestamp", () => {
      const entryId = useBillStore.getState().ledger[0].id;
      useBillStore.getState().markPaid(entryId);

      const entry = useBillStore.getState().ledger.find((e) => e.id === entryId);
      expect(entry!.status).toBe("paid_unconfirmed");
      expect(entry!.paidAt).toBeDefined();
    });

    it("confirmPayment sets settled status", () => {
      const entryId = useBillStore.getState().ledger[0].id;
      useBillStore.getState().markPaid(entryId);
      useBillStore.getState().confirmPayment(entryId);

      const entry = useBillStore.getState().ledger.find((e) => e.id === entryId);
      expect(entry!.status).toBe("settled");
      expect(entry!.confirmedAt).toBeDefined();
    });

    it("partial settlement → partially_settled", () => {
      const entryId = useBillStore.getState().ledger[0].id;
      useBillStore.getState().confirmPayment(entryId);

      expect(useBillStore.getState().bill!.status).toBe("partially_settled");
    });

    it("all settled → bill settled", () => {
      const ledger = useBillStore.getState().ledger;
      for (const entry of ledger) {
        useBillStore.getState().confirmPayment(entry.id);
      }

      expect(useBillStore.getState().bill!.status).toBe("settled");
    });
  });

  // --- getParticipantTotal ---

  describe("getParticipantTotal", () => {
    it("single amount returns billSplit amount", () => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "single_amount");
      useBillStore.getState().updateBill({ totalAmountInput: 10000 });
      useBillStore.getState().addParticipant(bob);

      useBillStore.getState().splitBillEqually(["alice", "bob"]);

      expect(useBillStore.getState().getParticipantTotal("alice")).toBe(5000);
      expect(useBillStore.getState().getParticipantTotal("bob")).toBe(5000);
    });

    it("itemized returns items + proportional service + equal fixed", () => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "itemized");
      useBillStore.getState().addParticipant(bob);

      useBillStore.getState().addItem({
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 6000,
        totalPriceCents: 6000,
      });
      useBillStore.getState().addItem({
        description: "Pasta",
        quantity: 1,
        unitPriceCents: 4000,
        totalPriceCents: 4000,
      });
      useBillStore.getState().updateBill({ fixedFees: 600 });

      const items = useBillStore.getState().items;
      useBillStore.getState().assignItem(items[0].id, "alice", "fixed", 6000);
      useBillStore.getState().assignItem(items[1].id, "bob", "fixed", 4000);

      // Alice: items(6000) + service(6000/10000 * 1000 = 600) + fixed(300) = 6900
      expect(useBillStore.getState().getParticipantTotal("alice")).toBe(6900);
      // Bob: items(4000) + service(4000/10000 * 1000 = 400) + fixed(300) = 4700
      expect(useBillStore.getState().getParticipantTotal("bob")).toBe(4700);
    });
  });

  // --- setBillType ---

  describe("setBillType", () => {
    it("switching to single_amount clears items and splits", () => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "itemized");
      useBillStore.getState().addItem({
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 5000,
        totalPriceCents: 5000,
      });

      useBillStore.getState().setBillType("single_amount");

      expect(useBillStore.getState().items).toHaveLength(0);
      expect(useBillStore.getState().splits).toHaveLength(0);
      expect(useBillStore.getState().bill!.serviceFeePercent).toBe(0);
    });

    it("switching to itemized clears billSplits", () => {
      useBillStore.getState().setCurrentUser(alice);
      useBillStore.getState().createBill("Test", "single_amount");
      useBillStore.getState().updateBill({ totalAmountInput: 10000 });
      useBillStore.getState().splitBillEqually(["alice"]);

      useBillStore.getState().setBillType("itemized");

      expect(useBillStore.getState().billSplits).toHaveLength(0);
      expect(useBillStore.getState().bill!.serviceFeePercent).toBe(10);
    });
  });
});
