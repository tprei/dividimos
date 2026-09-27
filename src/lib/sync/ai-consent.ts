import { CURRENT_AI_CONSENT_VERSION, hasCurrentAiConsent } from "@/lib/ai-consent";
import { decodeMe } from "@/lib/ledger/decode";
import type { Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import { getAuthGeneration, rpc } from "./client";
import { LedgerError } from "./errors";

/**
 * A consent attempt is the token an AI feature captures before doing any
 * work. It pairs the account with the auth generation and the consent
 * revision observed at capture time; any change to any of the three
 * invalidates work that is still in flight.
 */
export interface AiConsentAttempt {
  accountId: string;
  authGeneration: number;
  consentRevision: number;
}

export function canUseAi(): boolean {
  const s = useAppStore.getState();
  // A background refresh (loading) or a failed one must not lock a consented
  // user out: permission turns on this generation having committed a
  // bootstrap for the account, not on the current read status.
  return s.me !== null
    && s.lastBootstrappedAccountId === s.me.id
    && s.lastBootstrappedGeneration === getAuthGeneration()
    && !s.aiConsentMutationPending
    && hasCurrentAiConsent(s.me);
}

export function captureAiConsentAttempt(): AiConsentAttempt {
  const s = useAppStore.getState();
  if (!s.me) throw new LedgerError("unauthenticated");
  if (!canUseAi()) throw new LedgerError("ai_consent_required");
  return {
    accountId: s.me.id,
    authGeneration: getAuthGeneration(),
    consentRevision: s.aiConsentRevision,
  };
}

export function isAiConsentAttemptCurrent(attempt: AiConsentAttempt): boolean {
  const s = useAppStore.getState();
  return getAuthGeneration() === attempt.authGeneration
    && s.me?.id === attempt.accountId
    && s.aiConsentRevision === attempt.consentRevision
    && !s.aiConsentMutationPending
    && hasCurrentAiConsent(s.me);
}

export function assertAiConsentAttempt(attempt: AiConsentAttempt): void {
  if (!isAiConsentAttemptCurrent(attempt)) {
    throw new DOMException("AI attempt invalidated", "AbortError");
  }
}

export function invalidateAiConsent(attempt: AiConsentAttempt): void {
  if (!isAiConsentAttemptCurrent(attempt)) return;
  useAppStore.getState().patch((s) => s.me ? {
    me: { ...s.me, aiConsentVersion: null, aiConsentGrantedAt: null },
    aiConsentRevision: s.aiConsentRevision + 1,
  } : {});
}

export async function grantAiConsent(): Promise<void> {
  await mutateAiConsent((me) =>
    rpc(
      "set_ai_consent",
      { p_expected_user_id: me.id, p_version: CURRENT_AI_CONSENT_VERSION },
      decodeMe,
    ));
}

export async function revokeAiConsent(): Promise<void> {
  await mutateAiConsent((me) =>
    rpc("revoke_ai_consent", { p_expected_user_id: me.id }, decodeMe));
}

async function mutateAiConsent(
  run: (me: Me) => Promise<Me>,
): Promise<void> {
  const state = useAppStore.getState();
  if (!state.me) throw new LedgerError("unauthenticated");
  if (
    state.lastBootstrappedAccountId !== state.me.id ||
    state.lastBootstrappedGeneration !== getAuthGeneration()
  ) {
    throw new LedgerError("network");
  }
  if (state.aiConsentMutationPending) throw new LedgerError("invalid_argument");
  const me = state.me;
  const generation = getAuthGeneration();
  const accountId = me.id;

  useAppStore.getState().patch((s) => ({
    aiConsentMutationPending: true,
    aiConsentRevision: s.aiConsentRevision + 1,
  }));

  try {
    const result = await run(me);
    if (getAuthGeneration() !== generation) {
      throw new DOMException("AI consent mutation invalidated", "AbortError");
    }
    if (result.id !== accountId) throw new LedgerError("invalid_wire");
    const current = useAppStore.getState();
    if (!current.me || current.me.id !== accountId) {
      throw new DOMException("AI consent mutation invalidated", "AbortError");
    }
    useAppStore.getState().patch((s) =>
      s.me && s.me.id === accountId
        ? {
            me: {
              ...s.me,
              aiConsentVersion: result.aiConsentVersion,
              aiConsentGrantedAt: result.aiConsentGrantedAt,
            },
            aiConsentRevision: s.aiConsentRevision + 1,
            aiConsentMutationPending: false,
          }
        : {},
    );
  } finally {
    // Only the mutation's own epoch clears the pending flag: a replacement
    // account inherits a clean store, never a stale in-flight marker.
    if (getAuthGeneration() === generation) {
      useAppStore.getState().patch((s) =>
        s.me && s.me.id === accountId
          ? { aiConsentMutationPending: false }
          : {},
      );
    }
  }
}
