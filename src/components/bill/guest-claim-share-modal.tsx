"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Copy, ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import toast from "react-hot-toast";
import { useClientOnly } from "@/hooks/use-client-only";
import { Button } from "@/components/ui/button";
import { buildClaimUrl } from "@/lib/claim-qr";
import { formatBRL } from "@/lib/currency";

interface GuestClaimShareModalProps {
  open: boolean;
  onClose: () => void;
  guestName: string;
  /** Transient credential from the issuer response; null while closed. */
  token: string | null;
  generation: number;
  shareAmountCents?: number;
  expenseTitle: string;
}

export function GuestClaimShareModal({
  open,
  onClose,
  guestName,
  token,
  shareAmountCents,
  expenseTitle,
}: GuestClaimShareModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canShare = useClientOnly(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
  );

  // The credential lives only in the fragment; buildClaimUrl never puts it in
  // a path, query, or header. With no transient token there is nothing to show.
  const claimUrl = token ? buildClaimUrl(token) : "";

  useEffect(() => {
    if (!open || !claimUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, claimUrl, {
      width: 240,
      margin: 2,
      color: { dark: "#1a1d2e", light: "#ffffff" },
    });
  }, [open, claimUrl]);

  const shareText = shareAmountCents
    ? `Participe da conta "${expenseTitle}" no Dividimos! Sua parte: ${formatBRL(shareAmountCents)}`
    : `Participe da conta "${expenseTitle}" no Dividimos!`;

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Dividimos", text: shareText, url: claimUrl });
      } catch (e) {
        if ((e as DOMException).name !== "AbortError") {
          toast.error("Erro ao compartilhar");
        }
      }
    } else {
      await navigator.clipboard.writeText(`${shareText}\n${claimUrl}`);
      toast.success("Link copiado!");
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(claimUrl);
    toast.success("Link copiado!");
  };

  if (!open || token === null) return null;

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

          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">{guestName}</h3>
              {shareAmountCents != null && shareAmountCents > 0 && (
                <p className="text-sm text-muted-foreground">
                  Parte: {formatBRL(shareAmountCents)}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex justify-center rounded-2xl bg-white p-4">
            <canvas ref={canvasRef} />
          </div>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Escaneie o QR code para entrar na conta
          </p>

          <div className="mt-4 space-y-2">
            {canShare && (
              <Button className="w-full gap-2" variant="outline" onClick={handleShare}>
                <ExternalLink className="h-4 w-4" />
                Compartilhar
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={handleCopy}
            >
              <Copy className="h-4 w-4" />
              Copiar link
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
