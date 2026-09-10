"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Loader2, QrCode, Shield, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBackHandler } from "@/hooks/use-back-handler";
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
  cancelVendorCharge,
  confirmVendorCharge,
  recordVendorCharge,
} from "@/lib/sync/mutations-group";
import { useAppStore } from "@/stores/app-store";
import type { VendorCharge } from "@/types/ledger";

interface ChargeOperation {
  generation: number;
  controller: AbortController;
  amountCents: number;
  description: string | null;
  insertPromise: Promise<VendorCharge> | null;
  chargeId: string | null;
  cancellationPromise: Promise<void> | null;
  cancellationAttached: boolean;
  confirmationStarted: boolean;
  confirmed: boolean;
  abandoned: boolean;
}

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
  const generationRef = useRef(0);
  const operationRef = useRef<ChargeOperation | null>(null);
  const activeRef = useRef(open);
  activeRef.current = open;

  const [amountCents, setAmountCents] = useState(0);
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState<"input" | "qr" | "success">("input");
  const [copiaECola, setCopiaECola] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmedAmount, setConfirmedAmount] = useState(0);
  useBackHandler(open && !isConfirming && phase !== "success", onClose);

  const requestCancellation = useCallback((operation: ChargeOperation, id: string) => {
    if (
      operation.cancellationPromise ||
      operation.confirmationStarted ||
      operation.confirmed
    ) {
      return;
    }
    const cancellation = cancelVendorCharge(id);
    operation.cancellationPromise = cancellation;
    void cancellation.catch(() => {
      if (activeRef.current) {
        const message = "Não foi possível cancelar a cobrança. Tente novamente.";
        setError(message);
        toast.error(message);
      }
    });
  }, []);

  const attachCancellation = useCallback(
    (operation: ChargeOperation) => {
      if (!operation.insertPromise || operation.cancellationAttached) return;
      operation.cancellationAttached = true;
      void operation.insertPromise.then(
        (charge) => {
          operation.chargeId = charge.id;
          if (operation.abandoned) {
            requestCancellation(operation, charge.id);
          }
        },
        () => {
          // A failed insert created no row to cancel.
        },
      );
    },
    [requestCancellation],
  );

  const abandonGeneration = useCallback(() => {
    generationRef.current += 1;
    const operation = operationRef.current;
    if (operation) {
      operation.abandoned = true;
      operation.controller.abort();
      if (operation.chargeId) {
        requestCancellation(operation, operation.chargeId);
      }
    }
    operationRef.current = null;
    abortRef.current = null;
  }, [requestCancellation]);

  const isCurrentOperation = useCallback((operation: ChargeOperation) => {
    return (
      activeRef.current &&
      operationRef.current === operation &&
      generationRef.current === operation.generation &&
      !operation.abandoned &&
      !operation.controller.signal.aborted
    );
  }, []);

  useEffect(() => {
    if (open) {
      abandonGeneration();
      setAmountCents(0);
      setDescription("");
      setPhase("input");
      setCopiaECola("");
      setCopied(false);
      setError("");
      setIsConfirming(false);
      setConfirmedAmount(0);
      return;
    }

    abandonGeneration();
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
  }, [open, abandonGeneration]);

  useEffect(() => {
    return () => {
      abandonGeneration();
    };
  }, [abandonGeneration]);

  const generateQr = useCallback(async () => {
    if (!activeRef.current || amountCents <= 0) return;

    abandonGeneration();
    setPhase("qr");
    setLoading(true);
    setError("");
    setCopiaECola("");

    const controller = new AbortController();
    const operation: ChargeOperation = {
      generation: ++generationRef.current,
      controller,
      amountCents,
      description: description || null,
      insertPromise: null,
      chargeId: null,
      cancellationPromise: null,
      cancellationAttached: false,
      confirmationStarted: false,
      confirmed: false,
      abandoned: false,
    };
    operationRef.current = operation;
    abortRef.current = controller;

    let copia: string | null = null;
    try {
      const res = await fetch("/api/pix/generate-self", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!isCurrentOperation(operation)) return;

      if (!data.copiaECola) {
        setError(data.error || "Eita, deu ruim no Pix");
        haptics.error();
        return;
      }

      copia = data.copiaECola;
      setCopiaECola(data.copiaECola);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!isCurrentOperation(operation)) return;
      setError("Sem conexão. Tenta de novo.");
      haptics.error();
      return;
    } finally {
      if (isCurrentOperation(operation)) setLoading(false);
    }

    if (!copia || !isCurrentOperation(operation)) return;

    const insertPromise = recordVendorCharge(
      operation.amountCents,
      operation.description,
    );
    operation.insertPromise = insertPromise;
    attachCancellation(operation);

    try {
      const charge = await insertPromise;
      operation.chargeId = charge.id;
      if (!isCurrentOperation(operation)) {
        if (operation.abandoned) requestCancellation(operation, charge.id);
        return;
      }
      useAppStore.getState().upsertVendorCharge(charge);
    } catch {
      if (!isCurrentOperation(operation)) return;
      setError("Não foi possível registrar a cobrança. Tente novamente.");
      haptics.error();
    }
  }, [
    amountCents,
    description,
    abandonGeneration,
    isCurrentOperation,
    attachCancellation,
    requestCancellation,
  ]);

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

  const closeModal = useCallback(() => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
    abandonGeneration();
    setPhase("input");
    setIsConfirming(false);
    onClose();
  }, [abandonGeneration, onClose]);
  const handleConfirm = useCallback(async () => {
    if (isConfirming) return;
    const operation = operationRef.current;
    if (!operation || !isCurrentOperation(operation) || !copiaECola) return;

    setIsConfirming(true);
    setConfirmedAmount(operation.amountCents);
    try {
      let id = operation.chargeId;
      if (!id && operation.insertPromise) {
        const charge = await operation.insertPromise;
        operation.chargeId = charge.id;
        id = charge.id;
      }

      if (!id || !isCurrentOperation(operation)) return;

      operation.confirmationStarted = true;
      const confirmed = await confirmVendorCharge(id);
      operation.confirmed = true;
      useAppStore.getState().upsertVendorCharge(confirmed);
      if (!isCurrentOperation(operation)) return;

      haptics.success();
      setPhase("success");
      autoCloseRef.current = setTimeout(() => {
        closeModal();
        onChargeConfirmed?.();
      }, 2500);
    } catch {
      if (!isCurrentOperation(operation)) return;
      setIsConfirming(false);
      toast.error("Erro ao confirmar. Tente novamente.");
      haptics.error();
    }
  }, [copiaECola, isConfirming, isCurrentOperation, closeModal, onChargeConfirmed]);


  const handleSuccessClose = useCallback(() => {
    const operation = operationRef.current;
    if (operation) operation.confirmed = true;
    closeModal();
    onChargeConfirmed?.();
  }, [closeModal, onChargeConfirmed]);

  const handleBackToInput = useCallback(() => {
    if (isConfirming) return;
    abandonGeneration();
    setPhase("input");
    setCopiaECola("");
    setError("");
  }, [abandonGeneration, isConfirming]);

  const handleBackdropClick = useCallback(() => {
    if (isConfirming && phase !== "success") return;
    if (phase === "success") {
      handleSuccessClose();
      return;
    }
    closeModal();
  }, [closeModal, handleSuccessClose, isConfirming, phase]);

  const handleDragEnd = useCallback(
    (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
      if (isConfirming && phase !== "success") return;
      if (info.offset.y > 100 || info.velocity.y > 500) {
        if (phase === "success") {
          handleSuccessClose();
        } else {
          closeModal();
        }
      }
    },
    [closeModal, handleSuccessClose, isConfirming, phase],
  );

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
                        onClick={handleBackToInput}
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
                    onClick={handleBackToInput}
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
                  {error && (
                    <p className="mt-2 text-center text-sm text-destructive">{error}</p>
                  )}
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
