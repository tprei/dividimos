import { createClient } from "@/lib/supabase/client";
import {
  parseExpenseCents,
  type ExpenseCents,
} from "@/lib/expense-money";
import {
  computeExpenseLineTotalCents,
  parseExpenseQuantity,
} from "@/lib/expense-quantity";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import type { UserProfile } from "@/types";

// ============================================================
// Canonical request — the exact schema-v1 shape confirm_chat_expense
// requires. Field names match the wire shape the SQL function decodes.
// ============================================================

export interface ChatExpenseConfirmationItem {
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceCents: ExpenseCents;
  readonly totalPriceCents: ExpenseCents;
}

export interface ChatExpenseConfirmationShare {
  readonly userId: string;
  readonly shareAmountCents: ExpenseCents;
}

export interface ChatExpenseConfirmationPayer {
  readonly userId: string;
  readonly amountCents: ExpenseCents;
}

export interface ChatExpenseConfirmationRequest {
  readonly schemaVersion: 1;
  readonly groupId: string;
  readonly title: string;
  readonly merchantName: string | null;
  readonly expenseType: "itemized" | "single_amount";
  readonly totalAmountCents: ExpenseCents;
  readonly items: readonly ChatExpenseConfirmationItem[];
  readonly shares: readonly ChatExpenseConfirmationShare[];
  readonly payers: readonly ChatExpenseConfirmationPayer[];
}

// ============================================================
// Result — decoded from confirm_chat_expense / get_chat_expense_confirmation
// / cancel_chat_expense_confirmation. All three RPCs return this same shape.
// ============================================================

export type ChatExpenseConfirmationResult =
  | Readonly<{
      operationId: string;
      outcome: "committed";
      created: boolean;
      operationCreatedAt: string;
      terminalCode: null;
      expense: Readonly<{ id: string; status: "active"; createdAt: string }>;
      systemMessageId: string;
    }>
  | Readonly<{
      operationId: string;
      outcome: "cancelled" | "retired";
      created: false;
      operationCreatedAt: string;
      terminalCode: string;
      expense: null;
      systemMessageId: null;
    }>
  | Readonly<{
      operationId: string;
      outcome: "not_found";
      created: false;
      operationCreatedAt: null;
      terminalCode: null;
      expense: null;
      systemMessageId: null;
    }>;

export type ChatExpenseConfirmationError = Readonly<{
  error: string;
  code: string;
}>;

// ============================================================
// Wire encode/decode. The database, not TypeScript key order, defines the
// canonical request's equality; this module only builds and reads it.
// ============================================================

