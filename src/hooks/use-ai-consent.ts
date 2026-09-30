"use client";

import { useCallback, useSyncExternalStore } from "react";
import { hasAiConsent, revokeAiConsent, subscribeAiConsent } from "@/lib/ai-consent";
import { useAppStore } from "@/stores/app-store";

export function useAiConsent(): {
  granted: boolean;
  revoke: () => void;
} {
  const accountId = useAppStore((s) => s.me?.id ?? null);
  const granted = useSyncExternalStore(
    subscribeAiConsent,
    () => hasAiConsent(accountId),
    () => false,
  );
  const revoke = useCallback(() => {
    if (accountId !== null) revokeAiConsent(accountId);
  }, [accountId]);
  return { granted, revoke };
}
