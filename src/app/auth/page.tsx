"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowLeft, Loader2, QrCode, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  googleSignIn,
  isNativePlatform,
  prepareGoogleSignIn,
  startGoogleRedirect,
} from "@/lib/capacitor/auth";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { safeRedirect } from "@/lib/safe-redirect";
import { QrScannerView } from "@/components/bill/qr-scanner-view";
import { haptics } from "@/hooks/use-haptics";
import { parseClaimQrCode } from "@/lib/claim-qr";
import { parseAssignmentRoomQrCode } from "@/lib/assignment-room-qr";
import { parseJoinQrCode } from "@/lib/join-qr";
import { popIn } from "@/lib/animations";

type AuthMode = "choose" | "scan";

function AuthPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeRedirect(searchParams.get("next"));
  const supabase = createClient();
  const [mode, setMode] = useState<AuthMode>("choose");
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [scanPaused, setScanPaused] = useState(false);
  const error = searchParams.get("error");
  const [dismissedError, setDismissedError] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    void prepareGoogleSignIn();
  }, []);

  const handleScanDecode = useCallback(
    (data: string) => {
      const room = parseAssignmentRoomQrCode(data);
      if (room) {
        setScanPaused(true);
        router.push(room.url);
        return;
      }

      const claim = parseClaimQrCode(data);
      if (claim) {
        // Stop scanning on a recognized payload: a second decode of the same
        // frame would push the same route twice.
        setScanPaused(true);
        router.push(`/claim#${claim.token}`);
        return;
      }

      const join = parseJoinQrCode(data);
      if (join) {
        setScanPaused(true);
        router.push(join.url);
      }
    },
    [router],
  );

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    setSignInError(null);
    haptics.tap();
    try {
      if (!isNativePlatform()) {
        await startGoogleRedirect(next);
        return;
      }

      const success = await googleSignIn(supabase);
      if (success) {
        // Go through /auth/continue so a first login makes the onboarded
        // decision before any invite or claim mutation runs, and returns
        // to this exact destination afterwards.
        router.replace(`/auth/continue?next=${encodeURIComponent(next)}`);
        router.refresh();
      } else {
        setIsGoogleLoading(false);
        haptics.error();
        setSignInError("Não conseguimos entrar com o Google. Tente de novo.");
      }
    } catch {
      setIsGoogleLoading(false);
      haptics.error();
      setSignInError("Sem conexão com o Google. Tente de novo.");
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-8">
        <Logo size="lg" />
        <p className="mt-4 text-center text-base text-muted-foreground">
          Contas divididas. Amizades em dia.
        </p>
        <div className="mt-6 w-full rounded-2xl border border-border bg-card p-6 shadow-sm">
          <AnimatePresence mode="wait">
            {mode === "choose" ? (
              <motion.div key="choose" variants={popIn} initial="hidden" animate="visible" exit="exit">
                <h1 className="sr-only">Entrar</h1>
                {((error === "callback_failed" && !dismissedError) || signInError) && (
                  <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-destructive-text">
                    <AlertCircle className="size-5 shrink-0" />
                    <p className="flex-1 text-sm">{signInError ?? "Não conseguimos entrar com o Google. Tente de novo."}</p>
                    <Button variant="ghost" size="icon" aria-label="Dispensar aviso" onClick={() => {
                      setDismissedError(true);
                      setSignInError(null);
                      const params = new URLSearchParams(searchParams.toString());
                      params.delete("error");
                      router.replace(params.toString() ? `/auth?${params.toString()}` : "/auth");
                    }}>
                      <X className="size-4" />
                    </Button>
                  </div>
                )}
                <Button onClick={handleGoogleSignIn} disabled={isGoogleLoading} className="min-h-12 w-full gap-3" variant="outline">
                  {isGoogleLoading ? <Loader2 className="size-5 animate-spin" /> : (
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                      <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18Z" />
                      <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.02c-.72.48-1.63.77-2.7.77-2.08 0-3.84-1.4-4.47-3.29H1.84v2.08A8 8 0 0 0 8.98 17Z" />
                      <path fill="#FBBC05" d="M4.51 10.52A4.78 4.78 0 0 1 4.26 9c0-.53.09-1.04.25-1.52V5.4H1.84A8 8 0 0 0 .98 9c0 1.29.31 2.51.86 3.6l2.67-2.08Z" />
                      <path fill="#EA4335" d="M8.98 3.58c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 .98 9l2.87 2.23C4.14 4.99 6.5 3.58 8.98 3.58Z" />
                    </svg>
                  )}
                  {isGoogleLoading ? "Entrando..." : "Entrar com Google"}
                </Button>
                <Button variant="ghost" onClick={() => setMode("scan")} className="mt-3 min-h-11 w-full gap-2 text-primary-text">
                  <QrCode className="size-4" /> Ler um convite
                </Button>
                <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
                  <a href="/terms" className="inline-flex min-h-11 items-center underline underline-offset-4">Termos de uso</a>
                  {" · "}
                  <a href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-4">Privacidade</a>
                </p>
              </motion.div>
            ) : (
              <motion.div key="scan" variants={popIn} initial="hidden" animate="visible" exit="exit">
                <Button variant="ghost" onClick={() => setMode("choose")} className="mb-4 gap-2">
                  <ArrowLeft className="size-4" /> Voltar
                </Button>
                <h1 className="mb-4 text-xl font-bold">Ler convite</h1>
                <QrScannerView onDecode={handleScanDecode} paused={scanPaused} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthPageContent />
    </Suspense>
  );
}
