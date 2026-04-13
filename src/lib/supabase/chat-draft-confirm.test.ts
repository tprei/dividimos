import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import type { UserProfile } from "@/types";

// Mock saveExpenseDraft
const mockSaveExpenseDraft = vi.fn();
vi.mock("@/lib/supabase/expense-actions", () => ({
  saveExpenseDraft: (...args: unknown[]) => mockSaveExpenseDraft(...args),
}));

// Mock activateExpense
const mockActivateExpense = vi.fn();
vi.mock("@/lib/supabase/expense-rpc", () => ({
  activateExpense: (...args: unknown[]) => mockActivateExpense(...args),
}));

// Mock supabase client for cleanup
const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn() }) });
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ delete: () => mockDelete() }),
  }),
}));

import { confirmChatDraft } from "./chat-draft-confirm";
import type { ConfirmChatDraftParams } from "./chat-draft-confirm";

function makeResult(overrides: Partial<ChatExpenseResult> = {}): ChatExpenseResult {
  return {
    title: "Uber",
    amountCents: 2500,
    expenseType: "single_amount",
    splitType: "equal",
    items: [],
    participants: [],
    payerHandle: "SELF",
    merchantName: null,
    confidence: "high",
    ...overrides,
  };
}

const ALICE: UserProfile = { id: "user-alice", handle: "alice", name: "Alice" };
const BOB: UserProfile = { id: "user-bob", handle: "bob", name: "Bob" };

function makeParams(overrides: Partial<ConfirmChatDraftParams> = {}): ConfirmChatDraftParams {
  return {
    result: makeResult(),
    groupId: "group-dm-1",
    currentUserId: "user-alice",
    members: [ALICE, BOB],
    ...overrides,
  };
}

