import type { MemberContext, VoiceExpenseResult } from "@/lib/voice-expense-parser";
import {
  assertAiConsentAttempt,
  captureAiConsentAttempt,
  invalidateAiConsent,
} from "./ai-consent";
import { LedgerError } from "./errors";

const FAILURE_FALLBACK = "Erro ao processar comando de voz";
const TRANSCRIBE_FALLBACK = "Não foi possível transcrever o áudio";

/**
 * Parses a spoken expense transcript through /api/voice/parse. Transport
 * failures throw `LedgerError("network")`; refusals carry the route's PT-BR
 * message for the caller to display.
 */
export async function parseVoiceExpenseCommand(input: {
  text: string;
  members?: MemberContext[];
  signal?: AbortSignal;
}): Promise<VoiceExpenseResult> {
  const attempt = captureAiConsentAttempt();

  let response: Response;
  try {
    response = await fetch("/api/voice/parse", {
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
    throw new Error(body?.error || FAILURE_FALLBACK);
  }

  let result: VoiceExpenseResult;
  try {
    result = (await response.json()) as VoiceExpenseResult;
  } catch (error) {
    throw new LedgerError("invalid_wire", { cause: error });
  }
  assertAiConsentAttempt(attempt);
  return result;
}

/**
 * Uploads a recorded audio blob to /api/voice/transcribe and resolves the
 * transcript. Transport failures throw `LedgerError("network")`; refusals
 * carry the route's PT-BR message for the caller to display. AbortError from
 * a cancelled request passes through so callers can ignore it silently.
 */
export async function transcribeVoiceAudio(
  blob: Blob,
  signal: AbortSignal,
): Promise<string> {
  const attempt = captureAiConsentAttempt();

  const form = new FormData();
  form.append("audio", blob);

  let response: Response;
  try {
    response = await fetch("/api/voice/transcribe", {
      method: "POST",
      body: form,
      signal,
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
    throw new Error(body?.error || TRANSCRIBE_FALLBACK);
  }

  let data: { transcript?: unknown };
  try {
    data = (await response.json()) as { transcript?: unknown };
  } catch (error) {
    throw new LedgerError("invalid_wire", { cause: error });
  }
  if (typeof data.transcript !== "string") {
    throw new LedgerError("invalid_wire");
  }
  assertAiConsentAttempt(attempt);
  return data.transcript;
}
