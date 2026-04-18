"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Loader2, QrCode, Shield } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { generatePixCopiaECola } from "@/lib/pix";
import { haptics } from "@/hooks/use-haptics";
import { AnimatedCheckmark } from "@/components/shared/animated-checkmark";
import { ConfettiBurst } from "@/components/shared/confetti-burst";

/** Round `raw` up to the next value in the 1-2-5 series (in centavos). */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const n = raw / base;
  const mult = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return mult * base;
}

/** Pick a snap step that yields ~8 interior snap points across the range. */
function getSnapStep(rangeCents: number): number {
  return niceStep(rangeCents / 8);
}

/** Generate snap points evenly spaced by a scale-aware step. */
function getSnapPoints(minCents: number, maxCents: number): number[] {
  const range = maxCents - minCents;
  if (range <= 0) return [];
  const step = getSnapStep(range);
  const points: number[] = [];
  const first = Math.ceil((minCents + 1) / step) * step;
  for (let v = first; v < maxCents; v += step) points.push(v);
  return points;
}

/** Snap radius = 25% of snap step, but never below the slider step. */
function getSnapRadius(snapStep: number, sliderStep: number): number {
  return Math.max(sliderStep, Math.floor(snapStep * 0.25));
}

/** Slider granularity scales with range so drag feels smooth at any scale. */
function getSliderStep(rangeCents: number): number {
  if (rangeCents < 1_000) return 1;
  if (rangeCents < 100_000) return 10;
  return 100;
}

interface PixQrModalProps {
  open: boolean;
  onClose: () => void;
  recipientName: string;
  amountCents: number;
  paidAmountCents?: number;
  onMarkPaid: (amountCents: number) => Promise<void>;
  onSettlementComplete?: () => void;
  pixKey?: string;
  recipientUserId?: string;
  billId?: string;
  groupId?: string;
  mode?: "pay" | "collect";
}

