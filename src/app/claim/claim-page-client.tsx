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
import { formatBRL } from "@/lib/currency";
import { CLAIM_TOKEN_RE } from "@/lib/claim-qr";
import { createClient } from "@/lib/supabase/client";
import { previewGuestClaim, type ClaimPreview } from "./claim-preview-actions";

const HANDOFF_KEY = "dividimos.claim.handoff";
const HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;

const CLAIM_ERROR_MESSAGES: Record<string, string> = {
  PST01: "Entre na sua conta para confirmar a participação.",
  PST02: "Convite inválido ou expirado.",
  PST04: "Você já está incluso nesta despesa.",
  PST05: "Convite inválido, expirado ou já utilizado.",
  PST07: "Não foi possível confirmar agora. Tente novamente.",
  PST08: "Este convite não está mais disponível.",
  "22P02": "Convite inválido ou expirado.",
};
const CLAIM_ERROR_GENERIC = "Erro ao confirmar participação. Tente novamente.";

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
  useEffect(() => {
    setHandoffFailed(false);
    setClaimError(null);
  }, [state.token]);

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
    const expenseId = state.preview.expenseId;
    setClaiming(true);
    setClaimError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("claim_guest_spot", {
      p_claim_token: token,
    });
    if (error) {
      setClaimError(
        CLAIM_ERROR_MESSAGES[error.code ?? ""] ?? CLAIM_ERROR_GENERIC,
      );
      setClaiming(false);
      return;
    }
    setState((prev) => ({ token: null, preview: prev.preview }));
    router.push(`/app/bill/${expenseId}`);
  }, [router, state.preview, state.token]);

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
            <LogIn className="h-6 w-6 text-primary" />
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
          <div className="rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
            <div className="flex items-center gap-2 text-white/70">
              <Receipt className="h-4 w-4" />
              <p className="text-sm">{preview.expenseTitle}</p>
            </div>
            <p className="mt-2 text-3xl font-bold tabular-nums">
              {formatBRL(preview.shareAmountCents)}
            </p>
            <p className="mt-1 text-sm text-white/70">Sua parte na conta</p>
          </div>

          <div className="mt-5 rounded-2xl border bg-card p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {preview.creatorName.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-medium">{preview.creatorName}</p>
                <p className="text-xs text-muted-foreground">criou esta conta</p>
              </div>
            </div>
            <div className="mt-4 rounded-xl bg-muted/50 p-3">
              <p className="text-sm">
                <span className="font-medium">{preview.guestName}</span>, você
                foi convidado(a) pra participar desta conta.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ao confirmar, você entra no grupo e sua parte fica registrada.
              </p>
            </div>
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
              Participar
            </Button>
            {claimError && (
              <p className="text-center text-xs text-destructive">{claimError}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
