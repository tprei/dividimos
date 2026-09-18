"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  QrCode,
  RefreshCw,
  Shield,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CurrencyInput } from "@/components/ui/currency-input";
import QRCode from "qrcode";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/currency";
import { generatePixCopiaECola } from "@/lib/pix";
import { haptics } from "@/hooks/use-haptics";
import { AnimatedCheckmark } from "@/components/shared/animated-checkmark";
import { ConfettiBurst } from "@/components/shared/confetti-burst";
import {
  getSnapPoints,
  getSnapRadius,
  getSnapStep,
} from "@/lib/slider-snap";
import { ledgerErrorMessage } from "@/lib/sync/errors";

type PixQrModalSource =
  | { pixKey: string; recipientUserId?: never; groupId?: never }
  | { pixKey?: never; recipientUserId: string; groupId: string };

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

interface PixQrModalBaseProps {
  open: boolean;
  onClose: () => void;
  recipientName: string;
  amountCents: number;
  mode?: "pay" | "collect";
  onMarkPaid: (amountCents: number, operationId: string) => Promise<void>;
  onSettlementComplete?: () => void;
}

export type PixQrModalProps = PixQrModalBaseProps & PixQrModalSource;

export function PixQrModal({
  open,
  onClose,
  recipientName,
  amountCents,
  pixKey,
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

  const qrAmountCents = isValidAmount ? paymentCents : amountCents;


  const generatePayload = useCallback(() => {
    if (!recipientUserId || !groupId || qrAmountCents <= 0) return;

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
        const res = await fetch("/api/pix/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipientUserId,
            amountCents: qrAmountCents,
            groupId,
          }),
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => null)) as {
          copiaECola?: string;
          error?: string;
        } | null;
        if (res.status === 200 && data?.copiaECola) {
          settle({ status: "ready", code: data.copiaECola });
        } else if (res.status === 400) {
          settle({ status: "error", reason: "invalid" });
        } else if (res.status === 404) {
          // The route (frozen for this stack) reports the 404 reason as prose,
          // so match it accent/case-insensitively in one place.
          const ownerMissing = /voce nao tem/i.test(
            (data?.error ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
          );
          settle(
            ownerMissing
              ? { status: "missing-key-owner" }
              : { status: "missing-key-recipient" },
          );
        } else if (res.status === 401) {
          settle({ status: "error", reason: "session" });
        } else if (res.status === 403) {
          settle({ status: "error", reason: "denied" });
        } else if (res.status === 429) {
          settle({ status: "error", reason: "rate-limited" });
        } else {
          settle({ status: "error", reason: "unavailable" });
        }
      } catch {
        if (!controller.signal.aborted) {
          settle({ status: "error", reason: "unavailable" });
        }
      }
    })();
  }, [recipientUserId, groupId, qrAmountCents]);

  useEffect(() => {
    if (!open || pixKey || !recipientUserId || !groupId) return;
    if (qrAmountCents <= 0) return;

    setPayload({ status: "loading" });
    timerRef.current = setTimeout(() => {
      generatePayload();
    }, 500);

    return () => {
      clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [open, pixKey, recipientUserId, groupId, qrAmountCents, generatePayload]);

  const copiaECola = pixKey
    ? generatePixCopiaECola({
        pixKey,
        merchantName: recipientName,
        merchantCity: "SAO PAULO",
        amountCents: qrAmountCents,
      })
    : payload.status === "ready"
      ? payload.code
      : "";

  const paintQr = useCallback(
    (node: HTMLCanvasElement | null) => {
      if (!node || !copiaECola) return;
      QRCode.toCanvas(node, copiaECola, {
        width: 240,
        margin: 2,
        color: { dark: "#1a1d2e", light: "#ffffff" },
      });
    },
    [copiaECola],
  );

  const handleCopy = async () => {
    if (!copiaECola) return;
    try {
      await navigator.clipboard.writeText(copiaECola);
      haptics.success();
      setCopied(true);
      setCopyFailed(false);
      toast.success("Código Pix copiado!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
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

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      dismissable={!isSettling && !showSuccess}
      modal
    >
      <DialogContent
        showCloseButton={!isSettling && !showSuccess}
        initialFocus={false}
        className="sm:max-w-md rounded-3xl bg-card p-0"
      >
        <AnimatePresence mode="wait">
          {showSuccess ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain px-6 py-4"
            >
              <DialogTitle className="sr-only">Pagamento registrado</DialogTitle>
              <ConfettiBurst />

              <AnimatedCheckmark size={72} className="text-success" />

              <motion.h2
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="mt-5 text-xl font-bold text-foreground"
              >
                Pagamento registrado!
              </motion.h2>

              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55 }}
                className="mt-2 text-2xl font-bold tabular-nums text-success"
              >
                {formatBRL(settledAmountCents)}
              </motion.p>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="mt-1 text-sm text-muted-foreground"
              >
                {mode === "collect" ? "de" : "para"}{" "}
                <span className="font-medium text-foreground">{recipientName}</span>
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
                  className="gap-2 min-h-11"
                >
                  Fechar
                </Button>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="flex-1 overflow-y-auto min-h-0 px-6 pt-4 pb-3 overscroll-contain scroll-pt-6" data-testid="pix-qr-body">
                <div className="text-center">
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl gradient-primary text-gradient-foreground shadow-lg shadow-primary/20"
                  >
                    <QrCode className="h-7 w-7" />
                  </motion.div>
                  <DialogTitle className="mt-4 text-lg font-bold">
                    {mode === "collect" ? "Cobrar via Pix" : "Pagar via Pix"}
                  </DialogTitle>
                  <DialogDescription className="mt-1 text-sm text-muted-foreground">
                    {mode === "collect" ? "de" : "para"}{" "}
                    <span className="font-medium text-foreground">{recipientName}</span>
                  </DialogDescription>

                  <div className="mt-3">
                    {editingAmount ? (
                      <label
                        className="flex items-center justify-center gap-1 text-3xl font-bold tabular-nums text-primary-text"
                        onBlur={commitAmount}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === "Escape") commitAmount();
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
                          className="h-12 w-40 text-3xl font-bold text-primary-text"
                        />
                      </label>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingAmount(true)}
                        disabled={isSettling}
                        aria-label={`Editar valor, ${formatBRL(paymentCents)}`}
                        className="inline-flex items-center gap-2 rounded-lg px-2 text-3xl font-bold tabular-nums text-primary-text transition-colors hover:bg-primary/10"
                      >
                        {formatBRL(paymentCents)}
                        <Pencil className="size-4 text-muted-foreground" aria-hidden="true" />
                      </button>
                    )}
                    <input
                      type="range"
                      min={sliderMin}
                      max={amountCents}
                      step={1}
                      value={paymentCents}
                      onChange={handleSliderChange}
                      onKeyDown={handleSliderKeyDown}
                      disabled={isSettling}
                      className="mt-3 w-full"
                      aria-label="Valor do pagamento"
                      aria-valuetext={formatBRL(paymentCents)}
                    />
                    {snapPoints.length > 0 && amountCents > sliderMin && (
                      <div className="relative mx-[11px] h-2">
                        {snapPoints.map((v) => (
                          <div
                            key={v}
                            className="absolute top-0 w-0.5 h-1.5 rounded-full bg-muted-foreground/30"
                            style={{
                              left: `${((v - sliderMin) / (amountCents - sliderMin)) * 100}%`,
                            }}
                          />
                        ))}
                      </div>
                    )}

                    <div className="mt-2 flex justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentCents(amountCents)}
                        disabled={isSettling}
                        aria-pressed={paymentCents === amountCents}
                        className={`min-h-11 rounded-full px-4 text-xs font-medium transition-all ${
                          paymentCents === amountCents
                            ? "bg-primary/15 text-primary-text ring-1 ring-primary/30"
                            : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary-text"
                        } disabled:opacity-50`}
                      >
                        Tudo: {formatBRL(amountCents)}
                      </button>
                      {halfAvailable && (
                        <button
                          type="button"
                          onClick={() => setPaymentCents(halfCents)}
                          disabled={isSettling}
                          aria-pressed={paymentCents === halfCents}
                          className={`min-h-11 rounded-full px-4 text-xs font-medium transition-all ${
                            paymentCents === halfCents
                              ? "bg-primary/15 text-primary-text ring-1 ring-primary/30"
                              : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary-text"
                          } disabled:opacity-50`}
                        >
                          Metade: {formatBRL(halfCents)}
                        </button>
                      )}
                    </div>

                    {!isFullPayment && isValidAmount && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Resta depois do Pix: {formatBRL(amountCents - paymentCents)}
                      </p>
                    )}
                  </div>
                </div>

                {copiaECola && mode === "pay" && (
                  <div className="mt-5 text-left">
                    <p className="text-sm text-muted-foreground">
                      Copia o código, paga no app do seu banco e volta aqui pra confirmar. Registrar não move dinheiro, só marca que você pagou.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 min-h-11 gap-2 rounded-full px-4"
                      aria-expanded={showPayQr}
                      aria-controls="pix-qr-region"
                      onClick={() => setShowPayQr((v) => !v)}
                    >
                      <QrCode className="h-4 w-4" />
                      {showPayQr ? "Ocultar QR code" : "Mostrar QR code"}
                    </Button>
                  </div>
                )}
              <div id="pix-qr-region">
                {(showPayQr || mode === "collect") && copiaECola ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="mt-6 flex justify-center rounded-2xl border bg-white p-5 shadow-sm"
                  >
                    <canvas ref={paintQr} />
                  </motion.div>
                ) : !copiaECola ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="mt-6 flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-2xl border bg-white p-5 text-center shadow-sm"
                  >
                    {payload.status === "idle" || payload.status === "loading" ? (
                      <div className="flex h-[240px] w-[240px] items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : payload.status === "missing-key-recipient" ? (
                      <>
                        <KeyRound className="h-8 w-8 text-muted-foreground/50" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">
                            Chave Pix não cadastrada
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {recipientName.split(" ")[0]} ainda não cadastrou uma chave Pix no Dividimos.
                          </p>
                        </div>
                      </>
                    ) : payload.status === "missing-key-owner" ? (
                      <>
                        <KeyRound className="h-8 w-8 text-muted-foreground/50" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">
                            Cadastre sua chave Pix
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Cadastre sua chave Pix no seu perfil pra receber pagamentos.
                          </p>
                        </div>
                        <Link href="/app/profile">
                          <Button variant="outline" size="lg" className="gap-2 rounded-lg">
                            Configurar chave Pix no perfil
                          </Button>
                        </Link>
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
                              ? "Muitas tentativas. Espera alguns segundos."
                              : payload.reason === "session"
                                ? "Sua sessão expirou. Entra de novo pra continuar."
                                : payload.reason === "denied" || payload.reason === "invalid"
                                  ? "Não deu pra gerar esse código agora."
                                  : "Sem conexão? Confere a internet e tenta de novo."}
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

              {!copiaECola && (
                <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <Shield className="h-3 w-3" />
                  <span>Sem QR code? Combine o valor por fora e registra aqui embaixo.</span>
                </div>
              )}

                {mode === "collect" && (
                  <p className="mt-5 text-sm text-muted-foreground">
                    Registrar não move dinheiro, só marca que ele te pagou por fora.
                  </p>
                )}
              </div>

              <div className="shrink-0 border-t border-border/40 p-6 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] shadow-[0_-10px_16px_-12px_rgb(0_0_0/0.18)]">
                <div className="space-y-2.5">
                  <Button
                    onClick={handleCopy}
                    variant="outline"
                    className="w-full gap-2 min-h-11"
                    size="lg"
                    disabled={!copiaECola || isSettling}
                  >
                    {copied ? (
                      <>
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 500, damping: 15 }}
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
                  {copyFailed && copiaECola && (
                    <p className="break-all rounded-lg border border-border bg-muted/60 p-2.5 font-mono text-xs select-all">
                      {copiaECola}
                    </p>
                  )}
                  <Button
                    onClick={handlePayment}
                    className="w-full gap-2 min-h-11"
                    size="lg"
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
                        {mode === "collect"
                          ? isFullPayment
                            ? "Já recebi"
                            : `Recebi ${formatBRL(paymentCents)}`
                          : payload.status === "missing-key-recipient"
                            ? "Registrar pagamento feito por fora"
                            : isFullPayment
                              ? "Já paguei"
                              : `Paguei ${formatBRL(paymentCents)}`}
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
