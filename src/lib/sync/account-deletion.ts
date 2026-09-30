import type { AccountDeletionResponse } from "@/lib/account-deletion";
import { decodeAccountDeletionResponse } from "@/lib/account-deletion";
import { clearAllClaimTokens } from "@/lib/claim-token-cache";
import { clearDraftIntent } from "@/lib/draft-intent";
import { removeAccountDraft } from "@/lib/bill-draft-isolation";
import { removeConfirmationPreferences } from "@/lib/confirmation-preferences";
import { removeNativePushConsent } from "@/lib/push/native-consent";
import { revokeAiConsent } from "@/lib/ai-consent";
import { removeOnboardingTour } from "@/hooks/use-onboarding-tour";
import { useAppStore } from "@/stores/app-store";
import {
  clearAccountDeletionMarker,
  completeAccountDeletionSignOut,
} from "./auth";
import { getSupabase } from "./client";

export class AccountLocalWipeError extends Error {
  readonly causes: unknown[];

  constructor(causes: unknown[]) {
    super("local wipe failed");
    this.name = "AccountLocalWipeError";
    this.causes = causes;
  }
}

async function postDeletion(): Promise<AccountDeletionResponse | null> {
  const response = await fetch("/api/account/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: "EXCLUIR" }),
  });
  const raw: unknown = await response.json();
  return decodeAccountDeletionResponse(raw);
}

async function currentSessionUserId(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

async function finishSuccessfulDeletion(userId: string): Promise<void> {
  const wipeErrors: unknown[] = [];

  const signOut = await completeAccountDeletionSignOut(userId);
  if (!signOut.ok) wipeErrors.push(signOut.error);

  for (const removeKey of [
    removeAccountDraft,
    removeConfirmationPreferences,
    removeOnboardingTour,
    revokeAiConsent,
  ]) {
    try {
      removeKey(userId);
    } catch (error) {
      wipeErrors.push(error);
    }
  }
  try {
    removeNativePushConsent(userId);
  } catch (error) {
    wipeErrors.push(error);
  }
  try {
    clearDraftIntent();
    clearAllClaimTokens();
  } catch (error) {
    wipeErrors.push(error);
  }
  try {
    await useAppStore.persist.clearStorage();
  } catch (error) {
    wipeErrors.push(error);
  }

  clearAccountDeletionMarker();

  if (wipeErrors.length > 0) {
    throw new AccountLocalWipeError(wipeErrors);
  }
}

export async function deleteAccount(): Promise<AccountDeletionResponse> {
  const decoded = await postDeletion();
  if (!decoded) return { ok: false, code: "deletion_failed", retryable: true };
  if (decoded.ok) {
    const sessionUserId = await currentSessionUserId();
    if (sessionUserId !== decoded.userId) {
      return { ok: false, code: "deletion_failed", retryable: true };
    }
    await finishSuccessfulDeletion(decoded.userId);
  }
  return decoded;
}
