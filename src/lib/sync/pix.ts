import { LedgerError } from "@/lib/sync/errors";

/**
 * Failure reported by a /api/pix route: its HTTP status plus its own PT-BR
 * message. Callers map the status to their UI states.
 */
export class PixRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PixRequestError";
    this.status = status;
  }
}

interface PixRouteBody {
  copiaECola?: string;
  error?: string;
}

async function requestPixCode(
  route: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`/api/pix/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new LedgerError("network", { cause: error });
  }

  let parsed: PixRouteBody | null = null;
  try {
    parsed = (await response.json()) as PixRouteBody;
  } catch (error) {
    if (response.ok) throw new LedgerError("network", { cause: error });
  }

  if (response.ok && typeof parsed?.copiaECola === "string" && parsed.copiaECola) {
    return parsed.copiaECola;
  }
  const message = typeof parsed?.error === "string" ? parsed.error : "";
  throw new PixRequestError(response.status, message);
}

/** Pix "copia e cola" for charging through the caller's own key. */
export function generateSelfPixCode(input: {
  amountCents: number;
  signal?: AbortSignal;
}): Promise<string> {
  return requestPixCode("generate-self", { amountCents: input.amountCents }, input.signal);
}

/** Pix "copia e cola" for paying a group member you owe. */
export function generatePixCode(input: {
  recipientUserId: string;
  amountCents: number;
  groupId: string;
  signal?: AbortSignal;
}): Promise<string> {
  return requestPixCode(
    "generate",
    {
      recipientUserId: input.recipientUserId,
      amountCents: input.amountCents,
      groupId: input.groupId,
    },
    input.signal,
  );
}