export type DraftIntent =
  | { kind: "create"; draftKey: string }
  | { kind: "edit"; expenseId: string; expectedVersionNo: number; draftKey: string };

export const DRAFT_INTENT_KEY = "dividimos-wizard-intent";

function isValidDraftIntent(val: unknown): val is DraftIntent {
  if (!val || typeof val !== "object") return false;
  const obj = val as Record<string, unknown>;
  if (typeof obj.draftKey !== "string" || !obj.draftKey) return false;

  if (obj.kind === "create") {
    return true;
  }

  if (obj.kind === "edit") {
    return (
      typeof obj.expenseId === "string" &&
      obj.expenseId.length > 0 &&
      typeof obj.expectedVersionNo === "number" &&
      Number.isInteger(obj.expectedVersionNo) &&
      obj.expectedVersionNo >= 0
    );
  }

  return false;
}

export function readDraftIntent(): DraftIntent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidDraftIntent(parsed)) {
      window.localStorage.removeItem(DRAFT_INTENT_KEY);
      return null;
    }
    return parsed;
  } catch {
    try {
      window.localStorage.removeItem(DRAFT_INTENT_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

export function writeDraftIntent(intent: DraftIntent): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_INTENT_KEY, JSON.stringify(intent));
  } catch {
    // ignore
  }
}

export function clearDraftIntent(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_INTENT_KEY);
  } catch {
    // ignore
  }
}
