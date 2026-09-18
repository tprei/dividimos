import { describe, expect, it } from "vitest";
import { hasMeaningfulDraft, type DraftInspectionState } from "./bill-draft";
import type { Expense, ExpenseItem, ExpensePayer, User } from "@/types";

const meId = "user-alice";
const meUser: User = {
  id: meId,
  email: "alice@example.com",
  handle: "alice",
  name: "Alice",
  onboarded: true,
  createdAt: "2026-09-17T00:00:00Z",
};

const otherUser: User = {
  id: "user-bob",
  email: "bob@example.com",
  handle: "bob",
  name: "Bob",
  onboarded: true,
  createdAt: "2026-09-17T00:00:00Z",
};

function createBaselineItemized(): DraftInspectionState {
  const expense: Expense = {
    id: "exp-itemized",
    groupId: "",
    creatorId: meId,
    title: "Nova conta",
    expenseType: "itemized",
    totalAmount: 0,
    serviceFeePercent: 10,
    serviceFeeBasisPoints: 1000,
    fixedFees: 0,
    createdAt: "2026-09-17T00:00:00Z",
    updatedAt: "2026-09-17T00:00:00Z",
  };

  return {
    expense,
    totalAmountInput: 0,
    participants: [meUser],
    guests: [],
    items: [],
    payers: [],
    splits: [],
    billSplits: [],
    occurredOn: null,
    receiptAccessKey: null,
  };
}

function createBaselineSingleAmount(): DraftInspectionState {
  const expense: Expense = {
    id: "exp-single",
    groupId: "",
    creatorId: meId,
    title: "",
    expenseType: "single_amount",
    totalAmount: 0,
    serviceFeePercent: 0,
    serviceFeeBasisPoints: 0,
    fixedFees: 0,
    createdAt: "2026-09-17T00:00:00Z",
    updatedAt: "2026-09-17T00:00:00Z",
  };

  return {
    expense,
    totalAmountInput: 0,
    participants: [meUser],
    guests: [],
    items: [],
    payers: [],
    splits: [],
    billSplits: [],
    occurredOn: null,
    receiptAccessKey: null,
  };
}

const sampleItem: ExpenseItem = {
  id: "item-1",
  expenseId: "exp-itemized",
  description: "Cerveja",
  quantity: 1,
  unitPriceCents: 1500,
  totalPriceCents: 1500,
  createdAt: "2026-09-17T00:00:00Z",
};

const samplePayer: ExpensePayer = {
  expenseId: "exp-itemized",
  userId: meId,
  amountCents: 1500,
};

describe("hasMeaningfulDraft", () => {
  it("returns false when expense is null", () => {
    const state: DraftInspectionState = {
      ...createBaselineItemized(),
      expense: null,
    };
    expect(hasMeaningfulDraft(state, meId)).toBe(false);
  });

  it("returns false for fresh itemized baseline", () => {
    expect(hasMeaningfulDraft(createBaselineItemized(), meId)).toBe(false);
  });

  it("returns false for fresh single_amount baseline", () => {
    expect(hasMeaningfulDraft(createBaselineSingleAmount(), meId)).toBe(false);
  });

  it("returns true when +1 item is added to itemized baseline", () => {
    const state = createBaselineItemized();
    state.items = [sampleItem];
    expect(hasMeaningfulDraft(state, meId)).toBe(true);
  });

  it("returns true when +1 participant is added", () => {
    const state = createBaselineItemized();
    state.participants = [meUser, otherUser];
    expect(hasMeaningfulDraft(state, meId)).toBe(true);
  });

  it("returns true when +1 payer is added", () => {
    const state = createBaselineItemized();
    state.payers = [samplePayer];
    expect(hasMeaningfulDraft(state, meId)).toBe(true);
  });

  it("returns true when occurredOn is set", () => {
    const state = createBaselineItemized();
    state.occurredOn = "2026-09-17";
    expect(hasMeaningfulDraft(state, meId)).toBe(true);
  });

  it("returns true for single_amount with only totalAmountInput 5000", () => {
    const state = createBaselineSingleAmount();
    state.totalAmountInput = 5000;
    expect(hasMeaningfulDraft(state, meId)).toBe(true);
  });

  it("returns true when receiptAccessKey is set", () => {
    const state = createBaselineItemized();
    state.receiptAccessKey = "access-key-123";
    expect(hasMeaningfulDraft(state, meId)).toBe(true);
  });

  it("returns true when guests are added", () => {
    const state = createBaselineItemized();
    state.guests = [{ id: "guest-1", name: "Guest User", remoteId: null }];
    expect(hasMeaningfulDraft(state, meId)).toBe(true);
  });

  it("returns true when title deviates from baseline", () => {
    const state = createBaselineItemized();
    state.expense!.title = "Bar do Zé";
    expect(hasMeaningfulDraft(state, meId)).toBe(true);
  });

  it("returns true when service fee deviates from baseline", () => {
    const state = createBaselineItemized();
    state.expense!.serviceFeeBasisPoints = 0;
    expect(hasMeaningfulDraft(state, meId)).toBe(true);
  });
});
