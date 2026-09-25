"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Copy, Loader2, QrCode, Share2, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  type PopoverContentProps,
} from "@/components/ui/popover";
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
import { getAuthGeneration } from "@/lib/sync/client";
import { LedgerError } from "@/lib/sync/errors";
import { generateSelfPixCode } from "@/lib/sync/pix";
import { copyText } from "@/lib/platform/clipboard";
import { QrCanvas } from "@/components/shared/qr-canvas";
import type { VendorCharge } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import { Money } from "@/components/shared/money";
import { shareLink } from "@/lib/platform/share";
import { fade, popIn } from "@/lib/animations";
import { useClientOnly } from "@/hooks/use-client-only";
import { cn } from "@/lib/utils";

// Drawn at 3x the 148px tile so the code stays crisp on dense phone screens.
const CHARGE_QR_OPTIONS = { width: 444, margin: 2, color: { dark: "#1a1d2e", light: "#ffffff" } };

// The QR phase is taller than the amount form. Letting Base UI flip would move
// the surface to the other side of the button the moment the code appears, so
// the side stays fixed and overflow is absorbed by shifting instead.
const PINNED_SIDE: PopoverContentProps["collisionAvoidance"] = {
  side: "shift",
  align: "shift",
  fallbackAxisSide: "none",
};

// From md up the quick actions become a column at the top right of Home, with
// no room above but plenty to their left.
const WIDE_LAYOUT_QUERY = "(min-width: 48rem)";

interface ChargeOperation {
  generation: number;
  authGeneration: number;
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
  /** Control the form is positioned against. */
  anchor: HTMLElement | null;
}

