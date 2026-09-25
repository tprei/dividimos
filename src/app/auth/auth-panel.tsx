"use client";

import { AlertCircle, ArrowLeft, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { QrScannerView } from "@/components/bill/qr-scanner-view";
import { Button } from "@/components/ui/button";
import { haptics } from "@/hooks/use-haptics";
import { parseAssignmentRoomQrCode } from "@/lib/assignment-room-qr";
import {
  googleSignIn,
  isNativePlatform,
  prepareGoogleSignIn,
  startGoogleRedirect,
} from "@/lib/capacitor/auth";
import { parseClaimQrCode } from "@/lib/claim-qr";
import { parseJoinQrCode } from "@/lib/join-qr";
import { safeRedirect } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type AuthMode = "choose" | "scan";
type FocusTarget = "back" | "invite";

const LINK_BUTTON_CLASS =
  "h-auto min-h-11 gap-2 rounded-md px-2 text-[15px] font-bold text-obj-primary-ink underline-offset-3";

function GoogleMark() {
  return (
    <svg className="size-[18px]" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18Z" />
      <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.02c-.72.48-1.63.77-2.7.77-2.08 0-3.84-1.4-4.47-3.29H1.84v2.08A8 8 0 0 0 8.98 17Z" />
      <path fill="#FBBC05" d="M4.51 10.52A4.78 4.78 0 0 1 4.26 9c0-.53.09-1.04.25-1.52V5.4H1.84A8 8 0 0 0 .98 9c0 1.29.31 2.51.86 3.6l2.67-2.08Z" />
      <path fill="#EA4335" d="M8.98 3.58c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 .98 9l2.87 2.23C4.14 4.99 6.5 3.58 8.98 3.58Z" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="size-[18px] animate-[spin_0.8s_linear_infinite]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="var(--obj-border)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--obj-google-ink)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function InviteQrIcon() {
  return (
    <svg
      className="size-[17px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M17.5 17.5H21V21h-3.5z" />
    </svg>
  );
}

interface AuthPanelProps {
  className?: string;
}

export function AuthPanel({ className }: AuthPanelProps) {
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
  const googleRef = useRef<HTMLButtonElement>(null);
  const inviteRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  useEffect(() => {
    void prepareGoogleSignIn();
  }, []);

  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === "back") backRef.current?.focus({ preventScroll: true });
    if (target === "invite") inviteRef.current?.focus({ preventScroll: true });
  }, [mode]);

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

  const handleDismissError = () => {
    setDismissedError(true);
    setSignInError(null);
    googleRef.current?.focus({ preventScroll: true });
    const params = new URLSearchParams(searchParams.toString());
    params.delete("error");
    router.replace(params.toString() ? `/auth?${params.toString()}` : "/auth");
  };

  const openScanner = () => {
    pendingFocus.current = "back";
    setMode("scan");
  };

  const closeScanner = () => {
    pendingFocus.current = "invite";
    setMode("choose");
  };

  const showError = (error === "callback_failed" && !dismissedError) || signInError !== null;

  return (
    <div
      className={cn(
        "intro-object mt-4.5 w-full max-w-85 flex-none rounded-2xl border border-obj-border bg-obj-card px-5.5 pt-6 pb-5 text-obj-ink shadow-[0_6px_0_var(--obj-shadow)]",
        "intro-short:mt-3 intro-short:px-5 intro-short:pt-5 intro-short:pb-4 intro-landscape:mt-0",
        className,
      )}
    >
      {mode === "choose" && (
        <div>
          <h1 className="text-center text-[22px] font-black tracking-[-0.02em]">Bora dividir?</h1>
          <div className="mt-4.5 flex flex-col gap-2.5">
            {showError && (
              <div
                role="alert"
                className="intro-fade-up flex items-start gap-2.5 rounded-xl border border-destructive/24 bg-obj-danger-bg py-3 pr-1.5 pl-[13px]"
              >
                <AlertCircle
                  className="mt-0.5 size-[17px] flex-none text-obj-danger-ink"
                  strokeWidth={2.2}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-[1.35] font-extrabold text-obj-danger-ink">
                    {signInError ?? "Não conseguimos concluir a entrada com o Google."}
                  </p>
                  <p className="mt-[3px] text-[12.5px] leading-[1.45] text-obj-ink-soft">
                    Toque em &quot;Entrar com Google&quot; para tentar de novo.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Dispensar aviso"
                  onClick={handleDismissError}
                  className="-my-2.5 -ml-1 rounded-md text-obj-danger-ink hover:bg-destructive/14 hover:text-obj-danger-ink dark:hover:bg-destructive/14"
                >
                  <X strokeWidth={2.4} aria-hidden="true" />
                </Button>
              </div>
            )}

            <Button
              ref={googleRef}
              data-google-sign-in=""
              variant="ghost"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading}
              aria-busy={isGoogleLoading}
              className="h-12 w-full gap-3 rounded-xl border-obj-border bg-obj-card text-[15px] font-bold text-obj-google-ink shadow-[0_3px_0_var(--obj-edge)] hover:bg-obj-muted hover:text-obj-google-ink active:translate-y-px active:shadow-[0_2px_0_var(--obj-edge)] disabled:opacity-100 motion-safe:active:scale-100 dark:hover:bg-obj-muted"
            >
              {isGoogleLoading ? <Spinner /> : <GoogleMark />}
              {isGoogleLoading ? "Entrando..." : "Entrar com Google"}
            </Button>

            <div className="flex items-center gap-3 text-[12.5px] text-obj-ink-soft before:h-px before:flex-1 before:bg-obj-border after:h-px after:flex-1 after:bg-obj-border">
              ou
            </div>

            <Button ref={inviteRef} variant="link" onClick={openScanner} className={LINK_BUTTON_CLASS}>
              <InviteQrIcon />
              Ler um convite
            </Button>
          </div>
          <p className="mt-3.5 text-center text-[11px] leading-[1.55] text-obj-ink-soft select-text intro-tiny:mt-2.5">
            Em conformidade com a LGPD (Lei 13.709/2018). Seus dados são protegidos e nunca
            compartilhados sem consentimento. Você pode excluir sua conta a qualquer momento.
          </p>
        </div>
      )}

      {mode === "scan" && (
        <div className="intro-fade-up [animation-duration:300ms]">
          <Button
            ref={backRef}
            variant="link"
            onClick={closeScanner}
            className={cn(
              LINK_BUTTON_CLASS,
              "-mt-2 -ml-1.5 mb-1.5 flex justify-start text-obj-ink-soft hover:text-obj-ink hover:no-underline",
            )}
          >
            <ArrowLeft strokeWidth={2.4} aria-hidden="true" />
            Voltar
          </Button>
          <h1 className="text-center text-[22px] font-black tracking-[-0.02em]">Ler convite</h1>
          <p className="mt-0.5 text-center text-[15px] text-obj-ink-soft">
            Aponte para o QR code do convite.
          </p>
          <div className="mt-3.5">
            <QrScannerView onDecode={handleScanDecode} paused={scanPaused} />
          </div>
          <p className="mt-2.5 text-center text-[12.5px] text-obj-ink-soft">
            Posicione o QR code do convite dentro do quadrado
          </p>
        </div>
      )}
    </div>
  );
}
