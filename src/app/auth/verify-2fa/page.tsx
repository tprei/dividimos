"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";

const IS_TEST_MODE = process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE === "true";
const RESEND_COOLDOWN = 30;

export default function Verify2FAPage() {
  const router = useRouter();
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [cooldown, setCooldown] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const sendCode = useCallback(() => {
    startTransition(async () => {
      await fetch("/api/auth/2fa/send", { method: "POST" });
      startCooldown();
    });
  }, []);

  useEffect(() => {
    sendCode();
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, [sendCode]);

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    if (newOtp.every((d) => d !== "")) {
      handleVerify(newOtp.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = (code: string) => {
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/auth/2fa/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (res.ok) {
        router.push("/app");
        return;
      }

      setError("Código inválido ou expirado");
      setOtp(["", "", "", "", "", ""]);
      otpRefs.current[0]?.focus();
    });
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth");
  };

  const handleResend = () => {
    setError("");
    setOtp(["", "", "", "", "", ""]);
    sendCode();
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
          <Logo size="lg" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-12 w-full"
        >
          <div className="rounded-2xl border bg-card p-8 shadow-sm">
            <h1 className="text-center text-xl font-semibold">
              Verificação em duas etapas
            </h1>
            <p className="mt-1 text-center text-sm text-muted-foreground">
              Digite o código enviado para seu celular
            </p>

            {IS_TEST_MODE && (
              <div className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                Modo teste — digite qualquer código de 6 dígitos
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

            <div className="mt-6 flex flex-col items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResend}
                disabled={isPending || cooldown > 0}
              >
                {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar código"}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={handleSignOut}
              >
                Sair
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
