"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, QrCode } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { generatePixCopiaECola } from "@/lib/pix";

interface PixQrModalProps {
  open: boolean;
  onClose: () => void;
  pixKey: string;
  recipientName: string;
  amountCents: number;
  onMarkPaid: () => void;
}

export function PixQrModal({
  open,
  onClose,
  pixKey,
  recipientName,
  amountCents,
  onMarkPaid,
}: PixQrModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copiaECola, setCopiaECola] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !pixKey || amountCents <= 0) return;

    const payload = generatePixCopiaECola({
      pixKey,
      merchantName: recipientName,
      merchantCity: "SAO PAULO",
      amountCents,
    });
    setCopiaECola(payload);

    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, payload, {
        width: 240,
        margin: 2,
        color: {
          dark: "#1a1d2e",
          light: "#ffffff",
        },
      });
    }
  }, [open, pixKey, recipientName, amountCents]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(copiaECola);
    setCopied(true);
    toast.success("Pix Copia e Cola copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-t-3xl bg-card p-6 sm:rounded-3xl"
        >
          <div className="mx-auto mb-6 h-1 w-10 rounded-full bg-muted sm:hidden" />

          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <QrCode className="h-6 w-6" />
            </div>
            <h2 className="mt-3 text-lg font-bold">Pagar via Pix</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              para {recipientName}
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-primary">
              {formatBRL(amountCents)}
            </p>
          </div>

          <div className="mt-6 flex justify-center rounded-2xl border bg-white p-4">
            <canvas ref={canvasRef} />
          </div>

          <div className="mt-4 space-y-3">
            <Button
              onClick={handleCopy}
              variant="outline"
              className="w-full gap-2"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-success" />
                  Copiado!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copiar Pix Copia e Cola
                </>
              )}
            </Button>
            <Button onClick={onMarkPaid} className="w-full gap-2">
              <Check className="h-4 w-4" />
              Ja paguei
            </Button>
          </div>

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Escaneie o QR code ou copie o codigo e cole no app do seu banco.
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
