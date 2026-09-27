export const AI_CONSENT_VERSION = 1;
export const AI_CONSENT_KEY = "dividimos.ai.consent";

interface AiConsentEntry {
  version: number;
  grantedAt: string;
}

function readAll(): Record<string, AiConsentEntry> {
  try {
    const raw = localStorage.getItem(AI_CONSENT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const entries: Record<string, AiConsentEntry> = {};
    for (const [accountId, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null) continue;
      const { version, grantedAt } = value as Record<string, unknown>;
      if (typeof version !== "number" || !Number.isInteger(version)) continue;
      if (typeof grantedAt !== "string") continue;
      entries[accountId] = { version, grantedAt };
    }
    return entries;
  } catch {
    return {};
  }
}

function writeAll(entries: Record<string, AiConsentEntry>): boolean {
  try {
    localStorage.setItem(AI_CONSENT_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

export function hasAiConsent(accountId: string | null): boolean {
  if (!accountId) return false;
  return readAll()[accountId]?.version === AI_CONSENT_VERSION;
}

export function grantAiConsent(accountId: string, now: Date = new Date()): boolean {
  const entries = readAll();
  entries[accountId] = { version: AI_CONSENT_VERSION, grantedAt: now.toISOString() };
  const saved = writeAll(entries);
  if (saved) notifyListeners();
  return saved;
}

export function revokeAiConsent(accountId: string): void {
  const entries = readAll();
  delete entries[accountId];
  writeAll(entries);
  notifyListeners();
}

export function subscribeAiConsent(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === AI_CONSENT_KEY) listener();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function __resetAiConsentForTests(): void {
  try {
    localStorage.removeItem(AI_CONSENT_KEY);
  } catch {
    return;
  }
}
