import type { AccountDeletionResponse } from "@/lib/account-deletion";
import { decodeAccountDeletionResponse } from "@/lib/account-deletion";
import { clearAllClaimTokens } from "@/lib/claim-token-cache";
import { clearDraftIntent } from "@/lib/draft-intent";
import { removeAccountDraft } from "@/lib/bill-draft-isolation";
import { removeConfirmationPreferences } from "@/lib/confirmation-preferences";
import { removeNativePushConsent } from "@/lib/push/native-consent";
import { revokeAiConsent } from "@/lib/ai-consent";
import { removeOnboardingTour } from "@/hooks/use-onboarding-tour";
import { isAppleSignInAvailable, reauthorizeApple } from "@/lib/capacitor/auth";
import { useAppStore } from "@/stores/app-store";
import { registerAppleCredential } from "./apple-credential";
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

// The server refuses to delete an account linked to Apple until it holds a
// token it can revoke; inside the iOS app that token comes from one Apple
// sheet. Elsewhere the refusal reaches the screen, which explains it.
async function postDeletionWithAppleAuthorization(): Promise<AccountDeletionResponse | null> {
  const first = await postDeletion();
  if (first?.ok !== false || first.code !== "apple_reauthorization_required" || !isAppleSignInAvailable()) {
    return first;
  }
  const authorization = await reauthorizeApple();
  if (authorization.status !== "authorized") return first;
  await registerAppleCredential(authorization.authorizationCode);
  return postDeletion();
}

export async function deleteAccount(): Promise<AccountDeletionResponse> {
  const decoded = await postDeletionWithAppleAuthorization();
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
