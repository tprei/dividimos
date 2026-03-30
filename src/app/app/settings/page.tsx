"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Bell, BellOff, CheckCircle2, ShieldCheck, ShieldOff } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { useUser } from "@/contexts/user-context";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const IS_TEST_MODE = process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE === "true";

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("55")) return `+${digits}`;
  return `+55${digits}`;
}

type EnableStep = "idle" | "phone" | "otp" | "success";
type DisableStep = "idle" | "otp" | "success";

export default function SettingsPage() {
  const user = useUser();

  const [enableStep, setEnableStep] = useState<EnableStep>("idle");
  const [disableStep, setDisableStep] = useState<DisableStep>("idle");

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const resetOtp = () => setOtp(["", "", "", "", "", ""]);

  const handleOtpChange = (index: number, value: string, onComplete: (code: string) => void) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    if (newOtp.every((d) => d !== "")) {
      onComplete(newOtp.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleEnableSend = () => {
    setError("");
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < 10) return;

    startTransition(async () => {
      const res = await fetch("/api/auth/2fa/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", phone: normalizePhone(phone) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erro ao enviar codigo");
        return;
      }
      resetOtp();
      setEnableStep("otp");
    });
  };

  const handleEnableVerify = (code: string) => {
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/auth/2fa/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", phone: normalizePhone(phone), code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Codigo incorreto");
        resetOtp();
        otpRefs.current[0]?.focus();
        return;
      }
      setEnableStep("success");
      setTimeout(() => window.location.reload(), 1500);
    });
  };

  const handleDisableInit = () => {
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/auth/2fa/send", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erro ao enviar codigo");
        return;
      }
      resetOtp();
      setDisableStep("otp");
    });
  };

  const handleDisableVerify = (code: string) => {
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/auth/2fa/enroll", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Codigo incorreto");
        resetOtp();
        otpRefs.current[0]?.focus();
        return;
      }
      setDisableStep("success");
      setTimeout(() => window.location.reload(), 1500);
    });
  };

  const { permission, isSubscribed, isLoading: pushLoading, subscribe, unsubscribe } = usePushNotifications();

  const twoFactorEnabled = user?.twoFactorEnabled ?? false;
  const twoFactorPhone = user?.twoFactorPhone;

  const phoneDigits = phone.replace(/\D/g, "");

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-2xl font-bold"
      >
        Configurações
      </motion.h1>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mt-8"
      >
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Verificação em duas etapas
        </h2>

        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${twoFactorEnabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
              {twoFactorEnabled ? (
                <ShieldCheck className="h-5 w-5" />
              ) : (
                <ShieldOff className="h-5 w-5" />
              )}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">
                {twoFactorEnabled ? "2FA ativado" : "2FA desativado"}
              </p>
              {twoFactorEnabled && twoFactorPhone && (
                <p className="text-xs text-muted-foreground">{twoFactorPhone}</p>
              )}
            </div>
          </div>

          <AnimatePresence mode="wait">
            {!twoFactorEnabled && (
              <motion.div
                key="enable-section"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {enableStep === "idle" && (
                  <motion.div
                    key="enable-idle"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="mt-4"
                  >
                    <Button
                      className="w-full"
                      onClick={() => { setError(""); setPhone(""); setEnableStep("phone"); }}
                    >
                      Ativar 2FA
                    </Button>
                  </motion.div>
                )}

                {enableStep === "phone" && (
                  <motion.div
                    key="enable-phone"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.25 }}
                    className="mt-4"
                  >
                    <button
                      onClick={() => { setEnableStep("idle"); setError(""); }}
                      className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Voltar
                    </button>

                    {IS_TEST_MODE && (
                      <div className="mb-4 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                        Modo teste — qualquer código de 6 dígitos será aceito
                      </div>
                    )}

                    <label className="mb-2 block text-sm font-medium">
                      Celular para verificação
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
                        onKeyDown={(e) => e.key === "Enter" && phoneDigits.length >= 10 && handleEnableSend()}
                      />
                    </div>

                    {error && (
                      <p className="mt-2 text-xs text-destructive">{error}</p>
                    )}

                    <Button
                      className="mt-4 w-full"
                      onClick={handleEnableSend}
                      disabled={phoneDigits.length < 10 || isPending}
                    >
                      {isPending ? "Enviando..." : "Ativar 2FA"}
                    </Button>
                  </motion.div>
                )}

                {enableStep === "otp" && (
                  <motion.div
                    key="enable-otp"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.25 }}
                    className="mt-4"
                  >
                    <button
                      onClick={() => { setEnableStep("phone"); resetOtp(); setError(""); }}
                      className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Alterar número
                    </button>

                    <p className="mb-4 text-sm text-muted-foreground">
                      Digite o código enviado para{" "}
                      <span className="font-medium text-foreground">+55 {phone}</span>
                    </p>

                    {IS_TEST_MODE && (
                      <div className="mb-4 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                        Modo teste — qualquer código de 6 dígitos será aceito
                      </div>
                    )}

                    <div className="flex justify-center gap-2.5">
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
                            onChange={(e) => handleOtpChange(idx, e.target.value, handleEnableVerify)}
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

                    <Button
                      className="mt-4 w-full"
                      onClick={() => handleEnableVerify(otp.join(""))}
                      disabled={otp.some((d) => !d) || isPending}
                    >
                      Verificar
                    </Button>
                  </motion.div>
                )}

                {enableStep === "success" && (
                  <motion.div
                    key="enable-success"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-4 flex items-center gap-2 text-sm text-primary"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    2FA ativado com sucesso
                  </motion.div>
                )}
              </motion.div>
            )}

            {twoFactorEnabled && (
              <motion.div
                key="disable-section"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {disableStep === "idle" && (
                  <motion.div
                    key="disable-idle"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="mt-4"
                  >
                    {error && (
                      <p className="mb-3 text-xs text-destructive">{error}</p>
                    )}
                    <Button
                      variant="outline"
                      className="w-full text-destructive hover:text-destructive"
                      onClick={handleDisableInit}
                      disabled={isPending}
                    >
                      {isPending ? "Enviando código..." : "Desativar 2FA"}
                    </Button>
                  </motion.div>
                )}

                {disableStep === "otp" && (
                  <motion.div
                    key="disable-otp"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.25 }}
                    className="mt-4"
                  >
                    <button
                      onClick={() => { setDisableStep("idle"); resetOtp(); setError(""); }}
                      className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Cancelar
                    </button>

                    <p className="mb-4 text-sm text-muted-foreground">
                      Digite o código enviado para o seu celular cadastrado
                    </p>

                    {IS_TEST_MODE && (
                      <div className="mb-4 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                        Modo teste — qualquer código de 6 dígitos será aceito
                      </div>
                    )}

                    <div className="flex justify-center gap-2.5">
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
                            onChange={(e) => handleOtpChange(idx, e.target.value, handleDisableVerify)}
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

                    <Button
                      variant="outline"
                      className="mt-4 w-full text-destructive hover:text-destructive"
                      onClick={() => handleDisableVerify(otp.join(""))}
                      disabled={otp.some((d) => !d) || isPending}
                    >
                      Verificar
                    </Button>
                  </motion.div>
                )}

                {disableStep === "success" && (
                  <motion.div
                    key="disable-success"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    2FA desativado
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {permission !== "unsupported" && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="mt-6"
        >
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Notificações
          </h2>

          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isSubscribed ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                {isSubscribed ? (
                  <Bell className="h-5 w-5" />
                ) : (
                  <BellOff className="h-5 w-5" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {isSubscribed ? "Notificações ativadas" : "Notificações desativadas"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {permission === "denied"
                    ? "Bloqueado pelo navegador — altere nas configurações do site"
                    : isSubscribed
                      ? "Você receberá alertas de contas e pagamentos"
                      : "Receba alertas quando adicionarem contas ou confirmarem pagamentos"}
                </p>
              </div>
            </div>

            <div className="mt-4">
              {permission === "denied" ? (
                <p className="text-xs text-muted-foreground">
                  Para reativar, abra as configurações do navegador e permita notificações para este site.
                </p>
              ) : isSubscribed ? (
                <Button
                  variant="outline"
                  className="w-full text-destructive hover:text-destructive"
                  onClick={unsubscribe}
                  disabled={pushLoading}
                >
                  {pushLoading ? "Desativando..." : "Desativar notificações"}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  onClick={subscribe}
                  disabled={pushLoading}
                >
                  {pushLoading ? "Ativando..." : "Ativar notificações"}
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
