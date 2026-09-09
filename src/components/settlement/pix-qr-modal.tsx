"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Loader2, QrCode, Shield } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  getSliderStep,
  getSnapPoints,
  getSnapRadius,
  getSnapStep,
} from "@/lib/slider-snap";
import { ledgerErrorMessage } from "@/lib/sync/errors";

type PixQrModalSource =
  | { pixKey: string; recipientUserId?: never; groupId?: never }
  | { pixKey?: never; recipientUserId: string; groupId: string };

type TimerId = number | NodeJS.Timeout;

interface FetchedPayload {
  amountCents: number;
  recipientUserId: string;
  payload: string;
}

interface PixQrModalBaseProps {
  open: boolean;
  onClose: () => void;
  recipientName: string;
  amountCents: number;
  mode?: "pay" | "collect";
  onMarkPaid: (amountCents: number) => Promise<void>;
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
  const lastSnapRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [settledAmountCents, setSettledAmountCents] = useState(0);
  const [paymentCents, setPaymentCents] = useState(amountCents);
  const [fetched, setFetched] = useState<FetchedPayload | null>(null);
  const [payloadError, setPayloadError] = useState(false);
  const [payloadLoading, setPayloadLoading] = useState(false);

  const isFullPayment = paymentCents >= amountCents;
  const isValidAmount = paymentCents > 0 && paymentCents <= amountCents;
  const halfCents = Math.ceil(amountCents / 2);

  const sliderMin = amountCents < 100 ? 1 : 100;
  const range = amountCents - sliderMin;
  const sliderStep = getSliderStep(range);
  const snapStep = getSnapStep(range);
  const snapPoints = getSnapPoints(sliderMin, amountCents);
  const snapRadius = getSnapRadius(snapStep, sliderStep);

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

  useEffect(() => {
    if (open && !isSettling) {
      setPaymentCents(amountCents);
      setShowSuccess(false);
      setSettledAmountCents(0);
    }
  }, [amountCents, isSettling, open]);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      clearTimeout(autoCloseRef.current);
    };
  }, []);

  const qrAmountCents = isValidAmount ? paymentCents : amountCents;

  useEffect(() => {
    if (!open || pixKey || !recipientUserId || !groupId) return;
    if (qrAmountCents <= 0) return;

    let controller: AbortController | undefined;

    setPayloadLoading(true);
    timerRef.current = setTimeout(async () => {
      controller = new AbortController();
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
        const data = (await res.json()) as { copiaECola?: string };
        if (data.copiaECola) {
          setFetched({ amountCents: qrAmountCents, recipientUserId, payload: data.copiaECola });
          setPayloadError(false);
        } else {
          setPayloadError(res.status >= 500);
        }
      } catch {
        if (controller.signal.aborted) return;
        setPayloadError(true);
      } finally {
        if (!controller.signal.aborted) setPayloadLoading(false);
      }
    }, 500);

    return () => {
      clearTimeout(timerRef.current);
      controller?.abort();
    };
  }, [open, pixKey, recipientUserId, groupId, qrAmountCents]);

  const copiaECola = pixKey
    ? generatePixCopiaECola({
        pixKey,
        merchantName: recipientName,
        merchantCity: "SAO PAULO",
        amountCents: qrAmountCents,
      })
    : fetched &&
        fetched.amountCents === qrAmountCents &&
        fetched.recipientUserId === recipientUserId
      ? fetched.payload
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
    await navigator.clipboard.writeText(copiaECola);
    haptics.success();
    setCopied(true);
    toast.success("Código Pix copiado!");
    setTimeout(() => setCopied(false), 2000);
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
      await onMarkPaid(paymentCents);
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
        showCloseButton={false}
        className="w-[calc(100%-2rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl bg-card p-6"
      >
        <AnimatePresence mode="wait">
          {showSuccess ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="relative flex flex-col items-center py-8"
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
                  className="gap-2"
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
              <div className="text-center">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl gradient-primary text-white shadow-lg shadow-primary/20"
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
                  <p className="text-3xl font-bold tabular-nums text-primary">
                    {formatBRL(paymentCents)}
                  </p>
                  <input
                    type="range"
                    min={sliderMin}
                    max={amountCents}
                    step={sliderStep}
                    value={paymentCents}
                    onChange={handleSliderChange}
                    disabled={isSettling}
                    className="mt-3 w-full"
                    aria-label="Valor do pagamento"
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
                      disabled={isSettling || paymentCents === amountCents}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                        paymentCents === amountCents
                          ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                          : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      } disabled:opacity-50`}
                    >
                      Tudo: {formatBRL(amountCents)}
                    </button>
                    {halfCents !== amountCents && (
                      <button
                        type="button"
                        onClick={() => setPaymentCents(halfCents)}
                        disabled={isSettling || paymentCents === halfCents}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                          paymentCents === halfCents
                            ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                            : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary"
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

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="mt-6 flex justify-center rounded-2xl border bg-white p-5 shadow-sm"
              >
                {payloadLoading ? (
                  <div className="flex h-[240px] w-[240px] items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : copiaECola ? (
                  <canvas ref={paintQr} />
                ) : (
                  <div className="flex h-[240px] w-[240px] flex-col items-center justify-center gap-3 text-center">
                    <QrCode className="h-12 w-12 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">
                      {payloadError
                        ? "Não deu pra gerar o QR agora. Tenta de novo."
                        : `Não temos a chave Pix de ${recipientName.split(" ")[0]}.`}
                    </p>
                  </div>
                )}
              </motion.div>

              <div className="mt-5 space-y-2.5">
                <Button
                  onClick={handleCopy}
                  variant="outline"
                  className="w-full gap-2"
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
                <Button
                  onClick={handlePayment}
                  className="w-full gap-2"
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
                        ? isFullPayment ? "Já recebi" : `Recebi ${formatBRL(paymentCents)}`
                        : isFullPayment ? "Já paguei" : `Paguei ${formatBRL(paymentCents)}`}
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                <Shield className="h-3 w-3" />
                <span>
                  {copiaECola
                    ? "Lê o QR code ou copia o código e cola no app do banco."
                    : "Sem QR code? Combine o valor por fora e registra aqui embaixo."}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
