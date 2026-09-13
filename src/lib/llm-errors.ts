export type LlmFailureCode =
  | "LLM_TIMEOUT"
  | "LLM_QUOTA"
  | "LLM_UNAVAILABLE"
  | "LLM_CONFIG"
  | "LLM_INTERNAL";

export interface LlmFailure {
  status: 429 | 500 | 503 | 504;
  code: LlmFailureCode;
  retryable: boolean;
}

/** Numeric HTTP status the installed AI SDK attaches to transport errors. */
function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  for (const key of ["status", "code", "statusCode"] as const) {
    if (key in error) {
      const value = (error as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isInteger(value)) return value;
    }
  }
  return null;
}

function isAbort(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  const name = (error as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Maps a dependency failure to the status this app should return, using the
 * error's structure only. Provider message text is never parsed: it is not a
 * stable contract and it must never reach the client.
 */
export function classifyLlmFailure(error: unknown): LlmFailure {
  if (isAbort(error)) {
    return { status: 504, code: "LLM_TIMEOUT", retryable: true };
  }

  switch (statusOf(error)) {
    case 429:
      return { status: 429, code: "LLM_QUOTA", retryable: true };
    case 500:
    case 502:
    case 503:
    case 504:
      return { status: 503, code: "LLM_UNAVAILABLE", retryable: true };
    // Our credentials are wrong, so retrying the same request cannot help.
    case 401:
    case 403:
      return { status: 503, code: "LLM_CONFIG", retryable: false };
    default:
      return { status: 500, code: "LLM_INTERNAL", retryable: false };
  }
}

/**
 * Generic PT-BR copy per failure kind. Deliberately says nothing about the
 * provider, the model, quotas or credentials.
 */
export const LLM_FAILURE_MESSAGE: Record<LlmFailureCode, string> = {
  LLM_TIMEOUT: "Demorou demais. Tenta de novo.",
  LLM_QUOTA: "Muitas requisições agora. Tenta de novo em alguns segundos.",
  LLM_UNAVAILABLE: "Serviço temporariamente indisponível. Tenta de novo.",
  LLM_CONFIG: "Serviço temporariamente indisponível.",
  LLM_INTERNAL: "Não foi possível processar agora.",
};
