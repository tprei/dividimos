import { isApplePrivateRelayEmail } from "./apple-private-relay";

const PENDING_SIGN_IN_NAME_KEY = "dividimos:pending-sign-in-name";

interface PendingSignInName {
  userId: string;
  name: string;
}

// sessionStorage throws in some private-browsing modes; a lost name only means
// onboarding asks for it, so storage failures are not surfaced.
function readEntry(): PendingSignInName | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(PENDING_SIGN_IN_NAME_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("userId" in parsed) ||
    !("name" in parsed) ||
    typeof parsed.userId !== "string" ||
    typeof parsed.name !== "string"
  ) {
    return null;
  }
  return { userId: parsed.userId, name: parsed.name };
}

export function setPendingSignInName(userId: string, name: string): void {
  const trimmed = name.trim();
  if (trimmed === "") return;
  const entry: PendingSignInName = { userId, name: trimmed };
  try {
    window.sessionStorage.setItem(PENDING_SIGN_IN_NAME_KEY, JSON.stringify(entry));
  } catch {
    return;
  }
}

export function getPendingSignInName(userId: string): string | null {
  const entry = readEntry();
  return entry !== null && entry.userId === userId ? entry.name : null;
}

export function clearPendingSignInName(): void {
  try {
    window.sessionStorage.removeItem(PENDING_SIGN_IN_NAME_KEY);
  } catch {
    return;
  }
}

/**
 * The name onboarding starts from when sign-in shared none. A new user's
 * profile name falls back to the email's local part, which for Apple's Hide My
 * Email relay is a random string, so that case starts empty and onboarding
 * collects a real name.
 */
export function onboardingNameFallback(me: { name: string; email: string }): string {
  const email = me.email.trim();
  if (isApplePrivateRelayEmail(email) && me.name === email.slice(0, email.indexOf("@"))) return "";
  return me.name;
}
