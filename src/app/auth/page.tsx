"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, QrCode } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeRedirect } from "@/lib/safe-redirect";
import { QrScannerView } from "@/components/bill/qr-scanner-view";
import { parseClaimQrCode } from "@/lib/claim-qr";
import { isNativePlatform, openOAuthInSystemBrowser } from "@/lib/capacitor/auth";

const IS_DEV_LOGIN = process.env.NEXT_PUBLIC_DEV_LOGIN_ENABLED === "true";

type AuthMode = "choose" | "scan";

function AuthPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeRedirect(searchParams.get("next"));
  const supabase = createClient();
  const [mode, setMode] = useState<AuthMode>("choose");
  const [devEmail, setDevEmail] = useState("");
  const [devError, setDevError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleScanDecode = useCallback(
    (data: string) => {
      const claim = parseClaimQrCode(data);
      if (claim) {
        router.push(`/claim/${claim.token}`);
      }
    },
    [router],
  );

  const handleDevLogin = () => {
    if (!devEmail.trim()) return;
    setDevError("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/dev/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: devEmail.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          setDevError(data.error ?? "Erro ao entrar");
          return;
        }
        router.push(data.redirect ?? next);
        router.refresh();
      } catch {
        setDevError("Erro de rede");
      }
    });
  };

  const handleGoogleSignIn = async () => {
    const native = isNativePlatform();
    const callbackParams = new URLSearchParams({ next });
    if (native) callbackParams.set("native", "1");
    const { data } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?${callbackParams}`,
        skipBrowserRedirect: native,
      },
    });
    if (native && data?.url) {
      await openOAuthInSystemBrowser(data.url);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="gradient-mesh absolute inset-0 -z-10" />

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Logo size="lg" animated />
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="mt-4 text-center text-muted-foreground"
        >
          Racha a conta com a galera via Pix
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-12 w-full"
        >
          <div className="rounded-2xl border bg-card p-8 shadow-sm">
            <AnimatePresence mode="wait">
              {mode === "choose" && (
                <motion.div
                  key="choose"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <h1 className="text-center text-xl font-semibold">Entrar</h1>
                  <p className="mt-1 text-center text-sm text-muted-foreground">
                    Como quer entrar?
                  </p>

                  <div className="mt-8 space-y-3">
                    {IS_DEV_LOGIN && (
                      <>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleDevLogin();
                          }}
                          className="space-y-2"
                        >
                          <Input
                            type="email"
                            placeholder="Email (dev login)"
                            value={devEmail}
                            onChange={(e) => setDevEmail(e.target.value)}
                            className="h-11 rounded-xl"
                          />
                          <Button
                            type="submit"
                            disabled={isPending || !devEmail.trim()}
                            className="h-11 w-full rounded-xl"
                          >
                            {isPending ? "Entrando..." : "Entrar com email"}
                          </Button>
                          {devError && (
                            <p className="text-center text-sm text-destructive">
                              {devError}
                            </p>
                          )}
                        </form>
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1 bg-border" />
                          <span className="text-xs text-muted-foreground">ou</span>
                          <div className="h-px flex-1 bg-border" />
                        </div>
                      </>
                    )}
                    <Button
                      onClick={handleGoogleSignIn}
                      className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-border bg-white text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:bg-white dark:text-gray-700 dark:hover:bg-gray-50"
                      variant="outline"
                    >
                      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                        <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18Z" />
                        <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.02c-.72.48-1.63.77-2.7.77-2.08 0-3.84-1.4-4.47-3.29H1.84v2.08A8 8 0 0 0 8.98 17Z" />
                        <path fill="#FBBC05" d="M4.51 10.52A4.78 4.78 0 0 1 4.26 9c0-.53.09-1.04.25-1.52V5.4H1.84A8 8 0 0 0 .98 9c0 1.29.31 2.51.86 3.6l2.67-2.08Z" />
                        <path fill="#EA4335" d="M8.98 3.58c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 .98 9l2.87 2.23C4.14 4.99 6.5 3.58 8.98 3.58Z" />
                      </svg>
                      Entrar com Google
                    </Button>

                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-xs text-muted-foreground">ou</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>

                    <button
                      type="button"
                      onClick={() => setMode("scan")}
                      className="flex w-full items-center justify-center gap-2 text-sm text-primary hover:underline"
                    >
                      <QrCode className="h-4 w-4" />
                      Ler um convite
                    </button>
                  </div>
                </motion.div>
              )}

              {mode === "scan" && (
                <motion.div
                  key="scan"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <button
                    onClick={() => setMode("choose")}
                    className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Voltar
                  </button>

                  <h1 className="text-xl font-semibold">Ler convite</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Aponte para o QR code do convite.
                  </p>

                  <div className="mt-6">
                    <QrScannerView onDecode={handleScanDecode} />
                    <p className="mt-3 text-center text-xs text-muted-foreground">
                      Posicione o QR code do convite dentro do quadrado
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {mode === "choose" && (
              <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
                Em conformidade com a LGPD (Lei 13.709/2018). Seus dados são
                protegidos e nunca compartilhados sem consentimento. Você pode
                excluir sua conta a qualquer momento.
              </p>
            )}
          </div>
        </motion.div>

        <div className="mt-6 flex justify-center gap-2">
          {(["choose", "scan"] as AuthMode[]).map((s) => (
            <motion.div
              key={s}
              animate={{
                width: s === mode ? 24 : 8,
                backgroundColor:
                  s === mode
                    ? "oklch(0.78 0.16 75)"
                    : "oklch(0.91 0.005 250)",
              }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="h-2 rounded-full"
            />
          ))}
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