describe("confirmChatDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves draft and activates expense on success", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ expenseId: "exp-1" });
    mockActivateExpense.mockResolvedValue({
      expenseId: "exp-1",
      status: "active",
      updatedBalances: [],
    });

    const result = await confirmChatDraft(makeParams());

    expect(result).toEqual({
      expenseId: "exp-1",
      status: "active",
      updatedBalances: [],
    });

    // Verify draft was saved with correct params
    expect(mockSaveExpenseDraft).toHaveBeenCalledOnce();
    const draftArgs = mockSaveExpenseDraft.mock.calls[0][0];
    expect(draftArgs.groupId).toBe("group-dm-1");
    expect(draftArgs.creatorId).toBe("user-alice");
    expect(draftArgs.title).toBe("Uber");
    expect(draftArgs.totalAmount).toBe(2500);
    expect(draftArgs.expenseType).toBe("single_amount");

    // Verify activate was called with the draft ID
    expect(mockActivateExpense).toHaveBeenCalledOnce();
    expect(mockActivateExpense).toHaveBeenCalledWith({ expense_id: "exp-1" });
  });

  it("returns error when draft save fails", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ error: "DB error" });

    const result = await confirmChatDraft(makeParams());

    expect(result).toEqual({ error: "DB error" });
    expect(mockActivateExpense).not.toHaveBeenCalled();
  });

  it("cleans up draft and returns error when activation fails", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ expenseId: "exp-2" });
    mockActivateExpense.mockResolvedValue({ error: "Shares do not sum to total", code: "INVALID_SHARES" });

    const result = await confirmChatDraft(makeParams());

    expect(result).toEqual({ error: "Shares do not sum to total" });
  });

  it("distributes shares equally among all DM members when no participants specified", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ expenseId: "exp-3" });
    mockActivateExpense.mockResolvedValue({
      expenseId: "exp-3",
      status: "active",
      updatedBalances: [],
    });

    await confirmChatDraft(makeParams({ result: makeResult({ participants: [] }) }));

    const draftArgs = mockSaveExpenseDraft.mock.calls[0][0];
    expect(draftArgs.shares).toHaveLength(2);
    expect(draftArgs.shares[0].shareAmountCents + draftArgs.shares[1].shareAmountCents).toBe(2500);
  });

  it("handles odd amount remainder in equal splits", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ expenseId: "exp-4" });
    mockActivateExpense.mockResolvedValue({
      expenseId: "exp-4",
      status: "active",
      updatedBalances: [],
    });

    // 2501 cents / 2 people = 1250 + 1251
    await confirmChatDraft(
      makeParams({ result: makeResult({ amountCents: 2501 }) }),
    );

    const draftArgs = mockSaveExpenseDraft.mock.calls[0][0];
    const shares = draftArgs.shares;
    expect(shares[0].shareAmountCents + shares[1].shareAmountCents).toBe(2501);
    expect(shares[0].shareAmountCents).toBe(1251); // first gets remainder
    expect(shares[1].shareAmountCents).toBe(1250);
  });

  it("resolves SELF payerHandle to currentUserId", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ expenseId: "exp-5" });
    mockActivateExpense.mockResolvedValue({
      expenseId: "exp-5",
      status: "active",
      updatedBalances: [],
    });

    await confirmChatDraft(
      makeParams({ result: makeResult({ payerHandle: "SELF" }) }),
    );

    const draftArgs = mockSaveExpenseDraft.mock.calls[0][0];
    expect(draftArgs.payers).toEqual([
      { userId: "user-alice", amountCents: 2500 },
    ]);
  });

  it("resolves named payerHandle to member ID", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ expenseId: "exp-6" });
    mockActivateExpense.mockResolvedValue({
      expenseId: "exp-6",
      status: "active",
      updatedBalances: [],
    });

    await confirmChatDraft(
      makeParams({ result: makeResult({ payerHandle: "bob" }) }),
    );

    const draftArgs = mockSaveExpenseDraft.mock.calls[0][0];
    expect(draftArgs.payers).toEqual([
      { userId: "user-bob", amountCents: 2500 },
    ]);
  });

  it("falls back to currentUserId for unknown payerHandle", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ expenseId: "exp-7" });
    mockActivateExpense.mockResolvedValue({
      expenseId: "exp-7",
      status: "active",
      updatedBalances: [],
    });

    await confirmChatDraft(
      makeParams({ result: makeResult({ payerHandle: "unknown_user" }) }),
    );

    const draftArgs = mockSaveExpenseDraft.mock.calls[0][0];
    expect(draftArgs.payers[0].userId).toBe("user-alice");
  });

  it("uses fallback title when result title is empty", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ expenseId: "exp-8" });
    mockActivateExpense.mockResolvedValue({
      expenseId: "exp-8",
      status: "active",
      updatedBalances: [],
    });

    await confirmChatDraft(
      makeParams({ result: makeResult({ title: "" }) }),
    );

    const draftArgs = mockSaveExpenseDraft.mock.calls[0][0];
    expect(draftArgs.title).toBe("Despesa via IA");
  });

  it("passes items for itemized expenses", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ expenseId: "exp-9" });
    mockActivateExpense.mockResolvedValue({
      expenseId: "exp-9",
      status: "active",
      updatedBalances: [],
    });

    const chatResult = makeResult({
      expenseType: "itemized",
      amountCents: 5000,
      items: [
        { description: "Cerveja", quantity: 2, unitPriceCents: 1500, totalCents: 3000 },
        { description: "Batata", quantity: 1, unitPriceCents: 2000, totalCents: 2000 },
      ],
    });

    await confirmChatDraft(makeParams({ result: chatResult }));

    const draftArgs = mockSaveExpenseDraft.mock.calls[0][0];
    expect(draftArgs.items).toHaveLength(2);
    expect(draftArgs.items[0]).toEqual({
      description: "Cerveja",
      quantity: 2,
      unitPriceCents: 1500,
      totalPriceCents: 3000,
    });
  });

  it("uses precomputedShares when provided instead of equal split", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ expenseId: "exp-precomputed" });
    mockActivateExpense.mockResolvedValue({
      expenseId: "exp-precomputed",
      status: "active",
      updatedBalances: [],
    });

    const precomputedShares = [
      { userId: "user-alice", shareAmountCents: 1500 },
      { userId: "user-bob", shareAmountCents: 1000 },
    ];

    await confirmChatDraft(makeParams({ precomputedShares }));

    const draftArgs = mockSaveExpenseDraft.mock.calls[0][0];
    expect(draftArgs.shares).toEqual(precomputedShares);
  });

  it("falls back to equal split when precomputedShares is empty array", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ expenseId: "exp-empty-shares" });
    mockActivateExpense.mockResolvedValue({
      expenseId: "exp-empty-shares",
      status: "active",
      updatedBalances: [],
    });

    await confirmChatDraft(makeParams({ precomputedShares: [] }));

    const draftArgs = mockSaveExpenseDraft.mock.calls[0][0];
    expect(draftArgs.shares).toHaveLength(2);
    expect(draftArgs.shares[0].shareAmountCents + draftArgs.shares[1].shareAmountCents).toBe(2500);
  });

  it("resolves explicit participants by handle", async () => {
    mockSaveExpenseDraft.mockResolvedValue({ expenseId: "exp-10" });
    mockActivateExpense.mockResolvedValue({
      expenseId: "exp-10",
      status: "active",
      updatedBalances: [],
    });

    const chatResult = makeResult({
      participants: [
        { spokenName: "Bob", matchedHandle: "bob", confidence: "high" },
      ],
    });

    await confirmChatDraft(makeParams({ result: chatResult }));

    const draftArgs = mockSaveExpenseDraft.mock.calls[0][0];
    const shareUserIds = draftArgs.shares.map((s: { userId: string }) => s.userId);
    expect(shareUserIds).toContain("user-alice"); // always included
    expect(shareUserIds).toContain("user-bob");
  });
});
