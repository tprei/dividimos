"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Clipboard, Shield } from "lucide-react";
import { Suspense, useEffect, useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PixKeyType } from "@/types";
import { safeRedirect } from "@/lib/safe-redirect";
import { completeOnboarding } from "./actions";

type OnboardStep = "profile" | "pix";

const HANDLE_REGEX = /^[a-z0-9]([a-z0-9._]{0,18}[a-z0-9])?$/;

function isValidHandle(value: string): boolean {
  if (value.length < 3 || value.length > 20) return false;
  if (value.length === 3) return /^[a-z0-9][a-z0-9._][a-z0-9]$/.test(value);
  return HANDLE_REGEX.test(value);
}

function nameToHandle(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 20);
}

function formatPhoneInput(digits: string): string {
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatCPF(digits: string): string {
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9)
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function toPixKeyValue(type: PixKeyType, displayValue: string): string {
  if (type === "phone") {
    const digits = displayValue.replace(/\D/g, "");
    return `+55${digits}`;
  }
  if (type === "cpf") {
    return displayValue.replace(/\D/g, "");
  }
  return displayValue;
}

const PIX_KEY_OPTIONS: { type: PixKeyType; label: string }[] = [
  { type: "email", label: "E-mail" },
  { type: "phone", label: "Telefone" },
  { type: "cpf", label: "CPF" },
  { type: "random", label: "Chave aleatoria" },
];

function OnboardPageContent() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const next = safeRedirect(searchParams.get("next"));
  const [step, setStep] = useState<OnboardStep>("profile");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [handleError, setHandleError] = useState("");
  const [authMethod, setAuthMethod] = useState<"google" | "phone">("google");
  const [userEmail, setUserEmail] = useState("");
  const [userPhone, setUserPhone] = useState("");
  const [pixKeyType, setPixKeyType] = useState<PixKeyType>("email");
  const [customPixInput, setCustomPixInput] = useState("");
  const [pixError, setPixError] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;

      const email = user.email ?? "";
      const phone = user.phone ?? "";
      const fullName = user.user_metadata?.full_name ?? "";
      const isPhoneAuth = email.endsWith("@phone.pixwise.local") || (!email && phone);

      setAuthMethod(isPhoneAuth ? "phone" : "google");

      if (isPhoneAuth) {
        setUserPhone(phone);
        setPixKeyType("phone");
        if (phone) {
          const digits = phone.replace(/\D/g, "").replace(/^55/, "");
          setCustomPixInput(formatPhoneInput(digits));
        }
      } else {
        setUserEmail(email);
        setPixKeyType("email");
      }

      if (fullName) {
        setName(fullName);
        setHandle(nameToHandle(fullName));
      }

      supabase
        .from("users")
        .select("handle, name")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (data?.name && !fullName) {
            setName(data.name);
          }
          if (data?.handle) {
            setHandle(data.handle);
          }
        });
    });
  }, [supabase]);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!handleTouched) {
      setHandle(nameToHandle(value));
    }
  };

  const handleHandleChange = (value: string) => {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9._]/g, "");
    setHandle(cleaned);
    setHandleTouched(true);
    setHandleError("");
  };

  const selectPixKeyType = (type: PixKeyType) => {
    setPixKeyType(type);
    setCustomPixInput("");
    setPixError("");

    if (type === "email" && userEmail) {
      setCustomPixInput("");
    }
    if (type === "phone" && userPhone) {
      const digits = userPhone.replace(/\D/g, "").replace(/^55/, "");
      setCustomPixInput(formatPhoneInput(digits));
    }
  };

  const pixKeyDisplay =
    pixKeyType === "email" && !customPixInput ? userEmail : customPixInput;

  const handlePhonePixInput = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    setCustomPixInput(formatPhoneInput(digits));
    setPixError("");
  };

  const handleCPFInput = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    setCustomPixInput(formatCPF(digits));
    setPixError("");
  };

  const handleRandomInput = (value: string) => {
    const cleaned = value.replace(/[^0-9a-fA-F-]/g, "").slice(0, 36).toLowerCase();
    setCustomPixInput(cleaned);
    setPixError("");
  };

  const handleEmailInput = (value: string) => {
    setCustomPixInput(value);
    setPixError("");
  };

  const getInputHandler = () => {
    switch (pixKeyType) {
      case "phone": return handlePhonePixInput;
      case "cpf": return handleCPFInput;
      case "random": return handleRandomInput;
      default: return handleEmailInput;
    }
  };

  const getInputPlaceholder = () => {
    switch (pixKeyType) {
      case "phone": return "(11) 99999-9999";
      case "cpf": return "000.000.000-00";
      case "random": return "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
      default: return "seu@email.com";
    }
  };

  const handleContinue = () => {
    if (!name.trim()) return;
    if (!isValidHandle(handle)) {
      setHandleError(
        "Handle deve ter entre 3 e 20 caracteres, comecar e terminar com letra ou numero.",
      );
      return;
    }
    setStep("pix");
  };

  const handlePaste = async () => {
    const text = await navigator.clipboard.readText();
    getInputHandler()(text.trim());
  };

  const handleSubmit = () => {
    const pixKeyValue = toPixKeyValue(pixKeyType, pixKeyDisplay);
    const formData = new FormData();
    formData.set("handle", handle);
    formData.set("pixKey", pixKeyValue);
    formData.set("pixKeyType", pixKeyType);
    formData.set("name", name.trim());
    formData.set("next", next);

    startTransition(async () => {
      const result = await completeOnboarding(formData);
      if (result?.error) {
        if (result.error.includes("Handle")) {
          setStep("profile");
          setHandleError(result.error);
        } else {
          setPixError(result.error);
        }
      }
    });
  };

  const inferredKeyLabel =
    authMethod === "google" && userEmail
      ? "Detectamos seu e-mail como chave Pix"
      : authMethod === "phone" && userPhone
        ? "Detectamos seu telefone como chave Pix"
        : null;

  const showInferredBanner =
    inferredKeyLabel &&
    ((pixKeyType === "email" && authMethod === "google") ||
      (pixKeyType === "phone" && authMethod === "phone"));

  const steps: OnboardStep[] = ["profile", "pix"];
  const currentIndex = steps.indexOf(step);

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
            {step === "profile" && (
              <motion.div
                key="profile"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <h1 className="text-2xl font-bold">Seu perfil</h1>
                <p className="mt-2 text-muted-foreground">
                  Como seus amigos vao te encontrar.
                </p>

                <div className="mt-8 space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      Nome
                    </label>
                    <Input
                      placeholder="Seu nome completo"
                      value={name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && handleContinue()}
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      Handle
                    </label>
                    <div className="flex items-center">
                      <div className="flex h-8 items-center rounded-l-lg border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                        @
                      </div>
                      <Input
                        className="rounded-l-none"
                        placeholder="seu.handle"
                        value={handle}
                        onChange={(e) => handleHandleChange(e.target.value)}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        onKeyDown={(e) => e.key === "Enter" && handleContinue()}
                      />
                    </div>
                    {handleError && (
                      <p className="mt-2 text-xs text-destructive">
                        {handleError}
                      </p>
                    )}
                    {handle && !handleError && (
                      <p
                        className={`mt-2 text-xs ${
                          isValidHandle(handle)
                            ? "text-success"
                            : "text-muted-foreground"
                        }`}
                      >
                        {isValidHandle(handle)
                          ? `Seus amigos vao te adicionar como @${handle}`
                          : "3-20 caracteres, letras minusculas, numeros, pontos e sublinhados"}
                      </p>
                    )}
                  </div>
                </div>

                <Button
                  className="mt-6 w-full gap-2"
                  size="lg"
                  onClick={handleContinue}
                  disabled={!name.trim() || !handle}
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

                {showInferredBanner && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary"
                  >
                    {inferredKeyLabel}
                  </motion.div>
                )}

                <div className="mt-6 flex flex-wrap gap-2">
                  {PIX_KEY_OPTIONS.map((opt) => (
                    <button
                      key={opt.type}
                      onClick={() => selectPixKeyType(opt.type)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        pixKeyType === opt.type
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="mt-4">
                  <div className="flex gap-2">
                    <Input
                      type={pixKeyType === "email" ? "email" : "text"}
                      placeholder={getInputPlaceholder()}
                      value={pixKeyDisplay}
                      onChange={(e) => getInputHandler()(e.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      inputMode={
                        pixKeyType === "phone" || pixKeyType === "cpf"
                          ? "numeric"
                          : "text"
                      }
                    />
                    <Button
                      variant="outline"
                      size="default"
                      onClick={handlePaste}
                      className="shrink-0 gap-1.5 text-xs"
                    >
                      <Clipboard className="h-3.5 w-3.5" />
                      Colar
                    </Button>
                  </div>
                  {pixError && (
                    <p className="mt-2 text-xs text-destructive">{pixError}</p>
                  )}
                </div>

                <div className="mt-6 space-y-2">
                  <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3">
                    <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <p className="text-xs text-muted-foreground">
                      Sua chave Pix e criptografada e nunca compartilhada com
                      terceiros.
                    </p>
                  </div>
                  <p className="text-center text-[10px] text-muted-foreground">
                    Em conformidade com a LGPD (Lei 13.709/2018). Voce pode
                    excluir seus dados a qualquer momento.
                  </p>
                </div>

                <div className="mt-6 flex gap-3">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setStep("profile")}
                    className="flex-1"
                  >
                    Voltar
                  </Button>
                  <Button
                    className="flex-1 gap-2"
                    size="lg"
                    onClick={handleSubmit}
                    disabled={!pixKeyDisplay || isPending}
                  >
                    {isPending ? "Salvando..." : "Comecar a usar"}
                    {!isPending && <ArrowRight className="h-4 w-4" />}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-8 flex justify-center gap-2">
          {steps.map((s, i) => (
            <motion.div
              key={s}
              animate={{
                width: i === currentIndex ? 24 : 8,
                backgroundColor:
                  i === currentIndex
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

export default function OnboardPage() {
  return (
    <Suspense>
      <OnboardPageContent />
    </Suspense>
  );
}
