import { describe, it, expect, beforeEach } from "vitest";
import { useBillStore, selectPreviewDebts } from "@/stores/bill-store";
import { userAlice, userBob, userCarlos } from "@/test/fixtures";

/**
 * Settlement flow tests for the new Expense model.
 *
 * In the Splitwise model, settlements happen server-side via the
 * record_settlement RPC. The store only provides client-side preview
 * debts (DebtEdge[]) — there is no recordPayment/markPaid in the store.
 *
 * These tests verify that computeLedger correctly produces preview debts
 * and that expense status reflects the debt state.
 */
describe("Settlement preview flows", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Test", "single_amount");
    store.updateExpense({ totalAmountInput: 9000 });
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);
    store.splitBillEqually(["user-alice", "user-bob", "user-carlos"]);
    store.setPayerFull("user-alice");
  });

  it("computes preview debts with correct amounts", () => {
    const debts = selectPreviewDebts(useBillStore.getState());
    expect(debts).toHaveLength(2);

    const bobDebt = debts.find((e) => e.fromUserId === "user-bob")!;
    const carlosDebt = debts.find((e) => e.fromUserId === "user-carlos")!;

    expect(bobDebt.amountCents).toBe(3000);
    expect(carlosDebt.amountCents).toBe(3000);
    expect(bobDebt.toUserId).toBe("user-alice");
    expect(carlosDebt.toUserId).toBe("user-alice");
  });

  it("expense status remains draft (server-authoritative)", () => {
    const { expense } = useBillStore.getState();
    expect(expense!.status).toBe("draft");
  });

  it("preview debts are DebtEdge[] without payment tracking", () => {
    const debts = selectPreviewDebts(useBillStore.getState());
    for (const debt of debts) {
      expect(debt).toHaveProperty("fromUserId");
      expect(debt).toHaveProperty("toUserId");
      expect(debt).toHaveProperty("amountCents");
      // No legacy LedgerEntry fields
      expect(debt).not.toHaveProperty("status");
      expect(debt).not.toHaveProperty("paidAmountCents");
      expect(debt).not.toHaveProperty("billId");
    }
  });

  it("total debt equals total consumption by non-payers", () => {
    const debts = selectPreviewDebts(useBillStore.getState());
    const totalDebt = debts.reduce((s, e) => s + e.amountCents, 0);
    // 9000 total, alice paid all, each consumed 3000
    // bob owes 3000, carlos owes 3000 = 6000 total debt
    expect(totalDebt).toBe(6000);
  });
});
