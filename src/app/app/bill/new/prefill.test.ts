import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userAlice } from "@/test/fixtures";
import { useBillStore } from "@/stores/bill-store";

/**
 * Tests the pre-fill logic triggered by ?title, ?amount, ?splitType query params.
 * This mirrors what the wizard page useEffect does when authUser is available
 * and the params are present.
 */

function simulatePrefill({
  title,
  amount,
}: {
  title: string | null;
  amount: number | null;
}) {
  const store = useBillStore.getState();
  store.setCurrentUser(userAlice);
  store.createExpense(title || "Nova conta", "single_amount");
  if (amount !== null && amount > 0) {
    store.updateExpense({ totalAmountInput: amount });
  }
}

beforeEach(() => {
  useBillStore.getState().reset();
  useBillStore.setState({ currentUser: null });
});

afterEach(() => {
  useBillStore.getState().reset();
  useBillStore.setState({ currentUser: null });
});

describe("pre-fill wizard from query params", () => {
  it("creates a single_amount expense with the given title", () => {
    simulatePrefill({ title: "Airbnb", amount: null });

    const { expense } = useBillStore.getState();
    expect(expense).not.toBeNull();
    expect(expense!.expenseType).toBe("single_amount");
    expect(expense!.title).toBe("Airbnb");
  });

  it("sets totalAmountInput when amount is provided", () => {
    simulatePrefill({ title: "Uber", amount: 2500 });

    const { totalAmountInput } = useBillStore.getState();
    expect(totalAmountInput).toBe(2500);
  });

  it("leaves totalAmountInput at 0 when amount is null", () => {
    simulatePrefill({ title: "Jantar", amount: null });

    const { totalAmountInput } = useBillStore.getState();
    expect(totalAmountInput).toBe(0);
  });

  it("leaves totalAmountInput at 0 when amount is 0", () => {
    simulatePrefill({ title: "Jantar", amount: 0 });

    const { totalAmountInput } = useBillStore.getState();
    expect(totalAmountInput).toBe(0);
  });

  it("sets service fee to 0 (single_amount convention)", () => {
    simulatePrefill({ title: "Presente", amount: 5000 });

    const { expense } = useBillStore.getState();
    expect(expense!.serviceFeePercent).toBe(0);
    expect(expense!.fixedFees).toBe(0);
  });

  it("adds current user as participant", () => {
    simulatePrefill({ title: "Airbnb", amount: 15000 });

    const { participants } = useBillStore.getState();
    expect(participants).toHaveLength(1);
    expect(participants[0].id).toBe("user-alice");
  });

  it("uses fallback title when title param is empty string", () => {
    simulatePrefill({ title: "", amount: 1000 });

    const { expense } = useBillStore.getState();
    expect(expense!.title).toBe("Nova conta");
  });

  it("expense status starts as draft", () => {
    simulatePrefill({ title: "Aluguel", amount: 80000 });

    const { expense } = useBillStore.getState();
    expect(expense!.status).toBe("draft");
  });

  it("grandTotal reflects the pre-filled amount", () => {
    simulatePrefill({ title: "Festa", amount: 12000 });

    const store = useBillStore.getState();
    expect(store.getGrandTotal()).toBe(12000);
  });
});
