import type { MemberContext, VoiceExpenseResult } from "@/lib/voice-expense-parser";
import { LedgerError } from "@/lib/sync/errors";

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
}): Promise<VoiceExpenseResult> {
  let response: Response;
  try {
    response = await fetch("/api/voice/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: input.text, members: input.members }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new LedgerError("network", { cause: error });
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || FAILURE_FALLBACK);
  }
  try {
    return (await response.json()) as VoiceExpenseResult;
  } catch (error) {
    throw new LedgerError("invalid_wire", { cause: error });
  }
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
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
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
  return data.transcript;
}