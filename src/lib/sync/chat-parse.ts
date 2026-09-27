import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import {
  assertAiConsentAttempt,
  captureAiConsentAttempt,
  invalidateAiConsent,
} from "./ai-consent";
import { LedgerError } from "./errors";

const FAILURE_FALLBACK = "Erro ao processar mensagem";

/**
 * Parses a chat message into an expense draft through /api/chat/parse.
 * Transport failures throw `LedgerError("network")`; refusals carry the
 * route's PT-BR message for the caller to display.
 */
export async function parseChatExpenseMessage(input: {
  text: string;
  members?: { handle: string; name: string }[];
  signal?: AbortSignal;
}): Promise<ChatExpenseResult> {
  const attempt = captureAiConsentAttempt();

  let response: Response;
  try {
    response = await fetch("/api/chat/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: input.text, members: input.members }),
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new LedgerError("network", { cause: error });
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string; code?: string }
      | null;
    assertAiConsentAttempt(attempt);
    if (body?.code === "ai_consent_required") {
      invalidateAiConsent(attempt);
      throw new LedgerError("ai_consent_required");
    }
    throw new Error(body?.error ?? FAILURE_FALLBACK);
  }

  let result: ChatExpenseResult;
  try {
    result = (await response.json()) as ChatExpenseResult;
  } catch (error) {
    throw new LedgerError("invalid_wire", { cause: error });
  }
  assertAiConsentAttempt(attempt);
  return result;
}
