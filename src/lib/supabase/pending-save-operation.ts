/**
 * Durable save-operation registry for crash/restart recovery (#477 Slice 5).
 *
 * Before each save_expense_draft_graph call, the wizard writes the operation
 * ID + group ID to localStorage. After a successful response (or confirmed
 * error), the entry is cleared. On wizard mount, any unconfirmed entry is
 * resolved via resolveExpenseGraphSaveResult to recover the expense ID
 * without a duplicate save.
 *
 * The registry stores NO financial data — only the operation UUID, group
 * UUID, and a timestamp for staleness detection.
 */

const STORAGE_KEY = "dividimos:pending_save_operation";

export interface PendingSaveOperation {
  readonly operationId: string;
  readonly groupId: string;
  readonly timestamp: number;
}

/**
 * Persist a pending save operation before the RPC call.
 * Overwrites any previous entry (only one pending save per tab).
 */
export function setPendingSaveOperation(
  operationId: string,
  groupId: string,
): void {
  if (typeof window === "undefined") return;
  const entry: PendingSaveOperation = {
    operationId,
    groupId,
    timestamp: Date.now(),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage may be unavailable (private mode, quota). The save
    // still works; we just lose crash-recovery for this entry.
  }
}

/**
 * Clear the pending entry after a confirmed save response (success or error).
 */
export function clearPendingSaveOperation(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — nothing to recover.
  }
}

/**
 * Clear the pending entry only if it still names the given operation ID.
 * Mount-time resolution runs asynchronously; if the user starts a new
 * durable save (which overwrites the stored entry) before an in-flight
 * resolution's promise settles, an unconditional clear would delete the
 * NEW save's recovery record instead of the resolved one. Compare first.
 */
export function clearPendingSaveOperationIfMatches(operationId: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const entry = JSON.parse(raw) as PendingSaveOperation;
    if (entry.operationId === operationId) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore — nothing to recover.
  }
}

/**
 * Read the pending entry on wizard mount, WITHOUT clearing it. The caller
 * must clear it explicitly only after a resolution call returns a
 * determinate terminal outcome (committed/retired) -- clearing eagerly on
 * read would destroy the only durable record of an in-flight save before
 * its outcome is confirmed, so a second crash/reload during resolution
 * itself (network drop, tab closed again) permanently loses recovery for
 * that save and risks a duplicate on the next save attempt. This is the
 * exact "survive... response loss" guarantee the registry exists for.
 *
 * Returns null if there is no pending entry, or if the entry is older than
 * 5 minutes (stale entries ARE cleared here -- they belong to a previous
 * session and are never going to be resolved).
 */
export function peekPendingSaveOperation(): PendingSaveOperation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const entry = JSON.parse(raw) as PendingSaveOperation;
    if (
      typeof entry.operationId !== "string" ||
      typeof entry.groupId !== "string" ||
      typeof entry.timestamp !== "number"
    ) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    // Discard entries older than 5 minutes — the server operation ledger
    // is the source of truth, and a very old pending entry likely belongs
    // to a previous session.
    const STALE_MS = 5 * 60 * 1000;
    if (Date.now() - entry.timestamp > STALE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return entry;
  } catch {
    return null;
  }
}
