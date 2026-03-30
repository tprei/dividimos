"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Phone, QrCode } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeRedirect } from "@/lib/safe-redirect";
import { QrScannerView } from "@/components/bill/qr-scanner-view";
import { parseClaimQrCode } from "@/lib/claim-qr";
import { sendTestOtp, verifyPhoneOtp } from "./phone-actions";

type AuthMode = "choose" | "phone" | "otp" | "scan";

const IS_TEST_MODE = process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE === "true";

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function AuthPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeRedirect(searchParams.get("next"));
  const supabase = createClient();
  const [mode, setMode] = useState<AuthMode>("choose");
  const [phone, setPhone] = useState("");
  const [normalizedPhone, setNormalizedPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleScanDecode = useCallback(
    (data: string) => {
      const claim = parseClaimQrCode(data);
      if (claim) {
        router.push(`/claim/${claim.token}`);
      }
    },
    [router],
  );

  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  };

  const handleSendOtp = () => {
    setError("");
    startTransition(async () => {
      const result = await sendTestOtp(phone);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.phone) setNormalizedPhone(result.phone);
      setMode("otp");
    });
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    if (newOtp.every((d) => d !== "")) {
      handleVerifyOtp(newOtp.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyOtp = (code: string) => {
    setError("");
    startTransition(async () => {
      const result = await verifyPhoneOtp(normalizedPhone || phone, code, next);
      if ("error" in result) {
        setError(result.error);
        setOtp(["", "", "", "", "", ""]);
        otpRefs.current[0]?.focus();
        return;
      }
      router.push(result.redirect);
    });
  };

  const phoneDigits = phone.replace(/\D/g, "");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="gradient-mesh absolute inset-0 -z-10" />

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Logo size="lg" />
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="mt-4 text-center text-muted-foreground"
        >
          Divida contas com amigos via Pix
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
                    Escolha como deseja continuar
                  </p>

                  <div className="mt-8 space-y-3">
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

                    <Button
                      onClick={() => setMode("phone")}
                      variant="outline"
                      className="flex h-11 w-full items-center justify-center gap-3 rounded-xl text-sm font-medium"
                    >
                      <Phone className="h-4 w-4" />
                      Entrar com celular
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
                      Clique aqui para ler um convite
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

              {mode === "phone" && (
                <motion.div
                  key="phone"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <button
                    onClick={() => { setMode("choose"); setError(""); }}
                    className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Voltar
                  </button>

                  <h1 className="text-xl font-semibold">Numero de celular</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Informe seu celular para receber o codigo.
                  </p>

                  {IS_TEST_MODE && (
                    <div className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                      Modo teste — qualquer codigo de 6 digitos sera aceito
                    </div>
                  )}

                  <div className="mt-6">
                    <label className="mb-2 block text-sm font-medium">
                      Celular
                    </label>
                    <div className="flex gap-2">
                      <div className="flex h-10 items-center rounded-lg border bg-muted px-3 text-sm font-medium text-muted-foreground">
                        +55
                      </div>
                      <Input
                        type="tel"
                        placeholder="(11) 98765-4321"
                        value={phone}
                        onChange={(e) => setPhone(formatPhone(e.target.value))}
                        autoFocus
                        className="flex-1"
                        onKeyDown={(e) => e.key === "Enter" && phoneDigits.length >= 10 && handleSendOtp()}
                      />
                    </div>
                  </div>

                  {error && (
                    <p className="mt-2 text-xs text-destructive">{error}</p>
                  )}

                  <Button
                    className="mt-6 w-full gap-2"
                    size="lg"
                    onClick={handleSendOtp}
                    disabled={phoneDigits.length < 10 || isPending}
                  >
                    {isPending ? "Enviando..." : "Enviar codigo"}
                    {!isPending && <ArrowRight className="h-4 w-4" />}
                  </Button>
                </motion.div>
              )}

              {mode === "otp" && (
                <motion.div
                  key="otp"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <button
                    onClick={() => { setMode("phone"); setOtp(["", "", "", "", "", ""]); setError(""); }}
                    className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Alterar numero
                  </button>

                  <h1 className="text-xl font-semibold">Verificacao</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Digite o codigo enviado para{" "}
                    <span className="font-medium text-foreground">+55 {phone}</span>
                  </p>

                  {IS_TEST_MODE && (
                    <div className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                      Modo teste — digite qualquer codigo de 6 digitos
                    </div>
                  )}

                  <div className="mt-6 flex justify-center gap-2.5">
                    {otp.map((digit, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                      >
                        <input
                          ref={(el) => { otpRefs.current[idx] = el; }}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          value={digit}
                          onChange={(e) => handleOtpChange(idx, e.target.value)}
                          onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                          className="h-14 w-11 rounded-xl border bg-card text-center text-xl font-bold transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          autoFocus={idx === 0}
                          disabled={isPending}
                        />
                      </motion.div>
                    ))}
                  </div>

                  {error && (
                    <p className="mt-3 text-center text-xs text-destructive">{error}</p>
                  )}

                  {isPending && (
                    <p className="mt-3 text-center text-sm text-muted-foreground">
                      Verificando...
                    </p>
                  )}

                  <p className="mt-6 text-center text-sm text-muted-foreground">
                    Nao recebeu?{" "}
                    <button
                      className="font-medium text-primary"
                      onClick={handleSendOtp}
                      disabled={isPending}
                    >
                      Reenviar codigo
                    </button>
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {mode === "choose" && (
              <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
                Em conformidade com a LGPD (Lei 13.709/2018). Seus dados sao
                protegidos e nunca compartilhados sem consentimento. Voce pode
                excluir sua conta a qualquer momento.
              </p>
            )}
          </div>
        </motion.div>

        <div className="mt-6 flex justify-center gap-2">
          {(["choose", "phone", "otp", "scan"] as AuthMode[]).map((s) => (
            <motion.div
              key={s}
              animate={{
                width: s === mode ? 24 : 8,
                backgroundColor:
                  s === mode
                    ? "oklch(0.55 0.15 175)"
                    : "oklch(0.91 0.005 260)",
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
