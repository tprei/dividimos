import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatExpenseResult } from "./chat-expense-parser";

const mockSaveExpenseDraft = vi.fn();
const mockActivateExpense = vi.fn();

vi.mock("@/lib/supabase/expense-actions", () => ({
  saveExpenseDraft: mockSaveExpenseDraft,
}));

vi.mock("@/lib/supabase/expense-rpc", () => ({
  activateExpense: mockActivateExpense,
}));

const { confirmDraftExpense } = await import("./chat-draft-confirm");

const CREATOR_ID = "user-creator-uuid";
const COUNTERPARTY_ID = "user-counterparty-uuid";
const GROUP_ID = "group-uuid";
const EXPENSE_ID = "expense-uuid";

function makeResult(overrides: Partial<ChatExpenseResult> = {}): ChatExpenseResult {
  return {
    title: "Uber",
    amountCents: 2500,
    expenseType: "single_amount",
    splitType: "equal",
    items: [],
    participants: [],
    payerHandle: null,
    merchantName: null,
    confidence: "high",
    ...overrides,
  };
}

describe("confirmDraftExpense", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveExpenseDraft.mockResolvedValue({ expenseId: EXPENSE_ID });
    mockActivateExpense.mockResolvedValue({
      expenseId: EXPENSE_ID,
      status: "active",
      updatedBalances: [],
    });
  });

  it("splits equally between creator and counterparty", async () => {
    const result = await confirmDraftExpense({
      result: makeResult({ amountCents: 2500, splitType: "equal" }),
      groupId: GROUP_ID,
      creatorId: CREATOR_ID,
      counterpartyId: COUNTERPARTY_ID,
    });

    expect(result).toEqual({ success: true, expenseId: EXPENSE_ID });

    const saveCall = mockSaveExpenseDraft.mock.calls[0][0];
    const shares: Array<{ userId: string; shareAmountCents: number }> = saveCall.shares;
    const creatorShare = shares.find(
      (s: { userId: string }) => s.userId === CREATOR_ID,
    );
    const counterpartyShare = shares.find(
      (s: { userId: string }) => s.userId === COUNTERPARTY_ID,
    );

    expect(creatorShare?.shareAmountCents).toBe(1250);
    expect(counterpartyShare?.shareAmountCents).toBe(1250);
    expect(creatorShare!.shareAmountCents + counterpartyShare!.shareAmountCents).toBe(2500);
  });

  it("gives the remainder cent to the creator on odd amounts", async () => {
    const result = await confirmDraftExpense({
      result: makeResult({ amountCents: 2501, splitType: "equal" }),
      groupId: GROUP_ID,
      creatorId: CREATOR_ID,
      counterpartyId: COUNTERPARTY_ID,
    });

    expect(result).toEqual({ success: true, expenseId: EXPENSE_ID });

    const saveCall = mockSaveExpenseDraft.mock.calls[0][0];
    const shares: Array<{ userId: string; shareAmountCents: number }> = saveCall.shares;
    const creatorShare = shares.find((s) => s.userId === CREATOR_ID);
    const counterpartyShare = shares.find((s) => s.userId === COUNTERPARTY_ID);

    expect(creatorShare?.shareAmountCents).toBe(1251);
    expect(counterpartyShare?.shareAmountCents).toBe(1250);
  });

  it("maps null payerHandle to creator as payer", async () => {
    await confirmDraftExpense({
      result: makeResult({ payerHandle: null }),
      groupId: GROUP_ID,
      creatorId: CREATOR_ID,
      counterpartyId: COUNTERPARTY_ID,
    });

    const saveCall = mockSaveExpenseDraft.mock.calls[0][0];
    expect(saveCall.payers).toEqual([
      { userId: CREATOR_ID, amountCents: 2500 },
    ]);
  });

  it("maps SELF payerHandle to creator as payer", async () => {
    await confirmDraftExpense({
      result: makeResult({ payerHandle: "SELF" }),
      groupId: GROUP_ID,
      creatorId: CREATOR_ID,
      counterpartyId: COUNTERPARTY_ID,
    });

    const saveCall = mockSaveExpenseDraft.mock.calls[0][0];
    expect(saveCall.payers).toEqual([
      { userId: CREATOR_ID, amountCents: 2500 },
    ]);
  });

  it("maps a non-SELF payerHandle to counterparty as payer", async () => {
    await confirmDraftExpense({
      result: makeResult({ payerHandle: "other-handle" }),
      groupId: GROUP_ID,
      creatorId: CREATOR_ID,
      counterpartyId: COUNTERPARTY_ID,
    });

    const saveCall = mockSaveExpenseDraft.mock.calls[0][0];
    expect(saveCall.payers).toEqual([
      { userId: COUNTERPARTY_ID, amountCents: 2500 },
    ]);
  });

  it("passes title and merchantName to saveExpenseDraft", async () => {
    await confirmDraftExpense({
      result: makeResult({ title: "Pizza", merchantName: "Domino's" }),
      groupId: GROUP_ID,
      creatorId: CREATOR_ID,
      counterpartyId: COUNTERPARTY_ID,
    });

    const saveCall = mockSaveExpenseDraft.mock.calls[0][0];
    expect(saveCall.title).toBe("Pizza");
    expect(saveCall.merchantName).toBe("Domino's");
    expect(saveCall.groupId).toBe(GROUP_ID);
    expect(saveCall.creatorId).toBe(CREATOR_ID);
  });

  it("returns error when saveExpenseDraft fails", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ error: "Erro ao salvar rascunho" });

    const result = await confirmDraftExpense({
      result: makeResult(),
      groupId: GROUP_ID,
      creatorId: CREATOR_ID,
      counterpartyId: COUNTERPARTY_ID,
    });

    expect(result).toEqual({ success: false, error: "Erro ao salvar rascunho" });
    expect(mockActivateExpense).not.toHaveBeenCalled();
  });

  it("returns error when activateExpense fails", async () => {
    mockActivateExpense.mockResolvedValue({
      error: "Shares não somam ao total",
      code: "SHARES_MISMATCH",
    });

    const result = await confirmDraftExpense({
      result: makeResult(),
      groupId: GROUP_ID,
      creatorId: CREATOR_ID,
      counterpartyId: COUNTERPARTY_ID,
    });

    expect(result).toEqual({ success: false, error: "Shares não somam ao total" });
  });

  it("calls activateExpense with the expenseId returned by saveExpenseDraft", async () => {
    await confirmDraftExpense({
      result: makeResult(),
      groupId: GROUP_ID,
      creatorId: CREATOR_ID,
      counterpartyId: COUNTERPARTY_ID,
    });

    expect(mockActivateExpense).toHaveBeenCalledWith({ expense_id: EXPENSE_ID });
  });
});
