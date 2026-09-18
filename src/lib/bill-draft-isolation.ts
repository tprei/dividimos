import { useBillStore } from "@/stores/bill-store";

// The live key belongs to the bill store's persist config (it carries the
// Supabase storage namespace); derive it so a rename there cannot strand drafts.
function liveDraftKey(): string {
  return useBillStore.persist.getOptions().name ?? "dividimos-draft";
}
const OWNER_KEY = "dividimos-draft-owner";

function archiveKey(userId: string): string {
  return `${liveDraftKey()}:${userId}`;
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or quota: the in-memory reset still isolates the accounts.
  }
}

function removeRaw(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best effort; the in-memory reset already isolated the accounts.
  }
}

export function getDraftOwner(): string | null {
  return readRaw(OWNER_KEY);
}

export function setDraftOwner(userId: string): void {
  writeRaw(OWNER_KEY, userId);
}

export function archiveCurrentDraft(userId: string | null): void {
  if (userId === null) {
    removeRaw(liveDraftKey());
    removeRaw(OWNER_KEY);
    return;
  }
  // An ownerless (legacy) draft is never assigned to the account leaving the
  // device; it is dropped instead.
  const live = getDraftOwner() === userId ? serializeLiveDraft() : null;
  if (live !== null) {
    writeRaw(archiveKey(userId), live);
  } else {
    removeRaw(archiveKey(userId));
  }
  removeRaw(liveDraftKey());
  removeRaw(OWNER_KEY);
}

// Serializes through the store's own persist config so the archived envelope
// and the live persist key can never drift apart.
function serializeLiveDraft(): string | null {
  const state = useBillStore.getState();
  if (state.expense === null) return readRaw(liveDraftKey());
  const { partialize, version } = useBillStore.persist.getOptions();
  if (!partialize) return readRaw(liveDraftKey());
  try {
    return JSON.stringify({ state: partialize(state), version });
  } catch {
    return readRaw(liveDraftKey());
  }
}

export function restoreAccountDraft(userId: string): void {
  const archived = readRaw(archiveKey(userId));
  if (archived !== null) {
    writeRaw(liveDraftKey(), archived);
    removeRaw(archiveKey(userId));
    removeRaw(OWNER_KEY);
  } else {
    removeRaw(liveDraftKey());
  }
  setDraftOwner(userId);
}

