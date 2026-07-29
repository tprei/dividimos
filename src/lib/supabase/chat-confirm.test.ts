import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import {
  confirmChatExpense,
  getChatExpenseConfirmation,
  cancelChatExpenseConfirmation,
  buildChatExpenseConfirmationRequest,
  requestsAreEqual,
  type ChatExpenseConfirmationRequest,
} from "./chat-confirm";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import type { UserProfile } from "@/types";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lastRpcArgs(rpcName: string): Record<string, unknown> {
  const calls = mock.findCalls(`rpc:${rpcName}`, "rpc");
  const call = calls[calls.length - 1];
  if (!call || !isRecord(call.args[1])) {
    throw new Error(`Expected ${rpcName} RPC arguments`);
  }
  return call.args[1];
}

const baseRequest: ChatExpenseConfirmationRequest = {
  schemaVersion: 1,
  groupId: "group-1",
  title: "Pizza",
  merchantName: null,
  expenseType: "single_amount",
  totalAmountCents: 10000 as ChatExpenseConfirmationRequest["totalAmountCents"],
  items: [],
  shares: [
    { userId: "user-alice", shareAmountCents: 5000 as never },
    { userId: "user-bob", shareAmountCents: 5000 as never },
  ],
  payers: [{ userId: "user-alice", amountCents: 10000 as never }],
};

const committedResultRow = {
  operation_id: "op-1",
  outcome: "committed",
  created: true,
  operation_created_at: "2026-01-01T00:00:00Z",
  terminal_code: null,
  expense: { id: "expense-1", status: "active", created_at: "2026-01-01T00:00:00Z" },
  system_message_id: "msg-1",
};

describe("confirmChatExpense", () => {
  it("encodes the exact wire payload", async () => {
    mock.onRpc("confirm_chat_expense", { data: committedResultRow });

    await confirmChatExpense("op-1", baseRequest);

    const args = lastRpcArgs("confirm_chat_expense");
    expect(args.p_operation_id).toBe("op-1");
    expect(args.p_request).toEqual({
      schema_version: 1,
      group_id: "group-1",
      title: "Pizza",
      merchant_name: null,
      expense_type: "single_amount",
      total_amount_cents: 10000,
      items: [],
      shares: [
        { user_id: "user-alice", share_amount_cents: 5000 },
        { user_id: "user-bob", share_amount_cents: 5000 },
      ],
      payers: [{ user_id: "user-alice", amount_cents: 10000 }],
    });
  });

  it("decodes a committed result", async () => {
    mock.onRpc("confirm_chat_expense", { data: committedResultRow });

    const result = await confirmChatExpense("op-1", baseRequest);

    expect(result).toEqual({
      operationId: "op-1",
      outcome: "committed",
      created: true,
      operationCreatedAt: "2026-01-01T00:00:00Z",
      terminalCode: null,
      expense: { id: "expense-1", status: "active", createdAt: "2026-01-01T00:00:00Z" },
      systemMessageId: "msg-1",
    });
  });

  it("decodes a replay result with created:false", async () => {
    mock.onRpc("confirm_chat_expense", { data: { ...committedResultRow, created: false } });

    const result = await confirmChatExpense("op-1", baseRequest);

    expect("created" in result && result.created).toBe(false);
  });

  it("decodes a cancelled result", async () => {
    mock.onRpc("confirm_chat_expense", {
      data: {
        operation_id: "op-1",
        outcome: "cancelled",
        created: false,
        operation_created_at: "2026-01-01T00:00:00Z",
        terminal_code: "client_cancelled",
        expense: null,
        system_message_id: null,
      },
    });

    const result = await confirmChatExpense("op-1", baseRequest);

    expect(result).toEqual({
      operationId: "op-1",
      outcome: "cancelled",
      created: false,
      operationCreatedAt: "2026-01-01T00:00:00Z",
      terminalCode: "client_cancelled",
      expense: null,
      systemMessageId: null,
    });
  });

  it.each([
    ["PST01", "Faça login para confirmar a despesa."],
    ["PST02", "Os dados da despesa são inválidos."],
    ["PST03", "Os dados da despesa são inválidos."],
    ["PST04", "Os participantes informados não são válidos para esta conversa."],
    ["PST05", "Você não tem permissão para confirmar esta despesa."],
    ["PST06", "Esta confirmação entrou em conflito com uma tentativa anterior."],
    ["PST07", "Não foi possível confirmar esta despesa."],
    ["PST08", "Esta conversa não está mais disponível para confirmação."],
  ])("maps RPC code %s to a safe PT-BR message", async (code, expectedMessage) => {
    mock.onRpc("confirm_chat_expense", { data: null, error: { code, message: "raw db detail" } });

    const result = await confirmChatExpense("op-1", baseRequest);

    expect(result).toEqual({ error: expectedMessage, code });
  });

  it("does not expose raw RPC error text for an unmapped code", async () => {
    mock.onRpc("confirm_chat_expense", {
      data: null,
      error: { code: "XX000", message: "internal database connection string leaked" },
    });

    const result = await confirmChatExpense("op-1", baseRequest);

    expect(JSON.stringify(result)).not.toContain("connection string");
  });

  it("rejects a malformed successful result", async () => {
    mock.onRpc("confirm_chat_expense", { data: { unexpected: true } });

    const result = await confirmChatExpense("op-1", baseRequest);

    expect("error" in result).toBe(true);
  });
});

