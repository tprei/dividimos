"use client";

import { useCallback, useState } from "react";
import type { AiConsentDialogProps } from "@/components/ai/ai-consent-dialog";
import { grantAiConsent, hasAiConsent } from "@/lib/ai-consent";
import { useAppStore } from "@/stores/app-store";

interface PendingConsent {
  accountId: string;
  action: () => void;
  onDecline?: () => void;
  saveFailed: boolean;
}

export function useAiConsentGate(): {
  requestConsent: (action: () => void, onDecline?: () => void) => void;
  dialogProps: AiConsentDialogProps;
} {
  const accountId = useAppStore((s) => s.me?.id ?? null);
  const [pending, setPending] = useState<PendingConsent | null>(null);
  if (pending !== null && pending.accountId !== accountId) setPending(null);
  const open = pending !== null && pending.accountId === accountId;

  const decline = useCallback(() => {
    const current = pending;
    setPending(null);
    current?.onDecline?.();
  }, [pending]);

  const accept = useCallback(() => {
    const current = pending;
    if (!current || current.accountId !== accountId) {
      setPending(null);
      return;
    }
    if (!grantAiConsent(current.accountId)) {
      setPending({ ...current, saveFailed: true });
      return;
    }
    setPending(null);
    current.action();
  }, [pending, accountId]);

  const requestConsent = useCallback(
    (action: () => void, onDecline?: () => void) => {
      if (accountId === null) return;
      if (hasAiConsent(accountId)) {
        action();
        return;
      }
      setPending({ accountId, action, onDecline, saveFailed: false });
    },
    [accountId],
  );

  return {
    requestConsent,
    dialogProps: {
      open,
      error: pending?.saveFailed
        ? "Não deu pra salvar sua escolha neste aparelho. Libere o armazenamento do navegador e tente de novo."
        : null,
      onAccept: accept,
      onDecline: decline,
    },
  };
}
