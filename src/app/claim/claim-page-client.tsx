"use client";

import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  LogIn,
  Receipt,
  UserCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/shared/money";
import { CLAIM_TOKEN_RE } from "@/lib/claim-qr";
import { createClient } from "@/lib/supabase/client";
import { claimGuest } from "@/lib/sync/mutations-group";
import { refreshGroup } from "@/lib/sync/refresh";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { previewGuestClaim, type ClaimPreview } from "./claim-preview-actions";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { haptics } from "@/hooks/use-haptics";

const HANDOFF_KEY = "dividimos.claim.handoff";
const HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;


interface ClaimState {
  token: string | null;
  preview: ClaimPreview | null;
}

/** Read the fragment credential, then strip it from the URL unconditionally. */
function consumeHash(): { token: string | null; hadHash: boolean } {
  const rawHash = window.location.hash;
  const fragment = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  history.replaceState(null, "", "/claim");
  return {
    token: CLAIM_TOKEN_RE.test(fragment) ? fragment : null,
    hadHash: rawHash !== "",
  };
}

/**
 * One-shot auth handoff. Reads and deletes the credential stashed before the
 * redirect to /auth. Fail closed on any storage error, wrong version, bad
 * JSON, non-credential token, or expiry.
 */
function consumeHandoff(): string | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(HANDOFF_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: { version?: unknown; token?: unknown; storedAt?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed.version !== 1) return null;
  if (typeof parsed.token !== "string" || !CLAIM_TOKEN_RE.test(parsed.token)) {
    return null;
  }
  if (typeof parsed.storedAt !== "number") return null;
  if (Date.now() - parsed.storedAt > HANDOFF_MAX_AGE_MS) return null;
  return parsed.token;
}

export function ClaimPageClient() {
  const router = useRouter();
  const epochRef = useRef(0);
  const [state, setState] = useState<ClaimState>({ token: null, preview: null });
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [handoffFailed, setHandoffFailed] = useState(false);

  const capture = useCallback((nextToken: string | null) => {
    epochRef.current += 1;
    const capturedEpoch = epochRef.current;
    if (!nextToken) {
      setState({ token: null, preview: { kind: "not_found" } });
      return;
    }
    setState({ token: nextToken, preview: null });
    void (async () => {
      const preview = await previewGuestClaim(nextToken);
      // Commit only if no newer capture superseded this one.
      if (capturedEpoch !== epochRef.current) return;
      setState((prev) =>
        prev.token === nextToken ? { token: nextToken, preview } : prev,
      );
    })();
  }, []);

  useEffect(() => {
    const handleLocation = () => {
      const { token, hadHash } = consumeHash();
      if (token) {
        capture(token);
        return;
      }
      // No valid credential in the fragment. A fragment-less load may be a
      // return from /auth via the one-shot handoff.
      if (!hadHash) {
        capture(consumeHandoff());
        return;
      }
      capture(null);
    };

    handleLocation();
    window.addEventListener("hashchange", handleLocation);
    window.addEventListener("popstate", handleLocation);
    return () => {
      window.removeEventListener("hashchange", handleLocation);
      window.removeEventListener("popstate", handleLocation);
    };
  }, [capture]);

  // Reset transient UI whenever the captured credential changes.
  const [prevToken, setPrevToken] = useState(state.token);
  if (state.token !== prevToken) {
    setPrevToken(state.token);
    setHandoffFailed(false);
    setClaimError(null);
  }

  const handleSignIn = useCallback(() => {
    if (!state.token) return;
    let ok = false;
    try {
      const payload = JSON.stringify({
        version: 1,
        token: state.token,
        storedAt: Date.now(),
      });
      sessionStorage.setItem(HANDOFF_KEY, payload);
      ok = sessionStorage.getItem(HANDOFF_KEY) === payload;
    } catch {
      ok = false;
    }
    if (!ok) {
      setHandoffFailed(true);
      return;
    }
    router.replace("/auth?next=/claim");
  }, [router, state.token]);

  const handleClaim = useCallback(async () => {
    if (state.preview?.kind !== "ready" || !state.token) return;
    const token = state.token;

    const supabase = createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims?.sub) {
      handleSignIn();
      return;
    }

    setClaiming(true);
    setClaimError(null);

    try {
      const ack = await claimGuest(token);
      haptics.success();
      await refreshGroup(ack.groupId);
      setState((prev) => ({ token: null, preview: prev.preview }));
      router.replace(`/app/bill/${ack.expenseId}`);
    } catch (err) {
      haptics.error();
      setClaimError(ledgerErrorMessage(err));
      setClaiming(false);
    }
  }, [handleSignIn, router, state.preview, state.token]);

  const { preview } = state;

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-lg flex-col justify-center px-4 py-6">
      {preview === null ? (
        <div className="flex flex-col items-center text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Carregando convite…
          </p>
        </div>
      ) : preview.kind === "not_found" ? (
        <div className="flex flex-col items-center rounded-2xl border bg-card p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="mt-4 text-lg font-bold">Convite inválido</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            O link do convite é inválido ou expirou.
          </p>
        </div>
      ) : preview.kind === "sign_in_required" ? (
        <div className="flex flex-col items-center rounded-2xl border bg-card p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <LogIn className="h-6 w-6 text-primary-text" />
          </div>
          <h1 className="mt-4 text-lg font-bold">Entre para confirmar</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {handoffFailed
              ? "Não foi possível continuar. Reabra o link do convite."
              : "Você precisa entrar na sua conta para participar desta conta."}
          </p>
          {!handoffFailed && (
            <Button
              className="mt-5 w-full gap-2"
              size="lg"
              onClick={handleSignIn}
            >
              <LogIn className="h-4 w-4" />
              Entrar
            </Button>
          )}
        </div>
      ) : preview.kind === "already_claimed" ? (
        <div className="flex flex-col items-center rounded-2xl border bg-card p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15">
            <CheckCircle2 className="h-6 w-6 text-success" />
          </div>
          <h1 className="mt-4 text-lg font-bold">Convite já utilizado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este convite já foi confirmado.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-primary/25 bg-primary/10 p-5 text-foreground">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Receipt className="h-4 w-4" />
              <p className="text-sm">{preview.expenseTitle}</p>
            </div>
            <div className="mt-2"><Money cents={preview.shareCents} size="hero" /></div>
            <p className="mt-1 text-sm text-muted-foreground">Sua parte na conta</p>
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-card p-5">
            <div className="flex min-w-0 items-center gap-3">
              <GuestAvatar id={preview.guestId} name={preview.displayName} />
              <div className="min-w-0">
                <h1 className="break-words text-xl font-bold">{preview.displayName}</h1>
                <p className="truncate text-sm text-muted-foreground" title={preview.groupName}>{preview.groupName}</p>
              </div>
            </div>
            <p className="mt-4 text-base text-muted-foreground">Essa parte da conta vai ficar no seu perfil.</p>
          </div>

          <div className="mt-5 space-y-3">
            <Button
              className="w-full gap-2"
              size="lg"
              onClick={handleClaim}
              disabled={claiming}
            >
              {claiming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserCheck className="h-4 w-4" />
              )}
              {claiming ? "Confirmando…" : "Confirmar participação"}
            </Button>
            {claimError && (
              <p role="alert" className="text-center text-sm text-destructive-text">{claimError}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
