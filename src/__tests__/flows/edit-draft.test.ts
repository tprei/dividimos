import { describe, it, expect, beforeEach } from "vitest";
import { useBillStore, mapLoadedGuestsForEditHydration } from "@/stores/bill-store";
import {
  userAlice,
  userBob,
  makeExpense,
  makeSingleAmountExpense,
  makeExpenseItem,
} from "@/test/fixtures";
import type { Expense } from "@/types";
import type { AmountSplit } from "@/stores/bill-store";

/**
 * Tests for the draft editing flow — verifying that store state
 * can be restored from loaded draft data and correctly modified.
 */
describe("Edit Draft Flow", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
    useBillStore.setState({ currentUser: userAlice });
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
    const payers = [{ expenseId: "draft-1", userId: "user-alice", amountCents: 5500 }];

    useBillStore.getState().hydrateFromServer({
      expense,
      items,
      participants: [userAlice, userBob],
      payers,
    });

    const state = useBillStore.getState();
    expect(state.expense?.id).toBe("draft-1");
    expect(state.expense?.title).toBe("Jantar editavel");
    expect(state.participants).toHaveLength(2);
    expect(state.items).toHaveLength(1);
    expect(state.payers).toHaveLength(1);
  });

  it("restores guests from a draft expense (regression: guests were previously always discarded)", () => {
    const expense = makeExpense({ id: "draft-1b", title: "Jantar com convidado" });
    const items = [makeExpenseItem({ id: "item-1b" })];

    useBillStore.getState().hydrateFromServer({
      expense,
      items,
      participants: [userAlice],
      guests: [{ id: "guest-maria", name: "Maria", remoteId: "guest-maria" }],
    });

    const state = useBillStore.getState();
    expect(state.guests).toHaveLength(1);
    expect(state.guests[0]).toMatchObject({ id: "guest-maria", name: "Maria" });
  });

  it("restores a guest's single_amount share so it is not deleted on the next save", () => {
    const expense = makeSingleAmountExpense({ id: "draft-1c", totalAmount: 10000 });
    const billSplits: AmountSplit[] = [
      { userId: "user-alice", splitType: "equal", value: 1, computedAmountCents: 5000 },
      { userId: "guest-maria", splitType: "equal", value: 1, computedAmountCents: 5000 },
    ];

    useBillStore.getState().hydrateFromServer({
      expense,
      items: [],
      participants: [userAlice],
      guests: [{ id: "guest-maria", name: "Maria", remoteId: "guest-maria" }],
      billSplits,
    });

    const state = useBillStore.getState();
    expect(state.guests.map((g) => g.id)).toContain("guest-maria");
    expect(state.getParticipantTotal("guest-maria")).toBe(5000);
  });

  it("restores a single_amount draft expense into the store", () => {
    const expense = makeSingleAmountExpense({
      id: "draft-2",
      title: "Aluguel editavel",
      totalAmount: 200000,
    });
    const billSplits: AmountSplit[] = [
      { userId: "user-alice", splitType: "equal", value: 1, computedAmountCents: 100000 },
      { userId: "user-bob", splitType: "equal", value: 1, computedAmountCents: 100000 },
    ];

    useBillStore.getState().hydrateFromServer({
      expense,
      items: [],
      participants: [userAlice, userBob],
      billSplits,
    });

    const state = useBillStore.getState();
    expect(state.expense?.expenseType).toBe("single_amount");
    expect(state.billSplits).toHaveLength(2);
    expect(state.items).toHaveLength(0);
    expect(state.totalAmountInput).toBe(200000);
  });

  it("allows updating expense metadata after restoring a draft", () => {
    const expense = makeExpense({ id: "draft-3", title: "Titulo antigo" });

    useBillStore.getState().hydrateFromServer({
      expense,
      items: [],
      participants: [userAlice, userBob],
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

    useBillStore.getState().hydrateFromServer({
      expense,
      items: [],
      participants: [userAlice, userBob],
    });

    useBillStore.getState().updateExpense({ title: "Updated" });

    expect(useBillStore.getState().participants).toHaveLength(2);
    expect(useBillStore.getState().participants[0].id).toBe("user-alice");
    expect(useBillStore.getState().participants[1].id).toBe("user-bob");
  });

  it("preserves items when modifying expense metadata", () => {
    const expense = makeExpense({ id: "draft-5" });
    const items = [makeExpenseItem({ id: "item-1" })];

    useBillStore.getState().hydrateFromServer({
      expense,
      items,
      participants: [userAlice, userBob],
    });

    useBillStore.getState().updateExpense({ title: "Modified" });

    expect(useBillStore.getState().items).toHaveLength(1);
    expect(useBillStore.getState().items[0].description).toBe("Pizza");
  });

  it("can add new items to a restored draft", () => {
    const expense = makeExpense({ id: "draft-6" });
    const items = [makeExpenseItem({ id: "item-1", description: "Pizza" })];

    useBillStore.getState().hydrateFromServer({
      expense,
      items,
      participants: [userAlice, userBob],
    });

    useBillStore.getState().addItem({
      description: "Bebida",
      quantity: 2000,
      unitPriceCents: 1500,
      totalPriceCents: 3000,
    });

    expect(useBillStore.getState().items).toHaveLength(2);
    expect(useBillStore.getState().items[1].description).toBe("Bebida");
  });

  it("clears zombie state from a prior wizard session on hydrate", () => {
    const oldExpense = makeExpense({ id: "old-1" });
    useBillStore.getState().hydrateFromServer({
      expense: oldExpense,
      items: [makeExpenseItem({ id: "old-item" })],
      participants: [userAlice, userBob],
    });
    useBillStore.getState().addGuest("Ghost");
    expect(useBillStore.getState().guests).toHaveLength(1);

    const newExpense = makeExpense({ id: "new-1" });
    useBillStore.getState().hydrateFromServer({
      expense: newExpense,
      items: [],
      participants: [userAlice],
    });

    const state = useBillStore.getState();
    expect(state.guests).toHaveLength(0);
    expect(state.splits).toHaveLength(0);
    expect(state.billSplits).toHaveLength(0);
    expect(state.payers).toHaveLength(0);
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

describe("mapLoadedGuestsForEditHydration (extracted from the wizard's edit-mode hydration effect)", () => {
  it("maps unclaimed guests to the store shape for both itemized and single_amount expenses", () => {
    const loadedGuests = [
      { id: "guest-1", displayName: "Maria", share: { shareAmountCents: 2500 } },
      { id: "guest-2", displayName: "Joao" },
    ];

    const itemized = mapLoadedGuestsForEditHydration(loadedGuests, "itemized");
    expect(itemized.guests).toEqual([
      { id: "guest-1", name: "Maria", remoteId: "guest-1" },
      { id: "guest-2", name: "Joao", remoteId: "guest-2" },
    ]);
    // Itemized per-item provenance is not persisted server-side (#477's
    // aggregate_only mode); billSplits is single_amount-only.
    expect(itemized.guestBillSplits).toEqual([]);

    const singleAmount = mapLoadedGuestsForEditHydration(loadedGuests, "single_amount");
    expect(singleAmount.guests).toEqual(itemized.guests);
    expect(singleAmount.guestBillSplits).toEqual([
      { userId: "guest-1", splitType: "fixed", value: 2500, computedAmountCents: 2500 },
      { userId: "guest-2", splitType: "fixed", value: 0, computedAmountCents: 0 },
    ]);
  });

  it("excludes already-claimed guests from both the identity list and billSplits", () => {
    const loadedGuests = [
      { id: "guest-unclaimed", displayName: "Maria", share: { shareAmountCents: 3000 } },
      { id: "guest-claimed", displayName: "Joao", claimedBy: "user-joao", share: { shareAmountCents: 4000 } },
    ];

    const result = mapLoadedGuestsForEditHydration(loadedGuests, "single_amount");
    expect(result.guests).toEqual([{ id: "guest-unclaimed", name: "Maria", remoteId: "guest-unclaimed" }]);
    expect(result.guestBillSplits).toEqual([
      { userId: "guest-unclaimed", splitType: "fixed", value: 3000, computedAmountCents: 3000 },
    ]);
  });

  it("returns empty results for an expense with no guests", () => {
    const result = mapLoadedGuestsForEditHydration([], "itemized");
    expect(result.guests).toEqual([]);
    expect(result.guestBillSplits).toEqual([]);
  });
});
