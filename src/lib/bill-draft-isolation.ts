import { useBillStore } from "@/stores/bill-store";

const LIVE_DRAFT_KEY = "dividimos-draft";
const OWNER_KEY = "dividimos-draft-owner";

function archiveKey(userId: string): string {
  return `${LIVE_DRAFT_KEY}:${userId}`;
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
    removeRaw(LIVE_DRAFT_KEY);
    removeRaw(OWNER_KEY);
    return;
  }
  const live = serializeLiveDraft() ?? readRaw(LIVE_DRAFT_KEY);
  if (live !== null) {
    writeRaw(archiveKey(userId), live);
  } else {
    removeRaw(archiveKey(userId));
  }
  removeRaw(LIVE_DRAFT_KEY);
  removeRaw(OWNER_KEY);
}

function serializeLiveDraft(): string | null {
  const state = useBillStore.getState();
  if (state.expense === null) return readRaw(LIVE_DRAFT_KEY);
  try {
    return JSON.stringify({
      state: {
        expense: state.expense,
        totalAmountInput: state.totalAmountInput,
        participants: state.participants,
        guests: state.guests,
        items: state.items,
        payers: state.payers,
        splits: state.splits,
        billSplits: state.billSplits,
        occurredOn: state.occurredOn,
        receiptAccessKey: state.receiptAccessKey,
      },
      version: 2,
    });
  } catch {
    return readRaw(LIVE_DRAFT_KEY);
  }
}

export function restoreAccountDraft(userId: string): void {
  const archived = readRaw(archiveKey(userId));
  if (archived !== null) {
    writeRaw(LIVE_DRAFT_KEY, archived);
    removeRaw(archiveKey(userId));
    removeRaw(OWNER_KEY);
  } else {
    removeRaw(LIVE_DRAFT_KEY);
  }
  setDraftOwner(userId);
}

export interface DraftScope {
  userId: string;
  generation: number;
}

let generationCounter = 0;

export function createDraftScope(userId: string): DraftScope {
  generationCounter += 1;
  return { userId, generation: generationCounter };
}

export function isDraftScopeValid(
  scope: DraftScope,
  currentUserId: string | null,
): boolean {
  return (
    currentUserId !== null &&
    scope.userId === currentUserId &&
    getDraftOwner() === currentUserId
  );
}
