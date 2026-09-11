const KEY_PREFIX = "dividimos:claim-token:";

export interface CachedClaimToken {
  token: string;
  expiresAt: string;
}

function isCachedClaimToken(value: unknown): value is CachedClaimToken {
  if (typeof value !== "object" || value === null) return false;
  return (
    "token" in value &&
    typeof value.token === "string" &&
    "expiresAt" in value &&
    typeof value.expiresAt === "string"
  );
}

export function readClaimTokenEntry(guestId: string): CachedClaimToken | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY_PREFIX + guestId);
  } catch {
    return null;
  }
  if (!raw) return null;

  // A value from before the expiry was tracked is a bare token string.
  const parsed: unknown = ((): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();

  if (!isCachedClaimToken(parsed) || Date.parse(parsed.expiresAt) <= Date.now()) {
    clearClaimToken(guestId);
    return null;
  }
  return parsed;
}

export function readClaimToken(guestId: string): string | null {
  return readClaimTokenEntry(guestId)?.token ?? null;
}

export function writeClaimToken(guestId: string, token: string, expiresAt: string): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + guestId, JSON.stringify({ token, expiresAt }));
  } catch {
    return;
  }
}

export function clearClaimToken(guestId: string): void {
  try {
    window.localStorage.removeItem(KEY_PREFIX + guestId);
  } catch {
    return;
  }
}
