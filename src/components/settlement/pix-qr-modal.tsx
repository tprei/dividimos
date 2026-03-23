"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, QrCode, Shield } from "lucide-react";
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
        className="fixed inset-0 z-50 flex items-end justify-center backdrop-blur-sm bg-black/40 sm:items-center"
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
          className="w-full max-w-md rounded-t-3xl bg-card p-6 safe-bottom sm:rounded-3xl"
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
            <h2 className="mt-4 text-lg font-bold">Pagar via Pix</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              para <span className="font-medium text-foreground">{recipientName}</span>
            </p>
            <motion.p
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="mt-3 text-3xl font-bold tabular-nums text-primary"
            >
              {formatBRL(amountCents)}
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-6 flex justify-center rounded-2xl border bg-white p-5 shadow-sm"
          >
            <canvas ref={canvasRef} />
          </motion.div>

          <div className="mt-5 space-y-2.5">
            <Button
              onClick={handleCopy}
              variant="outline"
              className="w-full gap-2"
              size="lg"
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
            <Button onClick={onMarkPaid} className="w-full gap-2" size="lg">
              <Check className="h-4 w-4" />
              Ja paguei
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
