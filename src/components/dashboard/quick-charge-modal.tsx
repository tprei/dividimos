"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Loader2, QrCode, Shield, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { formatBRL } from "@/lib/currency";
import { haptics } from "@/hooks/use-haptics";
import { AnimatedCheckmark } from "@/components/shared/animated-checkmark";
import { ConfettiBurst } from "@/components/shared/confetti-burst";
import {
  recordVendorCharge,
  confirmVendorCharge,
} from "@/lib/supabase/vendor-charge-actions";

interface QuickChargeModalProps {
  open: boolean;
  onClose: () => void;
  onChargeConfirmed?: () => void;
}

export function QuickChargeModal({
  open,
  onClose,
  onChargeConfirmed,
}: QuickChargeModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [amountCents, setAmountCents] = useState(0);
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState<"input" | "qr" | "success">("input");
  const [copiaECola, setCopiaECola] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const [chargeId, setChargeId] = useState<string | null>(null);
  const [confirmedAmount, setConfirmedAmount] = useState(0);

  useEffect(() => {
    if (open) {
      setAmountCents(0);
      setDescription("");
      setPhase("input");
      setCopiaECola("");
      setCopied(false);
      setError("");
      setChargeId(null);
      setIsConfirming(false);
      setConfirmedAmount(0);
    } else {
      if (autoCloseRef.current) {
        clearTimeout(autoCloseRef.current);
        autoCloseRef.current = null;
      }
    }
  }, [open]);

  const generateQr = useCallback(async () => {
    if (amountCents <= 0) return;

    setPhase("qr");
    setLoading(true);
    setError("");
    setCopiaECola("");

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/pix/generate-self", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents }),
        signal: abortRef.current.signal,
      });

      const data = await res.json();
      if (!data.copiaECola) {
        setError(data.error || "Eita, deu ruim no Pix");
        haptics.error();
        return;
      }

      const charge = await recordVendorCharge(
        amountCents,
        description || undefined,
      );
      setChargeId(charge.id);
      setCopiaECola(data.copiaECola);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Sem conexão. Tenta de novo.");
      haptics.error();
    } finally {
      setLoading(false);
    }
  }, [amountCents, description]);

  useEffect(() => {
    if (!copiaECola || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, copiaECola, {
      width: 240,
      margin: 2,
      color: { dark: "#1a1d2e", light: "#ffffff" },
    });
  }, [copiaECola]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(copiaECola);
    haptics.success();
    setCopied(true);
    toast.success("Código Pix copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConfirm = async () => {
    if (!chargeId || isConfirming) return;
    setIsConfirming(true);
    setConfirmedAmount(amountCents);
    try {
      await confirmVendorCharge(chargeId);
      haptics.success();
      setPhase("success");
      autoCloseRef.current = setTimeout(() => {
        handleSuccessClose();
      }, 2500);
    } catch {
      setIsConfirming(false);
      toast.error("Erro ao confirmar. Tente novamente.");
      haptics.error();
    }
  };

  const handleSuccessClose = () => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
    setPhase("input");
    setIsConfirming(false);
    onClose();
    onChargeConfirmed?.();
  };

  const handleBackdropClick = () => {
    if (isConfirming && phase !== "success") return;
    if (phase === "success") {
      handleSuccessClose();
      return;
    }
    onClose();
  };

  const handleDragEnd = (
    _: unknown,
    info: { offset: { y: number }; velocity: { y: number } },
  ) => {
    if (isConfirming && phase !== "success") return;
    if (info.offset.y > 100 || info.velocity.y > 500) {
      if (phase === "success") {
        handleSuccessClose();
      } else {
        onClose();
      }
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-end justify-center backdrop-blur-sm bg-black/40 sm:items-center"
        onClick={handleBackdropClick}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          drag={isConfirming && phase !== "success" ? false : "y"}
          dragConstraints={{ top: 0 }}
          dragElastic={0.2}
          onDragEnd={handleDragEnd}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-t-3xl bg-card p-6 pb-24 sm:pb-6 sm:rounded-3xl"
        >
          <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-muted/80 sm:hidden" />

          <AnimatePresence mode="wait">
            {phase === "success" ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                className="relative flex flex-col items-center py-8"
              >
                <ConfettiBurst />
                <AnimatedCheckmark size={72} className="text-success" />

                <motion.h2
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="mt-5 text-xl font-bold text-foreground"
                >
                  Pagamento recebido!
                </motion.h2>

                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.55 }}
                  className="mt-2 text-2xl font-bold tabular-nums text-success"
                >
                  {formatBRL(confirmedAmount)}
                </motion.p>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1 }}
                  className="mt-6"
                >
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={handleSuccessClose}
                    className="gap-2"
                  >
                    Fechar
                  </Button>
                </motion.div>
              </motion.div>
            ) : phase === "qr" ? (
              <motion.div
                key="qr"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <div className="text-center">
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 20,
                    }}
                    className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl gradient-primary text-white shadow-lg shadow-primary/20"
                  >
                    <QrCode className="h-7 w-7" />
                  </motion.div>
                  <h2 className="mt-4 text-lg font-bold">Cobrar via Pix</h2>
                  <p className="mt-1 text-3xl font-bold tabular-nums text-primary">
                    {formatBRL(amountCents)}
                  </p>
                  {description && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {description}
                    </p>
                  )}
                </div>

                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                  className="mt-6 flex justify-center rounded-2xl border bg-white p-5 shadow-sm"
                >
                  {loading ? (
                    <div className="flex h-[240px] w-[240px] items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : error ? (
                    <div className="flex h-[240px] w-[240px] flex-col items-center justify-center gap-3 text-center">
                      <QrCode className="h-12 w-12 text-muted-foreground/30" />
                      <p className="text-sm text-destructive">{error}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPhase("input")}
                      >
                        Voltar
                      </Button>
                    </div>
                  ) : (
                    <canvas ref={canvasRef} />
                  )}
                </motion.div>

                <div className="mt-5 space-y-2.5">
                  <Button
                    onClick={handleCopy}
                    variant="outline"
                    className="w-full gap-2"
                    size="lg"
                    disabled={!copiaECola || isConfirming}
                  >
                    {copied ? (
                      <>
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{
                            type: "spring",
                            stiffness: 500,
                            damping: 15,
                          }}
                        >
                          <Check className="h-4 w-4 text-success" />
                        </motion.span>
                        Copiado!
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        Copiar código Pix
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handleConfirm}
                    className="w-full gap-2"
                    size="lg"
                    disabled={!copiaECola || isConfirming}
                  >
                    {isConfirming ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Registrando...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4" />
                        Já recebi {formatBRL(amountCents)}
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full"
                    size="sm"
                    onClick={() => setPhase("input")}
                    disabled={isConfirming}
                  >
                    Alterar valor
                  </Button>
                </div>

                <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                  <Shield className="h-3 w-3" />
                  <span>
                    Lê o QR code ou copia o código e cola no app do banco.
                  </span>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="input"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <div className="text-center">
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 20,
                    }}
                    className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10 text-success shadow-lg shadow-success/10"
                  >
                    <Zap className="h-7 w-7" />
                  </motion.div>
                  <h2 className="mt-4 text-lg font-bold">Cobrar rápido</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Gere um QR Pix para qualquer pessoa te pagar
                  </p>
                </div>

                <div className="mt-6 flex flex-col items-center">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-medium text-muted-foreground">
                      R$
                    </span>
                    <CurrencyInput
                      valueCents={amountCents}
                      onChangeCents={setAmountCents}
                      autoFocus
                      className="text-4xl font-bold text-foreground w-48"
                      aria-label="Valor da cobrança"
                    />
                  </div>

                  <div className="mt-3">
                    <AmountQuickAdd
                      valueCents={amountCents}
                      onChangeCents={setAmountCents}
                      increments={[5, 10, 20, 50]}
                    />
                  </div>

                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descrição (opcional)"
                    maxLength={100}
                    className="mt-4 w-full rounded-xl border bg-muted/30 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/30 transition-colors"
                  />
                </div>

                <div className="mt-6">
                  <Button
                    onClick={generateQr}
                    className="w-full gap-2"
                    size="lg"
                    disabled={amountCents <= 0}
                  >
                    <QrCode className="h-4 w-4" />
                    Gerar QR Code
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