describe("getChatExpenseConfirmation", () => {
  it("sends only the operation id", async () => {
    mock.onRpc("get_chat_expense_confirmation", {
      data: {
        operation_id: "op-1",
        outcome: "not_found",
        created: false,
        operation_created_at: null,
        terminal_code: null,
        expense: null,
        system_message_id: null,
      },
    });

    await getChatExpenseConfirmation("op-1");

    expect(lastRpcArgs("get_chat_expense_confirmation")).toEqual({ p_operation_id: "op-1" });
  });

  it("decodes not_found", async () => {
    mock.onRpc("get_chat_expense_confirmation", {
      data: {
        operation_id: "op-1",
        outcome: "not_found",
        created: false,
        operation_created_at: null,
        terminal_code: null,
        expense: null,
        system_message_id: null,
      },
    });

    const result = await getChatExpenseConfirmation("op-1");

    expect(result).toEqual({
      operationId: "op-1",
      outcome: "not_found",
      created: false,
      operationCreatedAt: null,
      terminalCode: null,
      expense: null,
      systemMessageId: null,
    });
  });
});

describe("cancelChatExpenseConfirmation", () => {
  it("encodes operation id, request, and terminal code", async () => {
    mock.onRpc("cancel_chat_expense_confirmation", {
      data: {
        operation_id: "op-1",
        outcome: "cancelled",
        created: false,
        operation_created_at: "2026-01-01T00:00:00Z",
        terminal_code: "client_cancelled",
        expense: null,
        system_message_id: null,
      },
    });

    await cancelChatExpenseConfirmation("op-1", baseRequest, "client_cancelled");

    const args = lastRpcArgs("cancel_chat_expense_confirmation");
    expect(args.p_operation_id).toBe("op-1");
    expect(args.p_terminal_code).toBe("client_cancelled");
    expect(isRecord(args.p_request)).toBe(true);
  });
});

// ============================================================
// buildChatExpenseConfirmationRequest — pure adapter
// ============================================================

function makeResult(overrides: Partial<ChatExpenseResult> = {}): ChatExpenseResult {
  return {
    title: "Pizza",
    amountCents: 10000,
    expenseType: "single_amount",
    splitType: "equal",
    allocations: [],
    items: [],
    participants: [],
    payerHandle: null,
    merchantName: null,
    confidence: "high",
    ...overrides,
  };
}

const ALICE: UserProfile = { id: "user-alice", handle: "alice", name: "Alice" };
const BOB: UserProfile = { id: "user-bob", handle: "bob", name: "Bob" };

