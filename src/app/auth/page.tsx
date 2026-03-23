"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  CreditCard,
  KeyRound,
  Phone,
  Shield,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PixKeyType } from "@/types";

type AuthStep = "phone" | "otp" | "pix" | "name";

export default function AuthPage() {
  const router = useRouter();
  const [step, setStep] = useState<AuthStep>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [name, setName] = useState("");
  const [pixKeyType, setPixKeyType] = useState<PixKeyType>("phone");
  const [customPixKey, setCustomPixKey] = useState("");
  const [usePhoneAsPix, setUsePhoneAsPix] = useState(true);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const handlePhoneSubmit = () => {
    if (phone.replace(/\D/g, "").length >= 10) {
      setStep("otp");
    }
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
      setTimeout(() => setStep("name"), 500);
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleNameSubmit = () => {
    if (name.trim()) {
      setStep("pix");
    }
  };

  const handleFinish = () => {
    router.push("/app");
  };

  const pixKeyOptions: { type: PixKeyType; label: string; icon: React.ElementType }[] = [
    { type: "phone", label: "Telefone", icon: Phone },
    { type: "cpf", label: "CPF", icon: CreditCard },
    { type: "email", label: "E-mail", icon: KeyRound },
    { type: "random", label: "Chave aleatoria", icon: KeyRound },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="gradient-mesh absolute inset-0 -z-10" />

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Logo size="md" />
        </motion.div>

        <div className="mt-12 flex-1">
          <AnimatePresence mode="wait">
            {step === "phone" && (
              <motion.div
                key="phone"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <h1 className="text-2xl font-bold">Entrar</h1>
                <p className="mt-2 text-muted-foreground">
                  Informe seu celular para receber o codigo de verificacao.
                </p>

                <div className="mt-8">
                  <label className="mb-2 block text-sm font-medium">
                    Numero de celular
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
                      onKeyDown={(e) => e.key === "Enter" && handlePhoneSubmit()}
                    />
                  </div>
                </div>

                <Button
                  className="mt-6 w-full gap-2"
                  size="lg"
                  onClick={handlePhoneSubmit}
                  disabled={phone.replace(/\D/g, "").length < 10}
                >
                  Enviar codigo
                  <ArrowRight className="h-4 w-4" />
                </Button>

                <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#25D366]">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18c-1.66 0-3.203-.51-4.484-1.375l-.32-.195-2.871.852.852-2.871-.195-.32A7.963 7.963 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z" />
                  </svg>
                  <span>Enviaremos um codigo de 6 digitos via WhatsApp.</span>
                </div>
              </motion.div>
            )}

            {step === "otp" && (
              <motion.div
                key="otp"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <h1 className="text-2xl font-bold">Verificacao</h1>
                <p className="mt-2 text-muted-foreground">
                  Digite o codigo enviado para{" "}
                  <span className="font-medium text-foreground">
                    +55 {phone}
                  </span>
                </p>

                <div className="mt-8 flex justify-center gap-2.5">
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
                      />
                    </motion.div>
                  ))}
                </div>

                <p className="mt-6 text-center text-sm text-muted-foreground">
                  Nao recebeu?{" "}
                  <button className="font-medium text-primary">
                    Reenviar codigo
                  </button>
                </p>
              </motion.div>
            )}

            {step === "name" && (
              <motion.div
                key="name"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-success/15 text-success">
                  <Check className="h-7 w-7" />
                </div>
                <h1 className="mt-4 text-2xl font-bold">Verificado!</h1>
                <p className="mt-2 text-muted-foreground">
                  Como podemos te chamar?
                </p>

                <div className="mt-8">
                  <label className="mb-2 block text-sm font-medium">
                    Seu nome
                  </label>
                  <Input
                    placeholder="Pedro Reis"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
                  />
                </div>

                <Button
                  className="mt-6 w-full gap-2"
                  size="lg"
                  onClick={handleNameSubmit}
                  disabled={!name.trim()}
                >
                  Continuar
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </motion.div>
            )}

            {step === "pix" && (
              <motion.div
                key="pix"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <h1 className="text-2xl font-bold">Chave Pix</h1>
                <p className="mt-2 text-muted-foreground">
                  Informe sua chave Pix para receber pagamentos dos amigos.
                </p>

                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="mt-6 rounded-2xl border bg-card p-4"
                >
                  <button
                    onClick={() => setUsePhoneAsPix(true)}
                    className={`flex w-full items-center gap-3 rounded-xl p-3 transition-colors ${
                      usePhoneAsPix
                        ? "bg-primary/10 ring-2 ring-primary/30"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <Phone className="h-5 w-5 text-primary" />
                    <div className="text-left">
                      <p className="text-sm font-medium">Usar meu telefone</p>
                      <p className="text-xs text-muted-foreground">
                        +55 {phone}
                      </p>
                    </div>
                    {usePhoneAsPix && (
                      <Check className="ml-auto h-5 w-5 text-primary" />
                    )}
                  </button>

                  <button
                    onClick={() => setUsePhoneAsPix(false)}
                    className={`mt-2 flex w-full items-center gap-3 rounded-xl p-3 transition-colors ${
                      !usePhoneAsPix
                        ? "bg-primary/10 ring-2 ring-primary/30"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <KeyRound className="h-5 w-5 text-muted-foreground" />
                    <p className="text-left text-sm font-medium">
                      Usar outra chave
                    </p>
                  </button>

                  <AnimatePresence>
                    {!usePhoneAsPix && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-3 overflow-hidden"
                      >
                        <div className="flex flex-wrap gap-2">
                          {pixKeyOptions
                            .filter((o) => o.type !== "phone")
                            .map((opt) => (
                              <button
                                key={opt.type}
                                onClick={() => setPixKeyType(opt.type)}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                  pixKeyType === opt.type
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                        </div>
                        <Input
                          className="mt-3"
                          placeholder={
                            pixKeyType === "cpf"
                              ? "000.000.000-00"
                              : pixKeyType === "email"
                                ? "seu@email.com"
                                : "Chave aleatoria"
                          }
                          value={customPixKey}
                          onChange={(e) => setCustomPixKey(e.target.value)}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>

                <div className="mt-4 space-y-2">
                  <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3">
                    <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <p className="text-xs text-muted-foreground">
                      Sua chave Pix e usada exclusivamente para gerar QR codes de
                      cobranca. Seus dados sao criptografados e nunca compartilhados
                      com terceiros.
                    </p>
                  </div>
                  <p className="text-center text-[10px] text-muted-foreground">
                    Em conformidade com a LGPD (Lei 13.709/2018).
                    Voce pode excluir seus dados a qualquer momento.
                  </p>
                </div>

                <Button
                  className="mt-6 w-full gap-2"
                  size="lg"
                  onClick={handleFinish}
                >
                  Comecar a usar
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-8 flex justify-center gap-2">
          {(["phone", "otp", "name", "pix"] as AuthStep[]).map((s) => (
            <motion.div
              key={s}
              animate={{
                width: s === step ? 24 : 8,
                backgroundColor:
                  s === step
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
