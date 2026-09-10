const KEY_PREFIX = "dividimos:claim-token:";

export function readClaimToken(guestId: string): string | null {
  try {
    return window.localStorage.getItem(KEY_PREFIX + guestId);
  } catch {
    return null;
  }
}

export function writeClaimToken(guestId: string, token: string): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + guestId, token);
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