export function QuickChargeModal({
  open,
  onClose,
  onChargeConfirmed,
  anchor,
}: QuickChargeModalProps) {
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
  const [copyFailed, setCopyFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmedAmount, setConfirmedAmount] = useState(0);
  const reducedMotion = useReducedMotion();
  const wideLayout = useClientOnly(() => window.matchMedia(WIDE_LAYOUT_QUERY).matches);
  const phaseVariants = reducedMotion ? fade : popIn;

  const requestCancellation = useCallback((operation: ChargeOperation, id: string) => {
    if (
      operation.cancellationPromise ||
      operation.confirmationStarted ||
      operation.confirmed ||
      getAuthGeneration() !== operation.authGeneration
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
      getAuthGeneration() === operation.authGeneration &&
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
      setCopyFailed(false);
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

  useEffect(() => {
    if (!open || phase === "success" || (amountCents === 0 && !description)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, phase, amountCents, description]);

  const generateQr = useCallback(async () => {
    if (!activeRef.current || amountCents <= 0) return;
    haptics.tap();

    abandonGeneration();
    setPhase("qr");
    setLoading(true);
    setError("");
    setCopyFailed(false);

    const controller = new AbortController();
    const operation: ChargeOperation = {
      generation: ++generationRef.current,
      authGeneration: getAuthGeneration(),
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
      const code = await generateSelfPixCode({
        amountCents,
        signal: controller.signal,
      });
      if (!isCurrentOperation(operation)) return;

      copia = code;
      setCopiaECola(code);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!isCurrentOperation(operation)) return;
      setError(
        err instanceof LedgerError && err.code === "network"
          ? "Sem conexão. Tente de novo."
          : err instanceof Error && err.message
            ? err.message
            : "Não deu para gerar o Pix",
      );
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

  const handleCopy = async () => {
    if (!copiaECola) return;
    if (await copyText(copiaECola)) {
      haptics.success();
      setCopied(true);
      setCopyFailed(false);
      toast.success("Código copiado");
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(
        "Não foi possível copiar. Use o código abaixo para copiar manualmente.",
      );
      haptics.error();
      setCopyFailed(true);
    }
  };

  const handleShare = async () => {
    haptics.tap();
    const result = await shareLink({
      title: "Cobrança Pix",
      text: `${description ? `${description}\n` : ""}${formatBRL(amountCents)}\n${copiaECola}`,
      url: window.location.origin,
    });
    if (result === "shared") haptics.success();
    else if (result === "unsupported") await handleCopy();
  };

  const closeModal = useCallback(() => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
    abandonGeneration();
    setPhase("input");
    setCopyFailed(false);
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
      if (!isCurrentOperation(operation)) return;
      operation.confirmed = true;
      useAppStore.getState().upsertVendorCharge(confirmed);

      haptics.success();
      setPhase("success");
      autoCloseRef.current = setTimeout(() => {
        closeModal();
        onChargeConfirmed?.();
      }, 2500);
    } catch {
      operation.confirmationStarted = false;
      if (operation.abandoned && operation.chargeId) {
        requestCancellation(operation, operation.chargeId);
      }
      if (!isCurrentOperation(operation)) return;
      setIsConfirming(false);
      toast.error("Erro ao confirmar. Tente novamente.");
      haptics.error();
    }
  }, [
    copiaECola,
    isConfirming,
    isCurrentOperation,
    closeModal,
    onChargeConfirmed,
    requestCancellation,
  ]);


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

  const handleBackdropDismiss = useCallback(() => {
    if (isConfirming && phase !== "success") return;
    if (phase === "success") {
      handleSuccessClose();
      return;
    }
    if ((amountCents > 0 || description) && !window.confirm("Descartar esta cobrança?")) return;
    closeModal();
  }, [closeModal, handleSuccessClose, isConfirming, phase, amountCents, description]);

  if (!open) return null;

  const qrReady = !loading && !error && Boolean(copiaECola);

  return (
    <Popover
      open={open}
      dismissable={!isConfirming}
      onOpenChange={(next) => {
        if (next) return;
        handleBackdropDismiss();
      }}
    >
      <PopoverContent
        anchor={anchor}
        side={wideLayout ? "inline-start" : "top"}
        align="start"
        collisionAvoidance={PINNED_SIDE}
        data-testid="quick-charge-modal"
      >
        <AnimatePresence mode="wait" initial={false}>
          {phase === "success" ? (
            <motion.div
              key="success"
              variants={phaseVariants} initial="hidden" animate="visible" exit="exit"
              className="relative flex flex-col items-center py-6"
            >
              <ConfettiBurst />
              <AnimatedCheckmark size={72} className="text-success" />

              <PopoverTitle className="mt-4 text-xl">Pagamento recebido</PopoverTitle>
              <Money cents={confirmedAmount} size="lg" tone="positive" className="mt-1" />

              <Button
                variant="outline"
                size="lg"
                onClick={handleSuccessClose}
                className="mt-5"
              >
                Fechar
              </Button>
            </motion.div>
          ) : phase === "qr" ? (
            <motion.div
              key="qr"
              variants={phaseVariants} initial="hidden" animate="visible" exit="exit"
              className="flex flex-col gap-3"
            >
              <div className="flex gap-3">
                <div
                  className={cn(
                    "flex size-[156px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border",
                    qrReady ? "bg-paper p-1" : "bg-muted/40 p-3",
                  )}
                >
                  {loading && (
                    <div role="status" aria-label="Gerando código Pix">
                      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
                    </div>
                  )}
                  {!loading && error && (
                    <p role="alert" className="text-center text-sm text-destructive-text">{error}</p>
                  )}
                  {qrReady && (
                    <QrCanvas
                      value={copiaECola}
                      label={`QR Pix de ${formatBRL(amountCents)}`}
                      options={CHARGE_QR_OPTIONS}
                      className="size-full animate-in duration-200 fade-in-0 motion-safe:zoom-in-95"
                    />
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col">
                  <PopoverTitle className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                    <QrCode className="size-3.5 text-primary-text" aria-hidden="true" />
                    Cobrar via Pix
                  </PopoverTitle>
                  <Money
                    cents={amountCents}
                    size="lg"
                    tone="positive"
                    className="mt-0.5 block leading-tight whitespace-normal"
                  />
                  {description && (
                    <p className="truncate text-sm text-muted-foreground" title={description}>
                      {description}
                    </p>
                  )}

                  <div className="mt-auto flex flex-col gap-2 pt-2">
                    <Button
                      variant="outline"
                      onClick={handleCopy}
                      disabled={!copiaECola || isConfirming}
                      className="w-full gap-1.5 px-3"
                    >
                      {copied ? (
                        <>
                          <Check className="text-success-text" aria-hidden="true" />
                          Copiado!
                        </>
                      ) : (
                        <>
                          <Copy aria-hidden="true" />
                          Copiar código
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleShare}
                      disabled={!copiaECola || isConfirming}
                      className="w-full gap-1.5 px-3"
                    >
                      <Share2 aria-hidden="true" />
                      Compartilhar
                    </Button>
                  </div>
                </div>
              </div>

              {copyFailed && copiaECola && (
                <input
                  readOnly
                  value={copiaECola}
                  aria-label="Código Pix copia e cola"
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-10 w-full rounded-[0.75rem] border border-border bg-muted/60 px-3 font-mono text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
                />
              )}

              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={handleBackToInput}
                  disabled={isConfirming}
                  className="px-3 text-sm text-muted-foreground"
                >
                  Alterar valor
                </Button>
                <Button
                  size="lg"
                  onClick={handleConfirm}
                  disabled={!copiaECola || isConfirming}
                  className="flex-1"
                >
                  {isConfirming ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden="true" />
                      Registrando...
                    </>
                  ) : (
                    <>
                      <Check aria-hidden="true" />
                      Já recebi
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="input"
              variants={phaseVariants} initial="hidden" animate="visible" exit="exit"
            >
              <PopoverTitle className="flex items-center gap-1.5 text-base">
                <Zap className="size-4 text-success-text" aria-hidden="true" />
                Cobrar rápido
              </PopoverTitle>

              <div className="mt-2 flex flex-col gap-2">
                <label className="flex h-11 items-center gap-1.5 rounded-[0.75rem] border border-input bg-card px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                  <span className="text-lg leading-6 font-semibold text-muted-foreground">
                    R$
                  </span>
                  <CurrencyInput
                    valueCents={amountCents}
                    onChangeCents={setAmountCents}
                    autoFocus
                    className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-left text-2xl font-bold text-foreground shadow-none focus-visible:ring-0 md:text-2xl"
                    aria-label="Valor da cobrança"
                  />
                </label>
                <AmountQuickAdd
                  valueCents={amountCents}
                  onChangeCents={(cents) => { setAmountCents(cents); haptics.selectionChanged(); }}
                  increments={[5, 10, 20, 50]}
                />
                <Input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descrição (opcional)"
                  aria-label="Descrição (opcional)"
                  maxLength={100}
                />
                {error && (
                  <p role="alert" className="text-sm text-destructive-text">{error}</p>
                )}
              </div>

              <Button
                onClick={generateQr}
                className="mt-3 w-full gap-2"
                disabled={amountCents <= 0}
              >
                <QrCode className="h-4 w-4" />
                Gerar QR
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </PopoverContent>
    </Popover>
  );
}