describe("buildChatExpenseConfirmationRequest", () => {
  it("distributes shares equally among all DM members when no participants specified", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({ amountCents: 10000 }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    if ("error" in built) throw new Error(built.error);
    expect(built.shares).toHaveLength(2);
    expect(built.shares.reduce((sum, s) => sum + s.shareAmountCents, 0)).toBe(10000);
  });

  it("handles odd amount remainder in equal splits (remainder on first participant)", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({ amountCents: 10001 }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    if ("error" in built) throw new Error(built.error);
    const total = built.shares.reduce((sum, s) => sum + s.shareAmountCents, 0);
    expect(total).toBe(10001);
  });

  it("resolves SELF payerHandle to currentUserId", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({ payerHandle: "SELF" }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    if ("error" in built) throw new Error(built.error);
    expect(built.payers).toEqual([{ userId: ALICE.id, amountCents: 10000 }]);
  });

  it("resolves named payerHandle to the matching member ID", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({ payerHandle: "bob" }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    if ("error" in built) throw new Error(built.error);
    expect(built.payers[0]?.userId).toBe(BOB.id);
  });

  it("falls back to currentUserId for an unknown payerHandle", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({ payerHandle: "unknown-handle" }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    if ("error" in built) throw new Error(built.error);
    expect(built.payers[0]?.userId).toBe(ALICE.id);
  });

  it("uses the fallback title when result title is empty", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({ title: "" }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    if ("error" in built) throw new Error(built.error);
    expect(built.title).toBe("Despesa via IA");
  });

  it("passes items through for itemized expenses", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({
        expenseType: "itemized",
        amountCents: 3000,
        items: [
          { description: "Pizza", quantity: 1, unitPriceCents: 2000, totalCents: 2000 },
          { description: "Refri", quantity: 1, unitPriceCents: 1000, totalCents: 1000 },
        ],
      }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    if ("error" in built) throw new Error(built.error);
    expect(built.items).toHaveLength(2);
    expect(built.items[0]).toMatchObject({ description: "Pizza", totalPriceCents: 2000 });
  });

  it("rejects an item whose total does not match quantity * unit price", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({
        expenseType: "itemized",
        amountCents: 3000,
        items: [{ description: "Pizza", quantity: 2, unitPriceCents: 1000, totalCents: 3000 }],
      }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    expect("error" in built).toBe(true);
  });

  it("uses precomputedShares when provided instead of computing an equal split", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({ amountCents: 10000 }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
      precomputedShares: [
        { userId: ALICE.id, shareAmountCents: 6000 },
        { userId: BOB.id, shareAmountCents: 4000 },
      ],
    });

    if ("error" in built) throw new Error(built.error);
    expect(built.shares).toEqual([
      { userId: ALICE.id, shareAmountCents: 6000 },
      { userId: BOB.id, shareAmountCents: 4000 },
    ]);
  });

  it("falls back to equal split when precomputedShares is an empty array", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({ amountCents: 10000 }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
      precomputedShares: [],
    });

    if ("error" in built) throw new Error(built.error);
    expect(built.shares).toHaveLength(2);
    expect(built.shares.reduce((sum, s) => sum + s.shareAmountCents, 0)).toBe(10000);
  });

  it("resolves explicit participants by matched handle", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({
        participants: [{ spokenName: "Bob", matchedHandle: "bob", confidence: "high" }],
      }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    if ("error" in built) throw new Error(built.error);
    const shareUserIds = built.shares.map((s) => s.userId).sort();
    expect(shareUserIds).toEqual([ALICE.id, BOB.id].sort());
  });

  it("rejects a nonpositive amount", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({ amountCents: 0 }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    expect("error" in built).toBe(true);
  });

  it("#476: uses exact custom allocations instead of computing an equal split", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({
        amountCents: 10000,
        splitType: "custom",
        allocations: [
          { participantHandle: "SELF", shareAmountCents: 6000 },
          { participantHandle: "bob", shareAmountCents: 4000 },
        ],
      }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    if ("error" in built) throw new Error(built.error);
    expect(built.shares).toEqual([
      { userId: ALICE.id, shareAmountCents: 6000 },
      { userId: BOB.id, shareAmountCents: 4000 },
    ]);
  });

  it("#476: rejects (never silently equalizes) a custom split whose allocations were not determined", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({
        amountCents: 10000,
        splitType: "custom",
        allocations: [],
      }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    expect("error" in built).toBe(true);
  });

  it("#476: rejects a custom split whose allocations reference a handle outside the DM", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({
        amountCents: 10000,
        splitType: "custom",
        allocations: [
          { participantHandle: "SELF", shareAmountCents: 6000 },
          { participantHandle: "someone-else", shareAmountCents: 4000 },
        ],
      }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    expect("error" in built).toBe(true);
  });

  it("#476: rejects a custom split whose allocations do not sum to the total amount", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({
        amountCents: 10000,
        splitType: "custom",
        allocations: [
          { participantHandle: "SELF", shareAmountCents: 6000 },
          { participantHandle: "bob", shareAmountCents: 3000 },
        ],
      }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
    });

    expect("error" in built).toBe(true);
  });

  it("#476: precomputedShares still take priority over a custom split's allocations (Quick Charge/Quick Split paths)", () => {
    const built = buildChatExpenseConfirmationRequest({
      result: makeResult({
        amountCents: 10000,
        splitType: "custom",
        // A malformed/incomplete allocations array must not matter here -
        // precomputedShares (Quick Charge/Quick Split) always wins.
        allocations: [{ participantHandle: "SELF", shareAmountCents: 1 }],
      }),
      groupId: "group-1",
      currentUserId: ALICE.id,
      members: [ALICE, BOB],
      precomputedShares: [
        { userId: ALICE.id, shareAmountCents: 6000 },
        { userId: BOB.id, shareAmountCents: 4000 },
      ],
    });

    if ("error" in built) throw new Error(built.error);
    expect(built.shares).toEqual([
      { userId: ALICE.id, shareAmountCents: 6000 },
      { userId: BOB.id, shareAmountCents: 4000 },
    ]);
  });
});

describe("requestsAreEqual", () => {
  it("is true for two requests with the same canonical fields", () => {
    expect(requestsAreEqual(baseRequest, { ...baseRequest })).toBe(true);
  });

  it("is false when a field differs", () => {
    expect(requestsAreEqual(baseRequest, { ...baseRequest, title: "Different" })).toBe(false);
  });
});
