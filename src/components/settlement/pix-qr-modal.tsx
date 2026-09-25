"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Copy,
  Info,
  KeyRound,
  Loader2,
  Pencil,
  QrCode,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CurrencyInput } from "@/components/ui/currency-input";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/currency";
import { haptics } from "@/hooks/use-haptics";
import { AnimatedCheckmark } from "@/components/shared/animated-checkmark";
import { ConfettiBurst } from "@/components/shared/confetti-burst";
import {
  getSnapPoints,
  getSnapRadius,
  getSnapStep,
} from "@/lib/slider-snap";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { generatePixCode, PixRequestError } from "@/lib/sync/pix";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/platform/clipboard";
import { QrCanvas } from "@/components/shared/qr-canvas";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { popIn } from "@/lib/animations";

const PIX_QR_OPTIONS = { width: 240, margin: 2, color: { dark: "#1a1d2e", light: "#ffffff" } };

type TimerId = number | NodeJS.Timeout;

type PixPayloadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; code: string }
  | { status: "missing-key-recipient" }
  | { status: "missing-key-owner" }
  | {
      status: "error";
      reason: "session" | "denied" | "rate-limited" | "invalid" | "unavailable";
    };

/** Maps a pix sync failure to the payload card the modal should show. */
function payloadFailureFrom(error: unknown): PixPayloadState {
  if (error instanceof PixRequestError) {
    if (error.status === 400) return { status: "error", reason: "invalid" };
    if (error.status === 401) return { status: "error", reason: "session" };
    if (error.status === 403) return { status: "error", reason: "denied" };
    if (error.status === 429) return { status: "error", reason: "rate-limited" };
    if (error.status === 404) {
      // The route reports the 404 reason only as prose, so match it
      // accent/case-insensitively in one place.
      const ownerMissing = /voce nao tem/i.test(
        error.message.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
      );
      return ownerMissing
        ? { status: "missing-key-owner" }
        : { status: "missing-key-recipient" };
    }
  }
  return { status: "error", reason: "unavailable" };
}

interface PixQrModalBaseProps {
  open: boolean;
  onClose: () => void;
  recipientName: string;
  counterpartyId?: string;
  counterpartyAvatarUrl?: string | null;
  amountCents: number;
  mode?: "pay" | "collect";
  onMarkPaid: (amountCents: number, operationId: string) => Promise<void>;
  onSettlementComplete?: () => void;
}

export type PixQrModalProps = PixQrModalBaseProps & { recipientUserId: string; groupId: string };

