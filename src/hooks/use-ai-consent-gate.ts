"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiConsentDialogProps,
  AiConsentDialogState,
} from "@/components/ai/ai-consent-dialog";
import { useAppStore } from "@/stores/app-store";
import { canUseAi, grantAiConsent } from "@/lib/sync/ai-consent";
import { runBootstrap } from "@/lib/sync/bootstrap";
import { getAuthGeneration } from "@/lib/sync/client";

export interface UseAiConsentGate {
  requestConsent: () => boolean;
  dialogProps: AiConsentDialogProps;
}

const VERIFICATION_ERROR =
  "Não foi possível verificar sua permissão de IA. Tente novamente.";
const SAVE_ERROR =
  "Não foi possível salvar sua permissão. Tente novamente.";

interface DialogIdentity {
  accountId: string | null;
  authGeneration: number;
}

function deriveDialogState(): AiConsentDialogState {
  const s = useAppStore.getState();
  // Only the first bootstrap of this generation gates the dialog: a later
  // background refresh or a failed refresh never downgrades the prompt back
  // to "verificando" for someone whose account is already committed.
  if (s.lastBootstrappedGeneration !== getAuthGeneration()) {
    if (s.bootstrapStatus === "error") {
      return { status: "error", operation: "bootstrap", message: VERIFICATION_ERROR };
    }
    return { status: "loading", operation: "bootstrap" };
  }
  if (s.me === null) {
    return { status: "empty" };
  }
  return { status: "idle" };
}

/**
 * Owns the AI consent dialog for one feature entry point. `requestConsent`
 * is synchronous: it returns true when the current account may already use
 * AI, and otherwise opens the dialog and returns false. Saving consent never
 * replays the action that asked; the user taps the feature again.
 */
export function useAiConsentGate(onDecline: () => void): UseAiConsentGate {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AiConsentDialogState>({ status: "idle" });

  const openRef = useRef(false);
  const stateRef = useRef<AiConsentDialogState>({ status: "idle" });
  const identityRef = useRef<DialogIdentity | null>(null);
  const savingRef = useRef(false);
  const onDeclineRef = useRef(onDecline);
  useEffect(() => {
    onDeclineRef.current = onDecline;
  }, [onDecline]);

  const close = useCallback(() => {
    openRef.current = false;
    identityRef.current = null;
    savingRef.current = false;
    setOpen(false);
    setState({ status: "idle" });
    stateRef.current = { status: "idle" };
  }, []);

  const publish = useCallback((next: AiConsentDialogState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const handleAccept = useCallback(() => {
    if (savingRef.current) return;
    const identity = identityRef.current;
    if (identity === null || identity.accountId === null) return;
    savingRef.current = true;
    publish({ status: "loading", operation: "grant" });
    grantAiConsent()
      .then(() => {
        // A session or account switch while saving closes the dialog; a late
        // success must not render for whoever is signed in now.
        if (!openRef.current || identityRef.current !== identity) return;
        publish({ status: "success" });
      })
      .catch(() => {
        if (!openRef.current || identityRef.current !== identity) return;
        publish({ status: "error", operation: "grant", message: SAVE_ERROR });
      })
      .finally(() => {
        savingRef.current = false;
      });
  }, [publish]);

  const handleRetry = useCallback(() => {
    const current = stateRef.current;
    if (current.status === "error" && current.operation === "bootstrap") {
      void runBootstrap().catch(() => undefined);
      return;
    }
    handleAccept();
  }, [handleAccept]);

  const handleDecline = useCallback(() => {
    if (savingRef.current) return;
    close();
    onDeclineRef.current();
  }, [close]);

  const requestConsent = useCallback((): boolean => {
    if (canUseAi()) return true;
    const s = useAppStore.getState();
    identityRef.current = {
      accountId: s.me?.id ?? null,
      authGeneration: getAuthGeneration(),
    };
    const next = deriveDialogState();
    openRef.current = true;
    setOpen(true);
    publish(next);
    return false;
  }, [publish]);

  // The dialog follows the account: a sign-out or account switch closes it
  // and ignores any late save, and bootstrap transitions update its state.
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe(() => {
      if (!openRef.current) return;
      const identity = identityRef.current;
      const s = useAppStore.getState();
      if (
        identity === null ||
        s.me?.id !== identity.accountId ||
        getAuthGeneration() !== identity.authGeneration
      ) {
        close();
        return;
      }
      if (savingRef.current) return;
      if (stateRef.current.status === "success") return;
      if (stateRef.current.status === "empty") return;
      const next = deriveDialogState();
      if (next.status === "idle" && canUseAi()) {
        close();
        return;
      }
      if (next.status !== stateRef.current.status) publish(next);
    });
    return unsubscribe;
  }, [close, publish]);

  const dialogProps: AiConsentDialogProps = {
    open,
    state,
    onAccept: handleAccept,
    onDecline: handleDecline,
    onRetry: handleRetry,
    onClose: close,
  };

  return { requestConsent, dialogProps };
}
