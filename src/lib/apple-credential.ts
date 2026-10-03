export type AppleCredentialResponse =
  | { ok: true }
  | { ok: false; code: "unauthenticated" }
  | { ok: false; code: "invalid_argument" }
  | { ok: false; code: "apple_code_rejected" }
  | { ok: false; code: "apple_identity_mismatch" }
  | { ok: false; code: "account_deleted" }
  | { ok: false; code: "apple_rate_limited" }
  | { ok: false; code: "apple_unavailable" };

const FAILURE_CODES: readonly (Exclude<AppleCredentialResponse, { ok: true }>["code"])[] = [
  "unauthenticated",
  "invalid_argument",
  "apple_code_rejected",
  "apple_identity_mismatch",
  "account_deleted",
  "apple_rate_limited",
  "apple_unavailable",
];

function isFailureCode(
  value: unknown,
): value is Exclude<AppleCredentialResponse, { ok: true }>["code"] {
  return typeof value === "string" && (FAILURE_CODES as readonly string[]).includes(value);
}

export function decodeAppleCredentialResponse(raw: unknown): AppleCredentialResponse | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.ok === true) return { ok: true };
  if (record.ok === false && isFailureCode(record.code)) {
    return { ok: false, code: record.code };
  }
  return null;
}
