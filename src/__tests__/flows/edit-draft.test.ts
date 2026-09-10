import { describe, it, expect, beforeEach } from "vitest";
import { useBillStore } from "@/stores/bill-store";
import {
  makeExpenseDetail,
  makeExpenseVersion,
  makeGuestParticipant,
  makeUserParticipant,
  userAlice,
} from "@/test/fixtures";

/**
 * Tests for the edit flow — verifying that wizard state can be restored
 * from a cached expense detail (hydrateFromDetail) and correctly modified.
 */
describe("Edit Expense Flow", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
    useBillStore.setState({ currentUser: userAlice });
  });

  it("restores an itemized expense into the store", () => {
    const detail = makeExpenseDetail({
      current: makeExpenseVersion({
        merchantName: "Cantina",
        payload: {
          items: [
            { description: "Pizza", quantityMilliunits: 1000, unitPriceCents: 5000, totalPriceCents: 5000 },
          ],
          participants: [
            { kind: "user", userId: "user-alice" },
            { kind: "user", userId: "user-bob" },
          ],
          shares: [5500, 5500],
          payers: [{ participantIndex: 0, amountCents: 11000 }],
          itemAssignments: [
            { itemIndex: 0, participantIndex: 0, amountCents: 5000 },
            { itemIndex: 0, participantIndex: 1, amountCents: 5000 },
          ],
        },
      }),
      participants: [
        makeUserParticipant(0, 5500, 11000),
        makeUserParticipant(1, 5500, 0, { id: "user-bob", handle: "bob", name: "Bob Santos", avatarUrl: null }),
      ],
    });

    useBillStore.getState().hydrateFromDetail(detail, []);

    const state = useBillStore.getState();
    expect(state.expense?.id).toBe("exp-detail-1");
    expect(state.expense?.title).toBe("Jantar");
    expect(state.expense?.merchantName).toBe("Cantina");
    expect(state.expense?.status).toBe("active");
    expect(state.participants.map((p) => p.id)).toEqual(["user-alice", "user-bob"]);
    expect(state.items).toHaveLength(1);
    expect(state.items[0].quantity).toBe(1000);
    expect(state.payers).toHaveLength(1);
    expect(state.occurredOn).toBe("2026-08-30");
  });

  it("restores guests from an expense detail (regression: guests were previously always discarded)", () => {
    const detail = makeExpenseDetail({
      current: makeExpenseVersion({
        payload: {
          items: [
            { description: "Pizza", quantityMilliunits: 1000, unitPriceCents: 10000, totalPriceCents: 10000 },
          ],
          participants: [
            { kind: "user", userId: "user-alice" },
            { kind: "guest", guestId: "guest-maria", displayName: "Maria" },
          ],
          shares: [5500, 5500],
          payers: [{ participantIndex: 0, amountCents: 11000 }],
          itemAssignments: [
            { itemIndex: 0, participantIndex: 0, amountCents: 5000 },
            { itemIndex: 0, participantIndex: 1, amountCents: 5000 },
          ],
        },
      }),
      participants: [
        makeUserParticipant(0, 5500, 11000),
        makeGuestParticipant(1, 5500, { id: "guest-maria", displayName: "Maria", claimedBy: null, claimLinkGeneration: 0 }),
      ],
    });

    useBillStore.getState().hydrateFromDetail(detail, []);

    const state = useBillStore.getState();
    expect(state.guests).toEqual([{ id: "guest-maria", name: "Maria", remoteId: "guest-maria" }]);
    expect(state.getParticipantTotal("guest-maria")).toBe(5500);
  });

  it("restores a single_amount expense into billSplits and totalAmountInput", () => {
    const detail = makeExpenseDetail({
      expense: { id: "exp-single", occurredOn: "2026-09-02" },
      current: makeExpenseVersion({
        expenseId: "exp-single",
        occurredOn: "2026-09-02",
        title: "Aluguel",
        expenseType: "single_amount",
        totalCents: 200000,
        serviceFeeBasisPoints: 0,
        payload: {
          items: [],
          participants: [
            { kind: "user", userId: "user-alice" },
            { kind: "user", userId: "user-bob" },
          ],
          shares: [100000, 100000],
          payers: [{ participantIndex: 0, amountCents: 200000 }],
          itemAssignments: null,
        },
      }),
      participants: [
        makeUserParticipant(0, 100000, 200000),
        makeUserParticipant(1, 100000, 0, { id: "user-bob", handle: "bob", name: "Bob Santos", avatarUrl: null }),
      ],
    });

    useBillStore.getState().hydrateFromDetail(detail, []);

    const state = useBillStore.getState();
    expect(state.expense?.expenseType).toBe("single_amount");
    expect(state.totalAmountInput).toBe(200000);
    expect(state.billSplits.map((b) => [b.userId, b.computedAmountCents])).toEqual([
      ["user-alice", 100000],
      ["user-bob", 100000],
    ]);
    expect(state.items).toHaveLength(0);
    expect(state.splits).toHaveLength(0);
    expect(state.occurredOn).toBe("2026-09-02");
  });

  it("allows updating expense metadata after restoring", () => {
    useBillStore.getState().hydrateFromDetail(makeExpenseDetail(), []);

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
    expect(state.expense?.id).toBe("exp-detail-1");
  });

  it("preserves existing participants when modifying expense metadata", () => {
    const detail = makeExpenseDetail({
      current: makeExpenseVersion({
        payload: {
          items: [],
          participants: [
            { kind: "user", userId: "user-alice" },
            { kind: "user", userId: "user-bob" },
          ],
          shares: [5500, 5500],
          payers: [{ participantIndex: 0, amountCents: 11000 }],
          itemAssignments: null,
        },
      }),
      participants: [
        makeUserParticipant(0, 5500, 11000),
        makeUserParticipant(1, 5500, 0, { id: "user-bob", handle: "bob", name: "Bob Santos", avatarUrl: null }),
      ],
    });
    useBillStore.getState().hydrateFromDetail(detail, []);

    useBillStore.getState().updateExpense({ title: "Updated" });

    expect(useBillStore.getState().participants.map((p) => p.id)).toEqual(["user-alice", "user-bob"]);
  });

  it("can add new items to a restored expense", () => {
    useBillStore.getState().hydrateFromDetail(makeExpenseDetail(), []);

    useBillStore.getState().addItem({
      description: "Bebida",
      quantity: 2000,
      unitPriceCents: 1500,
      totalPriceCents: 3000,
    });

    expect(useBillStore.getState().items).toHaveLength(1);
    expect(useBillStore.getState().items[0].description).toBe("Bebida");
  });

  it("clears zombie state from a prior wizard session on hydrate", () => {
    useBillStore.getState().hydrateFromDetail(makeExpenseDetail(), []);
    useBillStore.getState().addGuest("Ghost");
    useBillStore.getState().splitBillByFixed([{ userId: "user-alice", amountCents: 100 }]);
    expect(useBillStore.getState().guests).toHaveLength(1);

    useBillStore.getState().hydrateFromDetail(
      makeExpenseDetail({ expense: { id: "exp-new" }, current: makeExpenseVersion({ expenseId: "exp-new" }) }),
      [],
    );

    const state = useBillStore.getState();
    expect(state.expense?.id).toBe("exp-new");
    expect(state.guests).toHaveLength(0);
    expect(state.splits).toHaveLength(0);
    expect(state.billSplits).toHaveLength(0);
    expect(state.payers).toEqual([]);
  });
});
