import type { MemberContext, VoiceExpenseResult } from "@/lib/voice-expense-parser";
import { LedgerError } from "@/lib/sync/errors";

const FAILURE_FALLBACK = "Erro ao processar comando de voz";

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