export function PixQrModal({
  open,
  onClose,
  recipientName,
  amountCents,
  paidAmountCents = 0,
  onMarkPaid,
  onSettlementComplete,
  pixKey,
  recipientUserId,
  billId,
  groupId,
  mode = "pay",
}: PixQrModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevOpenRef = useRef(false);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copiaECola, setCopiaECola] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isSettling, setIsSettling] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [settledAmountCents, setSettledAmountCents] = useState(0);

  const remainingCents = amountCents - paidAmountCents;
  const [paymentCents, setPaymentCents] = useState(remainingCents);
  const isFullPayment = paymentCents >= remainingCents;
  const isValidAmount = paymentCents > 0 && paymentCents <= remainingCents;
  const halfCents = Math.ceil(remainingCents / 2);

  const lastSnapRef = useRef<number | null>(null);
  const sliderMin = remainingCents < 100 ? 1 : 100;
  const range = remainingCents - sliderMin;
  const sliderStep = getSliderStep(range);
  const snapStep = getSnapStep(range);
  const snapPoints = getSnapPoints(sliderMin, remainingCents);
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

      // Haptic tick when crossing a snap boundary
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
    if (open) {
      setPaymentCents(remainingCents);
      setIsSettling(false);
      setShowSuccess(false);
      setSettledAmountCents(0);
    }
  }, [open, remainingCents]);

  useEffect(() => {
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
  }, []);

  const qrAmountCents = isValidAmount ? paymentCents : remainingCents;

  const [debouncedAmountCents, setDebouncedAmountCents] = useState(qrAmountCents);

  useEffect(() => {
    if (!open) {
      prevOpenRef.current = false;
      return;
    }
    if (!prevOpenRef.current) {
      prevOpenRef.current = true;
      setDebouncedAmountCents(qrAmountCents);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedAmountCents(qrAmountCents);
    }, 500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [open, qrAmountCents]);

  useEffect(() => {
    if (!open || debouncedAmountCents <= 0) return;

    (async () => {
      setCopiaECola("");
      setError("");
      setLoading(true);

      if (pixKey) {
        const payload = generatePixCopiaECola({
          pixKey,
          merchantName: recipientName,
          merchantCity: "SAO PAULO",
          amountCents: debouncedAmountCents,
        });
        setCopiaECola(payload);
        setLoading(false);
        return;
      }

      if (recipientUserId) {
        abortRef.current?.abort();
        abortRef.current = new AbortController();
        try {
          const res = await fetch("/api/pix/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipientUserId, amountCents: debouncedAmountCents, billId, groupId }),
            signal: abortRef.current.signal,
          });
          const data = await res.json();
          if (data.copiaECola) {
            setCopiaECola(data.copiaECola);
          } else {
            setError(data.error || "Eita, deu ruim no Pix");
            haptics.error();
          }
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
          setError("Sem conexão. Tenta de novo.");
          haptics.error();
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    })();
  }, [open, pixKey, recipientUserId, recipientName, debouncedAmountCents, billId, groupId]);

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

  const handlePayment = async () => {
    if (!isValidAmount || isSettling) return;
    setIsSettling(true);
    setSettledAmountCents(paymentCents);
    try {
      await onMarkPaid(paymentCents);
      haptics.success();
      setShowSuccess(true);
      autoCloseRef.current = setTimeout(() => {
        handleSuccessClose();
      }, 2500);
    } catch {
      setIsSettling(false);
      toast.error("Erro ao registrar pagamento. Tente novamente.");
      haptics.error();
    }
  };

  const handleSuccessClose = () => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
    setShowSuccess(false);
    setIsSettling(false);
    onClose();
    onSettlementComplete?.();
  };

  const handleBackdropClick = () => {
    if (isSettling && !showSuccess) return;
    if (showSuccess) {
      handleSuccessClose();
      return;
    }
    onClose();
  };

  const handleDragEnd = (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
    if (isSettling && !showSuccess) return;
    if (info.offset.y > 100 || info.velocity.y > 500) {
      if (showSuccess) {
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
          drag={isSettling && !showSuccess ? false : "y"}
          dragConstraints={{ top: 0 }}
          dragElastic={0.2}
          onDragEnd={handleDragEnd}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-t-3xl bg-card p-6 pb-24 sm:pb-6 sm:rounded-3xl"
        >
          <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-muted/80 sm:hidden" />

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
                  <h2 className="mt-4 text-lg font-bold">
                    {mode === "collect" ? "Cobrar via Pix" : "Pagar via Pix"}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {mode === "collect" ? "de" : "para"}{" "}
                    <span className="font-medium text-foreground">{recipientName}</span>
                  </p>

                  <div className="mt-3">
                    {paidAmountCents > 0 && (
                      <p className="mb-1 text-xs text-muted-foreground">
                        Já pago: {formatBRL(paidAmountCents)} de {formatBRL(amountCents)}
                      </p>
                    )}
                    <p className="text-3xl font-bold tabular-nums text-primary">
                      {formatBRL(paymentCents)}
                    </p>
                    <input
                      type="range"
                      min={sliderMin}
                      max={remainingCents}
                      step={sliderStep}
                      value={paymentCents}
                      onChange={handleSliderChange}
                      onPointerDown={(e) => e.stopPropagation()}
                      disabled={isSettling}
                      className="mt-3 w-full"
                      aria-label="Valor do pagamento"
                    />
                    {snapPoints.length > 0 && remainingCents > sliderMin && (
                      <div className="relative mx-[11px] h-2">
                        {snapPoints.map((v) => (
                          <div
                            key={v}
                            className="absolute top-0 w-0.5 h-1.5 rounded-full bg-muted-foreground/30"
                            style={{
                              left: `${((v - sliderMin) / (remainingCents - sliderMin)) * 100}%`,
                            }}
                          />
                        ))}
                      </div>
                    )}

                    <div className="mt-2 flex justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentCents(remainingCents)}
                        disabled={isSettling || paymentCents === remainingCents}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                          paymentCents === remainingCents
                            ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                            : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        } disabled:opacity-50`}
                      >
                        Tudo: {formatBRL(remainingCents)}
                      </button>
                      {halfCents !== remainingCents && (
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
                        Resta depois do Pix: {formatBRL(remainingCents - paymentCents)}
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
                  {loading ? (
                    <div className="flex h-[240px] w-[240px] items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : error ? (
                    <div className="flex h-[240px] w-[240px] flex-col items-center justify-center gap-3 text-center">
                      <QrCode className="h-12 w-12 text-muted-foreground/30" />
                      <p className="text-sm text-destructive">{error}</p>
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
                    Lê o QR code ou copia o código e cola no app do banco.
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
