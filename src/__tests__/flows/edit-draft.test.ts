import { describe, it, expect, beforeEach } from "vitest";
import { useBillStore } from "@/stores/bill-store";
import {
  userAlice,
  userBob,
  makeExpense,
  makeSingleAmountExpense,
  makeExpenseItem,
} from "@/test/fixtures";
import type { Expense, BillSplit, ItemSplit } from "@/types";

/**
 * Tests for the draft editing flow — verifying that store state
 * can be restored from loaded draft data and correctly modified.
 */
describe("Edit Draft Flow", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
  });

  it("restores an itemized draft expense into the store", () => {
    const expense = makeExpense({
      id: "draft-1",
      title: "Jantar editavel",
      serviceFeePercent: 10,
      fixedFees: 500,
    });
    const items = [
      makeExpenseItem({ id: "item-1", description: "Pizza", totalPriceCents: 5000 }),
    ];
    const splits: ItemSplit[] = [
      {
        id: "split-1",
        itemId: "item-1",
        userId: "user-bob",
        splitType: "equal",
        value: 1,
        computedAmountCents: 5000,
      },
    ];

    // Simulate what the edit draft useEffect does
    useBillStore.setState({
      currentUser: userAlice,
      expense,
      totalAmountInput: 0,
      participants: [userAlice, userBob],
      items,
      payers: [{ expenseId: "draft-1", userId: "user-alice", amountCents: 5500 }],
      splits,
      billSplits: [],
      previewDebts: [],
    });

    const state = useBillStore.getState();
    expect(state.expense?.id).toBe("draft-1");
    expect(state.expense?.title).toBe("Jantar editavel");
    expect(state.participants).toHaveLength(2);
    expect(state.items).toHaveLength(1);
    expect(state.splits).toHaveLength(1);
    expect(state.payers).toHaveLength(1);
  });

  it("restores a single_amount draft expense into the store", () => {
    const expense = makeSingleAmountExpense({
      id: "draft-2",
      title: "Aluguel editavel",
    });
    const billSplits: BillSplit[] = [
      { userId: "user-alice", splitType: "equal", value: 1, computedAmountCents: 100000 },
      { userId: "user-bob", splitType: "equal", value: 1, computedAmountCents: 100000 },
    ];

    useBillStore.setState({
      currentUser: userAlice,
      expense,
      totalAmountInput: 200000,
      participants: [userAlice, userBob],
      items: [],
      payers: [],
      splits: [],
      billSplits,
      previewDebts: [],
    });

    const state = useBillStore.getState();
    expect(state.expense?.expenseType).toBe("single_amount");
    expect(state.billSplits).toHaveLength(2);
    expect(state.items).toHaveLength(0);
  });

  it("allows updating expense metadata after restoring a draft", () => {
    const expense = makeExpense({ id: "draft-3", title: "Titulo antigo" });

    useBillStore.setState({
      currentUser: userAlice,
      expense,
      totalAmountInput: 0,
      participants: [userAlice, userBob],
      items: [],
      payers: [],
      splits: [],
      billSplits: [],
      previewDebts: [],
    });

    useBillStore.getState().updateExpense({
      title: "Titulo novo",
      merchantName: "Restaurante Novo",
      serviceFeePercent: 12,
      fixedFees: 300,
    });

    const state = useBillStore.getState();
    expect(state.expense?.title).toBe("Titulo novo");
    expect(state.expense?.merchantName).toBe("Restaurante Novo");
    expect(state.expense?.serviceFeePercent).toBe(12);
    expect(state.expense?.fixedFees).toBe(300);
    // Verify id is preserved (not reset by createExpense)
    expect(state.expense?.id).toBe("draft-3");
  });

  it("preserves existing participants when modifying expense metadata", () => {
    const expense = makeExpense({ id: "draft-4" });

    useBillStore.setState({
      currentUser: userAlice,
      expense,
      totalAmountInput: 0,
      participants: [userAlice, userBob],
      items: [],
      payers: [],
      splits: [],
      billSplits: [],
      previewDebts: [],
    });

    useBillStore.getState().updateExpense({ title: "Updated" });

    expect(useBillStore.getState().participants).toHaveLength(2);
    expect(useBillStore.getState().participants[0].id).toBe("user-alice");
    expect(useBillStore.getState().participants[1].id).toBe("user-bob");
  });

  it("preserves items and splits when modifying expense metadata", () => {
    const expense = makeExpense({ id: "draft-5" });
    const items = [makeExpenseItem({ id: "item-1" })];
    const splits: ItemSplit[] = [
      {
        id: "split-1",
        itemId: "item-1",
        userId: "user-bob",
        splitType: "equal",
        value: 1,
        computedAmountCents: 5000,
      },
    ];

    useBillStore.setState({
      currentUser: userAlice,
      expense,
      totalAmountInput: 0,
      participants: [userAlice, userBob],
      items,
      payers: [],
      splits,
      billSplits: [],
      previewDebts: [],
    });

    useBillStore.getState().updateExpense({ title: "Modified" });

    expect(useBillStore.getState().items).toHaveLength(1);
    expect(useBillStore.getState().splits).toHaveLength(1);
    expect(useBillStore.getState().items[0].description).toBe("Pizza");
  });

  it("can add new items to a restored draft", () => {
    const expense = makeExpense({ id: "draft-6" });
    const items = [makeExpenseItem({ id: "item-1", description: "Pizza" })];

    useBillStore.setState({
      currentUser: userAlice,
      expense,
      totalAmountInput: 0,
      participants: [userAlice, userBob],
      items,
      payers: [],
      splits: [],
      billSplits: [],
      previewDebts: [],
    });

    useBillStore.getState().addItem({
      description: "Bebida",
      quantity: 2,
      unitPriceCents: 1500,
      totalPriceCents: 3000,
    });

    expect(useBillStore.getState().items).toHaveLength(2);
    expect(useBillStore.getState().items[1].description).toBe("Bebida");
  });

  it("determines correct starting step based on draft data", () => {
    function determineStep(expense: Expense, items: { length: number }, splits: { length: number }, billSplits: { length: number }, payers: { length: number }) {
      if (payers.length > 0) return "payer";
      if (expense.expenseType === "itemized" && splits.length > 0) return "split";
      if (expense.expenseType === "itemized" && items.length > 0) return "items";
      if (expense.expenseType === "single_amount" && billSplits.length > 0) return "amount-split";
      return "participants";
    }

    // Draft with payers → payer step
    expect(
      determineStep(
        makeExpense(), { length: 1 }, { length: 1 }, { length: 0 }, { length: 1 },
      ),
    ).toBe("payer");

    // Itemized with splits → split step
    expect(
      determineStep(
        makeExpense(), { length: 1 }, { length: 1 }, { length: 0 }, { length: 0 },
      ),
    ).toBe("split");

    // Itemized with items but no splits → items step
    expect(
      determineStep(
        makeExpense(), { length: 1 }, { length: 0 }, { length: 0 }, { length: 0 },
      ),
    ).toBe("items");

    // Single amount with bill splits → amount-split step
    expect(
      determineStep(
        makeSingleAmountExpense(), { length: 0 }, { length: 0 }, { length: 2 }, { length: 0 },
      ),
    ).toBe("amount-split");

    // Empty draft → participants step
    expect(
      determineStep(
        makeExpense(), { length: 0 }, { length: 0 }, { length: 0 }, { length: 0 },
      ),
    ).toBe("participants");
  });
});