export function PixQrModal({
  open,
  onClose,
  recipientName,
  counterpartyId,
  counterpartyAvatarUrl,
  amountCents,
  recipientUserId,
  groupId,
  mode = "pay",
  onMarkPaid,
  onSettlementComplete,
}: PixQrModalProps) {
  const timerRef = useRef<TimerId | undefined>(undefined);
  const autoCloseRef = useRef<TimerId | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const lastSnapRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [settledAmountCents, setSettledAmountCents] = useState(0);
  const [paymentCents, setPaymentCents] = useState(amountCents);
  const [editingAmount, setEditingAmount] = useState(false);
  const [payload, setPayload] = useState<PixPayloadState>({ status: "idle" });
  const [showPayQr, setShowPayQr] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const isFullPayment = paymentCents >= amountCents;
  const isValidAmount = paymentCents > 0 && paymentCents <= amountCents;
  const halfCents = Math.ceil(amountCents / 2);

  const sliderMin = amountCents < 100 ? 1 : 100;
  const range = amountCents - sliderMin;
  // Page keys move a tenth of the range (at least one centavo), not a fixed amount.
  const pageStep = Math.max(1, Math.round(range / 10));
  const snapStep = getSnapStep(range);
  const snapRadius = getSnapRadius(snapStep, 1);
  const snapPoints = getSnapPoints(sliderMin, amountCents, []);
  const halfAvailable = amountCents >= 200 && halfCents > sliderMin && halfCents < amountCents;

  const commitAmount = useCallback(() => {
    setEditingAmount(false);
    setPaymentCents((current) => Math.min(Math.max(current, 1), amountCents));
  }, [amountCents]);
  const settleKey = useRef(crypto.randomUUID());

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = parseInt(e.target.value);

      let snapped = raw;
      for (const sp of snapPoints) {
        if (Math.abs(raw - sp) <= snapRadius) {
          snapped = sp;
          break;
        }
      }

      const nearestSnap = snapPoints.reduce<number | null>(
        (best, sp) =>
          best === null || Math.abs(raw - sp) < Math.abs(raw - best)
            ? sp
            : best,
        null,
      );
      if (nearestSnap !== null && nearestSnap !== lastSnapRef.current) {
        lastSnapRef.current = nearestSnap;
        haptics.selectionChanged();
      }
      setPaymentCents(snapped);
    },
    [snapPoints, snapRadius],
  );

  const handleSliderKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const current = paymentCents;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowLeft": case "ArrowDown": next = current - 1; break;
      case "ArrowRight": case "ArrowUp": next = current + 1; break;
      case "Home": next = sliderMin; break;
      case "End": next = amountCents; break;
      case "PageDown": next = current - pageStep; break;
      case "PageUp": next = current + pageStep; break;
    }
    if (next === null) return;
    e.preventDefault();
    const clamped = Math.min(amountCents, Math.max(sliderMin, next));
    if (clamped === current) return;
    setPaymentCents(clamped);
    // A held arrow key repeats dozens of times per second; buzz once per burst.
    if (!e.repeat) haptics.selectionChanged();
  };

  useEffect(() => {
    if (open && !isSettling) {
      setPaymentCents(amountCents);
      setShowSuccess(false);
      setSettledAmountCents(0);
      setCopied(false);
      setCopyFailed(false);
    }
  }, [amountCents, isSettling, open]);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      clearTimeout(autoCloseRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open || showSuccess || paymentCents === amountCents) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, showSuccess, paymentCents, amountCents]);

  const qrAmountCents = isValidAmount ? paymentCents : amountCents;


  const generatePayload = useCallback(() => {
    if (qrAmountCents <= 0) return;

    clearTimeout(timerRef.current);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRetrying(true);
    setCopyFailed(false);
    setPayload({ status: "loading" });

    const settle = (next: PixPayloadState) => {
      if (controller.signal.aborted) return;
      setRetrying(false);
      setPayload(next);
    };

    void (async () => {
      try {
        const code = await generatePixCode({
          recipientUserId,
          amountCents: qrAmountCents,
          groupId,
          signal: controller.signal,
        });
        settle({ status: "ready", code });
      } catch (error) {
        settle(payloadFailureFrom(error));
      }
    })();
  }, [recipientUserId, groupId, qrAmountCents]);

  useEffect(() => {
    if (!open) return;
    if (qrAmountCents <= 0) return;

    setPayload({ status: "loading" });
    timerRef.current = setTimeout(() => {
      generatePayload();
    }, 500);

    return () => {
      clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [open, recipientUserId, groupId, qrAmountCents, generatePayload]);

  const copiaECola = payload.status === "ready" ? payload.code : "";

  const showsQr = Boolean(copiaECola) && (showPayQr || mode === "collect");

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
  const handleSuccessClose = () => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
    }
    setShowSuccess(false);
    setIsSettling(false);
    try {
      onSettlementComplete?.();
    } finally {
      onClose();
    }
  };

  const handlePayment = async () => {
    if (!isValidAmount || isSettling) return;
    setIsSettling(true);
    try {
      await onMarkPaid(paymentCents, settleKey.current);
      settleKey.current = crypto.randomUUID();
      setSettledAmountCents(paymentCents);
      haptics.success();
      setShowSuccess(true);
      autoCloseRef.current = window.setTimeout(() => {
        handleSuccessClose();
      }, 2500);
    } catch (error) {
      setIsSettling(false);
      toast.error(ledgerErrorMessage(error));
      haptics.error();
    }
  };

  let settleNotice = "Registrar não move dinheiro, só marca o pagamento no app.";
  if (copiaECola && mode === "pay") {
    settleNotice = "Pague no app do seu banco e retorne aqui para confirmar.";
  } else if (copiaECola) {
    settleNotice = "Quando o Pix cair na sua conta, confirme aqui.";
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && (paymentCents === amountCents || window.confirm("Descartar este pagamento?"))) onClose();
      }}
      dismissable={!isSettling && !showSuccess}
      modal
    >
      <DialogContent
        showCloseButton={!isSettling && !showSuccess}
        initialFocus={false}
        className="sm:max-w-md bg-card p-0 overflow-hidden"
      >
        <AnimatePresence mode="wait">
          {showSuccess ? (
            <motion.div
              key="success"
              variants={popIn} initial="hidden" animate="visible" exit="exit"
              className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain px-6 py-4"
            >
              <ConfettiBurst />

              <AnimatedCheckmark size={72} className="text-success" />

              <DialogTitle className="mt-5 text-xl">Pagamento registrado</DialogTitle>
              <Money cents={settledAmountCents} size="lg" tone="positive" className="mt-2" />

              <p
                className="mt-1 text-sm text-muted-foreground"
              >
                {mode === "collect" ? "de" : "para"}{" "}
                <span className="font-medium text-foreground">{recipientName}</span>
              </p>

              <div
                className="mt-6"
              >
                <Button
                  variant="outline"
                  size="lg"
                  onClick={handleSuccessClose}
                  className="gap-2 min-h-11"
                >
                  Fechar
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex-1 overflow-y-auto min-h-0 px-4 pt-4 pb-3 overscroll-contain" data-testid="pix-qr-body">
                <div className="flex items-center gap-3 pr-12">
                  <UserAvatar id={counterpartyId} name={recipientName} avatarUrl={counterpartyAvatarUrl} size="md" />
                  <DialogTitle className="min-w-0 truncate text-lg" title={recipientName}>
                    {mode === "collect" ? "Cobrar" : "Pagar"} {recipientName}
                  </DialogTitle>
                </div>
                <div className={cn(showsQr && "compact:flex compact:items-center compact:gap-3")}>
                <div className="min-w-0 text-center compact:flex-1">

                  <div className="mt-3">
                    {editingAmount ? (
                      <label
                        className={cn("flex items-center justify-center gap-1 text-3xl compact:text-2xl font-bold tabular-nums", mode === "pay" ? "text-destructive-text" : "text-success-text")}
                        onBlur={commitAmount}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === "Escape") {
                            event.stopPropagation();
                            commitAmount();
                          }
                        }}
                      >
                        <span className="sr-only">Editar valor</span>
                        <span aria-hidden="true">R$</span>
                        <CurrencyInput
                          autoFocus
                          valueCents={paymentCents}
                          maxCents={amountCents}
                          onChangeCents={setPaymentCents}
                          aria-label="Editar valor"
                          className="h-12 w-40 text-3xl font-bold text-inherit compact:h-11 compact:w-28 compact:text-2xl"
                        />
                      </label>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingAmount(true)}
                        disabled={isSettling}
                        aria-label={`Editar valor, ${formatBRL(paymentCents)}`}
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <Money cents={paymentCents} size="hero" tone={mode === "pay" ? "negative" : "positive"} className="compact:text-3xl" />
                        <Pencil className="size-4 text-muted-foreground" aria-hidden="true" />
                      </button>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="range"
                        min={sliderMin}
                        max={amountCents}
                        step={1}
                        value={paymentCents}
                        onChange={handleSliderChange}
                        onKeyDown={handleSliderKeyDown}
                        disabled={isSettling}
                        className="min-w-0 flex-1"
                        aria-label="Valor do pagamento"
                        aria-valuetext={formatBRL(paymentCents)}
                      />
                      <button
                        type="button"
                        onClick={() => { setPaymentCents(amountCents); haptics.selectionChanged(); }}
                        disabled={isSettling}
                        aria-pressed={paymentCents === amountCents}
                        aria-label="Tudo"
                        title="Tudo"
                        className={`flex min-h-11 shrink-0 items-center justify-center rounded-full px-2 text-xs font-semibold transition-colors ${
                          paymentCents === amountCents
                            ? "text-primary-text"
                            : "text-muted-foreground hover:text-primary-text"
                        } disabled:opacity-50`}
                      >
                        Tudo
                      </button>
                      {halfAvailable && (
                        <button
                          type="button"
                          onClick={() => { setPaymentCents(halfCents); haptics.selectionChanged(); }}
                          disabled={isSettling}
                          aria-pressed={paymentCents === halfCents}
                          aria-label="Metade"
                          title="Metade"
                          className={`flex min-h-11 shrink-0 items-center justify-center rounded-full px-2 text-xs font-semibold transition-colors ${
                            paymentCents === halfCents
                              ? "text-primary-text"
                              : "text-muted-foreground hover:text-primary-text"
                          } disabled:opacity-50`}
                        >
                          Metade
                        </button>
                      )}
                    </div>

                    {!isFullPayment && isValidAmount && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Restam <Money cents={amountCents - paymentCents} size="sm" />
                      </p>
                    )}
                  </div>

                  {copiaECola && mode === "pay" && (
                    <div className="mt-5 text-left compact:mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2 compact:w-full"
                        aria-expanded={showPayQr}
                        aria-controls="pix-qr-region"
                        onClick={() => setShowPayQr((v) => !v)}
                      >
                        <QrCode className="h-4 w-4" />
                        {showPayQr ? "Ocultar QR code" : "Mostrar QR code"}
                      </Button>
                    </div>
                  )}
                </div>
              <div
                id="pix-qr-region"
                className={cn(showsQr && "compact:w-[112px] compact:shrink-0")}
              >
                {showsQr ? (
                  <motion.div
                    variants={popIn} initial="hidden" animate="visible"
                    className="mt-3 flex justify-center rounded-2xl border border-border bg-paper p-3 compact:p-2"
                  >
                    <QrCanvas
                      value={copiaECola}
                      label={`QR Pix de ${formatBRL(qrAmountCents)}`}
                      options={PIX_QR_OPTIONS}
                      className="compact:size-[104px]"
                    />
                  </motion.div>
                ) : !copiaECola ? (
                  <motion.div
                    variants={popIn} initial="hidden" animate="visible"
                    className="mt-3 flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-muted/30 p-4 text-center"
                  >
                    {payload.status === "idle" || payload.status === "loading" ? (
                      <div role="status" aria-label="Gerando código Pix" className="flex h-24 w-full items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : payload.status === "missing-key-recipient" ? (
                      <>
                        <KeyRound className="size-6 text-muted-foreground" aria-hidden="true" />
                        <p className="text-sm text-muted-foreground">
                          {recipientName} ainda não cadastrou uma chave Pix
                        </p>
                      </>
                    ) : payload.status === "missing-key-owner" ? (
                      <>
                        <KeyRound className="size-6 text-muted-foreground" aria-hidden="true" />
                        <p className="text-sm text-muted-foreground">Você ainda não cadastrou uma chave Pix</p>
                        <Button nativeButton={false} render={<Link href="/app/profile" />} variant="outline" className="min-h-11">
                          Cadastrar chave Pix
                        </Button>
                      </>
                    ) : payload.status === "error" ? (
                      <>
                        <WifiOff className="h-8 w-8 text-muted-foreground/50" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">
                            Não foi possível gerar o QR code
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {payload.reason === "rate-limited"
                              ? "Muitas tentativas. Espere alguns segundos."
                              : payload.reason === "session"
                                ? "Sua sessão expirou. Entre de novo para continuar."
                                : payload.reason === "denied" || payload.reason === "invalid"
                                  ? "Não deu pra gerar esse código agora."
                                  : "Sem conexão? Confira a internet e tente de novo."}
                          </p>
                        </div>
                        {(payload.reason === "rate-limited" ||
                          payload.reason === "unavailable") && (
                          <Button
                            variant="outline"
                            size="lg"
                            className="gap-2 rounded-lg"
                            onClick={generatePayload}
                            disabled={retrying}
                          >
                            <RefreshCw
                              className={`h-4 w-4${retrying ? " animate-spin" : ""}`}
                            />
                            Tentar de novo
                          </Button>
                    )}
                  </>
                ) : null}
                  </motion.div>
                ) : null}
              </div>
                </div>

              </div>

              <div className="shrink-0 border-t border-border px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] compact:px-3 compact:pt-2">
                <p className="mb-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  {settleNotice}
                </p>
                <div className="space-y-2 compact:flex compact:gap-2 compact:space-y-0 compact:[&>button]:flex-1">
                  {copiaECola && <Button
                    onClick={handleCopy}
                    variant="outline"
                    className="w-full gap-2"
                    disabled={!copiaECola || isSettling}
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4 text-success-text" />
                        Copiado!
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        Copiar código Pix
                      </>
                    )}
                  </Button>}
                  {copyFailed && copiaECola && (
                    <p className="break-all rounded-lg border border-border bg-muted/60 p-2.5 font-mono text-xs select-all">
                      {copiaECola}
                    </p>
                  )}
                  <Button
                    onClick={handlePayment}
                    variant={copiaECola ? "default" : "outline"}
                    className="w-full gap-2"
                    disabled={!isValidAmount || isSettling}
                  >
                    {isSettling ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Registrando...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4" />
                        {!copiaECola ? "Registrar pagamento" : mode === "collect" ? "Já recebi" : "Já paguei"}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
