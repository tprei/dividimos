"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Copy, ExternalLink, MessageCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shared/user-avatar";
import { buildWhatsAppLink } from "@/lib/contacts";

interface ProfileShareModalProps {
  open: boolean;
  onClose: () => void;
  handle: string;
  name: string;
  avatarUrl?: string | null;
}

export function ProfileShareModal({
  open,
  onClose,
  handle,
  name,
  avatarUrl,
}: ProfileShareModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator?.share === "function");
  }, []);

  const profileUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/u/${handle}`
      : "";

  useEffect(() => {
    if (!open || !profileUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, profileUrl, {
      width: 200,
      margin: 2,
      color: { dark: "#1a1d2e", light: "#ffffff" },
    });
  }, [open, profileUrl]);

  const shareMessage = `Me adicione no Dividimos! Meu perfil: @${handle}`;

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Dividimos",
          text: shareMessage,
          url: profileUrl,
        });
      } catch (e) {
        if ((e as DOMException).name !== "AbortError") {
          toast.error("Erro ao compartilhar");
        }
      }
    } else {
      await navigator.clipboard.writeText(`${shareMessage}\n${profileUrl}`);
      toast.success("Link copiado!");
    }
  }, [shareMessage, profileUrl]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(profileUrl);
    toast.success("Link copiado!");
  }, [profileUrl]);

  const handleWhatsApp = useCallback(() => {
    const url = buildWhatsAppLink(`${shareMessage}\n${profileUrl}`);
    window.open(url, "_blank");
  }, [shareMessage, profileUrl]);

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
          className="w-full max-w-md rounded-t-3xl bg-card p-6 pb-24 sm:pb-6 sm:rounded-3xl overflow-y-auto max-h-[90vh]"
        >
          <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-muted/80 sm:hidden" />

          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Meu perfil</h3>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col items-center gap-3">
            <UserAvatar name={name} avatarUrl={avatarUrl} size="lg" />
            <div className="text-center">
              <p className="font-medium">{name}</p>
              <p className="text-sm text-muted-foreground">@{handle}</p>
            </div>
          </div>

          <div className="mt-4 flex justify-center rounded-2xl bg-white p-4">
            <canvas ref={canvasRef} />
          </div>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Escaneie o QR code ou compartilhe o link do seu perfil
          </p>

          <div className="mt-4 space-y-2">
            <Button
              className="w-full gap-2 bg-[#25D366] hover:bg-[#1da851] text-white"
              onClick={handleWhatsApp}
            >
              <MessageCircle className="h-4 w-4" />
              Enviar pelo WhatsApp
            </Button>

            {canShare && (
              <Button
                className="w-full gap-2"
                variant="outline"
                onClick={handleShare}
              >
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
