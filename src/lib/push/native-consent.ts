/**
 * Durable record of which accounts asked for push on this device.
 *
 * OS permission is not consent: it survives an in-app opt-out, and older
 * Android versions report it granted without ever asking. Inferring opt-in
 * from permission alone silently re-enrolled people who had turned push off.
 */
const CONSENT_KEY = "dividimos.push.consent";

function readAll(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const entries: Record<string, boolean> = {};
    for (const [accountId, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") entries[accountId] = value;
    }
    return entries;
  } catch {
    return {};
  }
}

function writeAll(entries: Record<string, boolean>): void {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(entries));
  } catch {
    // Consent is best-effort storage: a private-mode browser still works for
    // this session, it just cannot remember the choice.
  }
}

/** Has this account opted in to push on this device? */
export function hasNativePushConsent(accountId: string | null): boolean {
  if (!accountId) return false;
  return readAll()[accountId] === true;
}

/** Record this account's explicit choice on this device. */
export function setNativePushConsent(accountId: string | null, granted: boolean): void {
  if (!accountId) return;
  const entries = readAll();
  entries[accountId] = granted;
  writeAll(entries);
}

/** Test seam: forget every recorded choice. */
export function __resetNativePushConsentForTests(): void {
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
