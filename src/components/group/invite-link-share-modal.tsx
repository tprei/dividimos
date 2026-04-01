"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Copy, ExternalLink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";

interface InviteLinkShareModalProps {
  open: boolean;
  onClose: () => void;
  groupName: string;
  token: string;
}

export function InviteLinkShareModal({
  open,
  onClose,
  groupName,
  token,
}: InviteLinkShareModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator?.share === "function");
  }, []);

  const joinUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/join/${token}`
      : "";

  useEffect(() => {
    if (!open || !joinUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, joinUrl, {
      width: 240,
      margin: 2,
      color: { dark: "#1a1d2e", light: "#ffffff" },
    });
  }, [open, joinUrl]);

  const shareText = `Entre no grupo "${groupName}" no Dividimos!`;

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Dividimos",
          text: shareText,
          url: joinUrl,
        });
      } catch (e) {
        if ((e as DOMException).name !== "AbortError") {
          toast.error("Erro ao compartilhar");
        }
      }
    } else {
      await navigator.clipboard.writeText(`${shareText}\n${joinUrl}`);
      toast.success("Link copiado!");
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(joinUrl);
    toast.success("Link copiado!");
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

          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Convite para o grupo</h3>
              <p className="text-sm text-muted-foreground">{groupName}</p>
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
            Qualquer pessoa com este link pode entrar no grupo
          </p>

          <div className="mt-4 space-y-2">
            {canShare && (
              <Button className="w-full gap-2" onClick={handleShare}>
                <ExternalLink className="h-4 w-4" />
                Compartilhar
              </Button>
            )}
            <Button
              variant={canShare ? "outline" : "default"}
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
