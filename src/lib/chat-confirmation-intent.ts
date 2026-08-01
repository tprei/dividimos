import {
  confirmChatExpense,
  cancelChatExpenseConfirmation,
  requestsAreEqual,
  type ChatExpenseConfirmationRequest,
} from "@/lib/supabase/chat-confirm";

/**
 * Durable, account/group-scoped chat-expense confirmation intent plus a
 * thin orchestrator that guarantees: one stable operation identity per
 * reviewed request, no duplicate confirmation on retry/double-click, and
 * recoverable state across a reload while a confirmation is unresolved.
 *
 * `confirm_chat_expense` is itself idempotent (see chat-confirm.ts / #467),
 * so this module does not need a full multi-state coordinator — retrying
 * the exact same operation id/request IS the reconciliation path. Its job
 * is only to (a) persist the operation id before the first network call so
 * a reload can resume it, and (b) decide when a rejection is durable
 * (terminally cancel + free the id) versus transient (keep the id so a
 * retry replays instead of minting a new one).
 */

export type ChatExpenseConfirmationSource = "ai" | "quick_charge" | "quick_split";

const STORAGE_VERSION = 1;

export interface ChatExpenseConfirmationIntent {
  readonly storageVersion: typeof STORAGE_VERSION;
  readonly userId: string;
  readonly groupId: string;
  readonly operationId: string;
  readonly request: ChatExpenseConfirmationRequest;
  readonly source: ChatExpenseConfirmationSource;
  readonly createdAt: string;
}

function storageKey(userId: string, groupId: string): string {
  return `dividimos.chat-expense-intent.${userId}.${groupId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIntent(value: unknown, userId: string, groupId: string): value is ChatExpenseConfirmationIntent {
  if (!isRecord(value)) return false;
  return (
    value.storageVersion === STORAGE_VERSION &&
    value.userId === userId &&
    value.groupId === groupId &&
    typeof value.operationId === "string" &&
    isRecord(value.request) &&
    (value.source === "ai" || value.source === "quick_charge" || value.source === "quick_split") &&
    typeof value.createdAt === "string"
  );
}

/** Reads the one unresolved intent for this account/group, if any and valid. */
export function readStoredIntent(userId: string, groupId: string): ChatExpenseConfirmationIntent | null {
  try {
    const raw = sessionStorage.getItem(storageKey(userId, groupId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidIntent(parsed, userId, groupId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredIntent(intent: ChatExpenseConfirmationIntent): void {
  try {
    sessionStorage.setItem(storageKey(intent.userId, intent.groupId), JSON.stringify(intent));
  } catch {
    // Storage unavailable (private browsing, quota, non-browser test
    // environment): the RPC itself remains idempotent, so confirmation
    // correctness is unaffected — only reload recovery is unavailable.
  }
}

/** Clears the intent for this account/group, if any. */
export function clearStoredIntent(userId: string, groupId: string): void {
  try {
    sessionStorage.removeItem(storageKey(userId, groupId));
  } catch {
    // Nothing to do if storage is unavailable.
  }
}

export type ChatExpenseConfirmationOutcome =
  | Readonly<{ status: "committed"; expenseId: string; systemMessageId: string; created: boolean }>
  | Readonly<{ status: "error"; error: string; code: string }>;

const DURABLE_REJECTION_CODES = new Set(["PST02", "PST03", "PST04", "PST05", "PST08"]);

/**
 * Confirms a chat expense with durable, retry-safe operation identity.
 *
 * Reuses the previously reserved operation id only when the stored intent's
 * request is byte-for-byte identical to the one being confirmed now (same
 * reviewed gesture retried); otherwise mints a fresh id (a genuinely new
 * confirmation). Persists the intent before the network call so a reload
 * mid-flight can resume it, and clears it only once the outcome is terminal
 * (committed, or a durable rejection that has been explicitly cancelled).
 */
export async function confirmChatExpenseWithIntent(params: {
  userId: string;
  groupId: string;
  request: ChatExpenseConfirmationRequest;
  source: ChatExpenseConfirmationSource;
}): Promise<ChatExpenseConfirmationOutcome> {
  const { userId, groupId, request, source } = params;

  const stored = readStoredIntent(userId, groupId);
  const reuseExisting = stored !== null && requestsAreEqual(stored.request, request);
  const operationId = reuseExisting ? stored.operationId : crypto.randomUUID();

  if (!reuseExisting) {
    writeStoredIntent({
      storageVersion: STORAGE_VERSION,
      userId,
      groupId,
      operationId,
      request,
      source,
      createdAt: new Date().toISOString(),
    });
  }

  const result = await confirmChatExpense(operationId, request);

  if ("error" in result) {
    if (DURABLE_REJECTION_CODES.has(result.code)) {
      // Terminal, durable rejection: free the operation id so a later
      // retry (after the user edits and resubmits) mints a fresh one
      // rather than replaying a request that can never succeed.
      const terminalCode = result.code as "PST02" | "PST03" | "PST04" | "PST05" | "PST08";
      await cancelChatExpenseConfirmation(operationId, request, terminalCode).catch(() => {});
      clearStoredIntent(userId, groupId);
    }
    // PST06 (conflict), PST07 (corrupt), and unknown/transport failures keep
    // the stored intent: the same operation id/request is safely retriable,
    // and confirm_chat_expense's own replay is the reconciliation path.
    return { status: "error", error: result.error, code: result.code };
  }

  if (result.outcome === "committed") {
    clearStoredIntent(userId, groupId);
    return {
      status: "committed",
      expenseId: result.expense.id,
      systemMessageId: result.systemMessageId,
      created: result.created,
    };
  }

  // cancelled/retired: the operation is permanently resolved and not this
  // confirmation. Clear the intent; the caller must start a new gesture.
  clearStoredIntent(userId, groupId);
  return {
    status: "error",
    error: "Esta confirmação não está mais disponível. Tente novamente.",
    code: result.outcome,
  };
}
