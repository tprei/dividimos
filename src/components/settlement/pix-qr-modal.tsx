"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Loader2, QrCode, Shield } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { formatBRL, centsToDecimal, sanitizeDecimalInput, decimalToCents } from "@/lib/currency";
import { generatePixCopiaECola } from "@/lib/pix";

interface PixQrModalProps {
  open: boolean;
  onClose: () => void;
  recipientName: string;
  amountCents: number;
  paidAmountCents?: number;
  onMarkPaid: (amountCents: number) => void;
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
  pixKey,
  recipientUserId,
  billId,
  groupId,
  mode = "pay",
}: PixQrModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copiaECola, setCopiaECola] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const remainingCents = amountCents - paidAmountCents;
  const [inputValue, setInputValue] = useState(() => centsToDecimal(remainingCents).replace(".", ","));
  const paymentCents = decimalToCents(parseFloat(inputValue.replace(",", ".")) || 0);
  const isFullPayment = paymentCents >= remainingCents;
  const isValidAmount = paymentCents > 0 && paymentCents <= remainingCents;

  // Reset input when modal opens or remaining changes
  useEffect(() => {
    if (open) {
      setInputValue(centsToDecimal(remainingCents).replace(".", ","));
    }
  }, [open, remainingCents]);

  // Generate QR code based on the entered amount
  const qrAmountCents = isValidAmount ? paymentCents : remainingCents;

  useEffect(() => {
    if (!open || qrAmountCents <= 0) return;

    (async () => {
      setCopiaECola("");
      setError("");
      setLoading(true);

      if (pixKey) {
        const payload = generatePixCopiaECola({
          pixKey,
          merchantName: recipientName,
          merchantCity: "SAO PAULO",
          amountCents: qrAmountCents,
        });
        setCopiaECola(payload);
        setLoading(false);
        return;
      }

      if (recipientUserId) {
        try {
          const res = await fetch("/api/pix/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipientUserId, amountCents: qrAmountCents, billId, groupId }),
          });
          const data = await res.json();
          if (data.copiaECola) {
            setCopiaECola(data.copiaECola);
          } else {
            setError(data.error || "Erro ao gerar Pix");
          }
        } catch {
          setError("Erro de conexao. Tente novamente.");
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    })();
  }, [open, pixKey, recipientUserId, recipientName, qrAmountCents, billId, groupId]);

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
    setCopied(true);
    toast.success("Pix Copia e Cola copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePayment = () => {
    if (!isValidAmount) return;
    onMarkPaid(paymentCents);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-end justify-center backdrop-blur-sm bg-black/40 sm:items-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          drag="y"
          dragConstraints={{ top: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.y > 100 || info.velocity.y > 500) {
              onClose();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-t-3xl bg-card p-6 pb-24 sm:pb-6 sm:rounded-3xl"
        >
          <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-muted/80 sm:hidden" />

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

            {/* Amount input for partial payments */}
            <div className="mt-3">
              {paidAmountCents > 0 && (
                <p className="mb-1 text-xs text-muted-foreground">
                  Ja pago: {formatBRL(paidAmountCents)} de {formatBRL(amountCents)}
                </p>
              )}
              <div className="flex items-center justify-center gap-2">
                <span className="text-xl font-bold text-primary">R$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={inputValue}
                  onChange={(e) => setInputValue(sanitizeDecimalInput(e.target.value))}
                  className="w-32 border-b-2 border-primary bg-transparent text-center text-3xl font-bold tabular-nums text-primary outline-none focus:border-primary/80"
                  aria-label="Valor do pagamento"
                />
              </div>
              {!isFullPayment && isValidAmount && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Restante apos pagamento: {formatBRL(remainingCents - paymentCents)}
                </p>
              )}
              {paymentCents > remainingCents && (
                <p className="mt-1 text-xs text-destructive">
                  Valor excede o restante ({formatBRL(remainingCents)})
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
              disabled={!copiaECola}
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
                  Copiar Pix Copia e Cola
                </>
              )}
            </Button>
            <Button
              onClick={handlePayment}
              className="w-full gap-2"
              size="lg"
              disabled={!isValidAmount}
            >
              <Check className="h-4 w-4" />
              {mode === "collect"
                ? isFullPayment ? "Ja recebi" : `Recebi ${formatBRL(paymentCents)}`
                : isFullPayment ? "Ja paguei" : `Paguei ${formatBRL(paymentCents)}`}
            </Button>
          </div>

          <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <Shield className="h-3 w-3" />
            <span>
              Escaneie o QR code ou copie o codigo e cole no app do seu banco.
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