function encodeRequest(request: ChatExpenseConfirmationRequest): Record<string, unknown> {
  return {
    schema_version: 1,
    group_id: request.groupId,
    title: request.title,
    merchant_name: request.merchantName,
    expense_type: request.expenseType,
    total_amount_cents: request.totalAmountCents,
    items: request.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_price_cents: item.unitPriceCents,
      total_price_cents: item.totalPriceCents,
    })),
    shares: request.shares.map((share) => ({
      user_id: share.userId,
      share_amount_cents: share.shareAmountCents,
    })),
    payers: request.payers.map((payer) => ({
      user_id: payer.userId,
      amount_cents: payer.amountCents,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeResult(raw: unknown): ChatExpenseConfirmationResult | null {
  if (!isRecord(raw)) return null;
  const { operation_id, outcome, created, operation_created_at, terminal_code, expense, system_message_id } = raw;

  if (typeof operation_id !== "string") return null;

  if (outcome === "committed") {
    if (typeof created !== "boolean") return null;
    if (typeof operation_created_at !== "string") return null;
    if (terminal_code !== null) return null;
    if (!isRecord(expense)) return null;
    if (typeof expense.id !== "string" || expense.status !== "active" || typeof expense.created_at !== "string") {
      return null;
    }
    if (typeof system_message_id !== "string") return null;

    return {
      operationId: operation_id,
      outcome: "committed",
      created,
      operationCreatedAt: operation_created_at,
      terminalCode: null,
      expense: { id: expense.id, status: "active", createdAt: expense.created_at },
      systemMessageId: system_message_id,
    };
  }

  if (outcome === "cancelled" || outcome === "retired") {
    if (typeof operation_created_at !== "string") return null;
    if (typeof terminal_code !== "string") return null;
    if (expense !== null || system_message_id !== null) return null;

    return {
      operationId: operation_id,
      outcome,
      created: false,
      operationCreatedAt: operation_created_at,
      terminalCode: terminal_code,
      expense: null,
      systemMessageId: null,
    };
  }

  if (outcome === "not_found") {
    return {
      operationId: operation_id,
      outcome: "not_found",
      created: false,
      operationCreatedAt: null,
      terminalCode: null,
      expense: null,
      systemMessageId: null,
    };
  }

  return null;
}

/**
 * Maps a confirm/get/cancel PostgREST error to a safe PT-BR message. Callers
 * inspect `.code`, never `.error` text, for control flow.
 */
function chatConfirmationErrorMessage(code: string | undefined): string {
  switch (code) {
    case "PST01":
      return "Faça login para confirmar a despesa.";
    case "PST02":
    case "PST03":
      return "Os dados da despesa são inválidos.";
    case "PST04":
      return "Os participantes informados não são válidos para esta conversa.";
    case "PST05":
      return "Você não tem permissão para confirmar esta despesa.";
    case "PST06":
      return "Esta confirmação entrou em conflito com uma tentativa anterior.";
    case "PST07":
      return "Não foi possível confirmar esta despesa.";
    case "PST08":
      return "Esta conversa não está mais disponível para confirmação.";
    default:
      return "Não foi possível confirmar a despesa. Tente novamente.";
  }
}

async function callConfirmationRpc(
  name: "confirm_chat_expense" | "get_chat_expense_confirmation" | "cancel_chat_expense_confirmation",
  args: Record<string, unknown>,
): Promise<ChatExpenseConfirmationResult | ChatExpenseConfirmationError> {
  const supabase = createClient();
  // Generated database types cannot express these three RPCs' request/result
  // jsonb shapes structurally beyond `Json`; the strict decoder above is the
  // real boundary that validates every field before any caller trusts it.
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
  )(name, args);

  if (error) {
    return { error: chatConfirmationErrorMessage(error.code), code: error.code ?? "unknown" };
  }

  const result = decodeResult(data);
  if (!result) {
    return { error: chatConfirmationErrorMessage(undefined), code: "invalid_result" };
  }

  return result;
}

/**
 * Confirms one chat expense atomically: draft creation, activation, balance
 * mutation, and the DM system message commit together as one outcome, or
 * roll back together. Idempotent: calling again with the same operationId
 * and an identical request replays the original committed/cancelled/retired
 * outcome with `created: false` and no additional effect.
 */
export async function confirmChatExpense(
  operationId: string,
  request: ChatExpenseConfirmationRequest,
): Promise<ChatExpenseConfirmationResult | ChatExpenseConfirmationError> {
  return callConfirmationRpc("confirm_chat_expense", {
    p_operation_id: operationId,
    p_request: encodeRequest(request),
  });
}

/** Exact-owner recovery read. Does not check current group membership. */
export async function getChatExpenseConfirmation(
  operationId: string,
): Promise<ChatExpenseConfirmationResult | ChatExpenseConfirmationError> {
  return callConfirmationRpc("get_chat_expense_confirmation", {
    p_operation_id: operationId,
  });
}

/** Terminal cancellation. Never reverses an already-committed confirmation. */
export async function cancelChatExpenseConfirmation(
  operationId: string,
  request: ChatExpenseConfirmationRequest,
  terminalCode: "client_cancelled" | "PST02" | "PST03" | "PST04" | "PST05" | "PST08",
): Promise<ChatExpenseConfirmationResult | ChatExpenseConfirmationError> {
  return callConfirmationRpc("cancel_chat_expense_confirmation", {
    p_operation_id: operationId,
    p_request: encodeRequest(request),
    p_terminal_code: terminalCode,
  });
}

// ============================================================
// Pure adapter: ChatExpenseResult (+ resolved identities) -> canonical
// request. This preserves the resolution behavior the prior two-step
// confirmChatDraft used (equal-split remainder-to-first, payer handle
// resolution, precomputed shares passthrough, itemized line conversion).
// ============================================================

export interface PrecomputedShare {
  userId: string;
  shareAmountCents: number;
}

export interface BuildChatConfirmationRequestParams {
  /** The parsed/reviewed expense. */
  result: ChatExpenseResult;
  /** The DM group this expense belongs to. */
  groupId: string;
  /** The authenticated user who is confirming the draft. */
  currentUserId: string;
  /** All members of the DM group (exactly 2 for a DM). */
  members: UserProfile[];
  /** Pre-computed shares for non-equal splits. When provided, skips equal-split computation. */
  precomputedShares?: PrecomputedShare[];
}

function resolveParticipantIds(
  result: ChatExpenseResult,
  currentUserId: string,
  members: UserProfile[],
): string[] {
  if (result.participants.length === 0) {
    return members.map((m) => m.id);
  }

  const ids = new Set<string>();
  ids.add(currentUserId);

  for (const p of result.participants) {
    if (p.matchedHandle) {
      const member = members.find((m) => m.handle === p.matchedHandle);
      if (member) ids.add(member.id);
    }
  }

  if (ids.size < 2 && members.length === 2) {
    for (const m of members) ids.add(m.id);
  }

  return Array.from(ids);
}

function resolvePayerId(
  result: ChatExpenseResult,
  currentUserId: string,
  members: UserProfile[],
): string {
  if (!result.payerHandle || result.payerHandle === "SELF") {
    return currentUserId;
  }

  const member = members.find((m) => m.handle === result.payerHandle);
  return member?.id ?? currentUserId;
}

/**
 * Builds the canonical confirm_chat_expense request from a reviewed
 * ChatExpenseResult, or returns a safe PT-BR error when the reviewed data
 * cannot produce a valid request. Performs no I/O and no operation
 * reservation.
 */
export function buildChatExpenseConfirmationRequest(
  params: BuildChatConfirmationRequestParams,
): ChatExpenseConfirmationRequest | { error: string } {
  const { result, groupId, currentUserId, members, precomputedShares } = params;

  const amount = parseExpenseCents(result.amountCents, "positive");
  if (!amount.ok) {
    return { error: "A despesa reconhecida não tem um valor válido." };
  }

  const participantIds = resolveParticipantIds(result, currentUserId, members);
  const payerId = resolvePayerId(result, currentUserId, members);
  if (participantIds.length === 0 || !participantIds.includes(payerId)) {
    return { error: "Não foi possível identificar os participantes da despesa." };
  }

  let shares: ChatExpenseConfirmationShare[];
  if (precomputedShares && precomputedShares.length > 0) {
    shares = [];
    for (const share of precomputedShares) {
      const parsed = parseExpenseCents(share.shareAmountCents, "allow");
      if (!parsed.ok) {
        return { error: "A divisão reconhecida não é válida." };
      }
      shares.push({ userId: share.userId, shareAmountCents: parsed.value });
    }
  } else {
    const perPersonCents = Math.floor(result.amountCents / participantIds.length);
    const remainder = result.amountCents - perPersonCents * participantIds.length;
    shares = [];
    for (const [index, userId] of participantIds.entries()) {
      const parsed = parseExpenseCents(
        perPersonCents + (index === 0 ? remainder : 0),
        "allow",
      );
      if (!parsed.ok) {
        return { error: "A divisão reconhecida não é válida." };
      }
      shares.push({ userId, shareAmountCents: parsed.value });
    }
  }

  const items: ChatExpenseConfirmationItem[] = [];
  if (result.expenseType === "itemized") {
    for (const item of result.items) {
      const quantity = parseExpenseQuantity(item.quantity);
      const unitPriceCents = parseExpenseCents(item.unitPriceCents, "positive");
      const totalPriceCents = parseExpenseCents(item.totalCents, "positive");
      if (!quantity.ok || !unitPriceCents.ok || !totalPriceCents.ok) {
        return { error: "Os itens reconhecidos não são válidos." };
      }
      const computed = computeExpenseLineTotalCents(quantity.value, unitPriceCents.value);
      if (!computed.ok || computed.value !== totalPriceCents.value) {
        return { error: "Os itens reconhecidos não fecham a conta." };
      }
      items.push({
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: unitPriceCents.value,
        totalPriceCents: totalPriceCents.value,
      });
    }
  }

  const payerAmount = parseExpenseCents(amount.value, "positive");
  if (!payerAmount.ok) {
    return { error: "O pagador reconhecido não é válido." };
  }

  return {
    schemaVersion: 1,
    groupId,
    title: result.title || "Despesa via IA",
    merchantName: result.merchantName,
    expenseType: result.expenseType,
    totalAmountCents: amount.value,
    items,
    shares,
    payers: [{ userId: payerId, amountCents: payerAmount.value }],
  };
}

/** Deep-equality check for two canonical requests (session-storage guard). */
export function requestsAreEqual(
  a: ChatExpenseConfirmationRequest,
  b: ChatExpenseConfirmationRequest,
): boolean {
  return JSON.stringify(encodeRequest(a)) === JSON.stringify(encodeRequest(b));
}
