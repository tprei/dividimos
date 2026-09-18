import { getSupabaseStorageNamespace } from "@/lib/supabase/client";

export type ScanDraftChoice = "ask" | "replace" | "keep";

export interface ConfirmationPreferences {
  confirmVoidSettlement: boolean;
  scanDraftChoice: ScanDraftChoice;
}

const DEFAULT_CONFIRMATION_PREFERENCES: ConfirmationPreferences = {
  confirmVoidSettlement: true,
  scanDraftChoice: "ask",
};

const VALID_SCAN_DRAFT_CHOICES: Set<ScanDraftChoice> = new Set(["ask", "replace", "keep"]);

export function isScanDraftChoice(value: string): value is ScanDraftChoice {
  return VALID_SCAN_DRAFT_CHOICES.has(value as ScanDraftChoice);
}

function getStorageKey(userId: string): string {
  return `dividimos-prefs:${getSupabaseStorageNamespace()}:${userId}`;
}

export function readConfirmationPreferences(userId: string): ConfirmationPreferences {
  if (typeof window === "undefined" || !userId) {
    return { ...DEFAULT_CONFIRMATION_PREFERENCES };
  }

  try {
    const key = getStorageKey(userId);
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return { ...DEFAULT_CONFIRMATION_PREFERENCES };
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_CONFIRMATION_PREFERENCES };
    }

    const record = parsed as Record<string, unknown>;

    const confirmVoidSettlement =
      typeof record.confirmVoidSettlement === "boolean"
        ? record.confirmVoidSettlement
        : DEFAULT_CONFIRMATION_PREFERENCES.confirmVoidSettlement;

    const scanDraftChoice =
      typeof record.scanDraftChoice === "string" && isScanDraftChoice(record.scanDraftChoice)
        ? record.scanDraftChoice
        : DEFAULT_CONFIRMATION_PREFERENCES.scanDraftChoice;

    return {
      confirmVoidSettlement,
      scanDraftChoice,
    };
  } catch {
    return { ...DEFAULT_CONFIRMATION_PREFERENCES };
  }
}

export function updateConfirmationPreferences(
  userId: string,
  patch: Partial<ConfirmationPreferences>,
): ConfirmationPreferences {
  const current = readConfirmationPreferences(userId);

  const updated: ConfirmationPreferences = {
    confirmVoidSettlement:
      typeof patch.confirmVoidSettlement === "boolean"
        ? patch.confirmVoidSettlement
        : current.confirmVoidSettlement,
    scanDraftChoice:
      patch.scanDraftChoice !== undefined &&
      VALID_SCAN_DRAFT_CHOICES.has(patch.scanDraftChoice)
        ? patch.scanDraftChoice
        : current.scanDraftChoice,
  };

  if (typeof window !== "undefined" && userId) {
    try {
      const key = getStorageKey(userId);
      window.localStorage.setItem(key, JSON.stringify(updated));
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }

  return updated;
}
