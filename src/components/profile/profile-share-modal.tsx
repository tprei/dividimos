"use client";

import { Copy, ExternalLink, MessageCircle } from "lucide-react";
import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { useClientOnly } from "@/hooks/use-client-only";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shared/user-avatar";
import { buildWhatsAppLink } from "@/lib/contacts";
import { copyText } from "@/lib/platform/clipboard";
import { isShareSupported, shareLink } from "@/lib/platform/share";
import { qrToCanvas } from "@/lib/qr";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { haptics } from "@/hooks/use-haptics";

interface ProfileShareModalProps {
  id: string;
  open: boolean;
  onClose: () => void;
  handle: string;
  name: string;
  avatarUrl?: string | null;
}

export function ProfileShareModal({
  id,
  open,
  onClose,
  handle,
  name,
  avatarUrl,
}: ProfileShareModalProps) {
  const [qrFailed, setQrFailed] = useState(false);
  const canShare = useClientOnly(isShareSupported);

  const profileUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/u/${handle}`
      : "";

  const paintQr = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas || !profileUrl) return;
    void qrToCanvas(canvas, profileUrl, {
      width: 200,
      margin: 2,
      color: { dark: "#1a1d2e", light: "#ffffff" },
    }).then(() => setQrFailed(false), () => setQrFailed(true));
  }, [profileUrl]);

  const shareMessage = `Me adicione no Dividimos! Meu perfil: @${handle}`;

  const handleShare = useCallback(async () => {
    if (!canShare) {
      if (await copyText(`${shareMessage}\n${profileUrl}`)) toast.success("Link copiado!");
      else toast.error("Não deu pra copiar");
      return;
    }
    const outcome = await shareLink({
      title: "Dividimos",
      text: shareMessage,
      url: profileUrl,
    });
    if (outcome === "unsupported") toast.error("Erro ao compartilhar");
  }, [canShare, shareMessage, profileUrl]);

  const handleCopy = useCallback(async () => {
    if (await copyText(profileUrl)) { toast.success("Link copiado"); haptics.success(); }
    else { toast.error("Não deu pra copiar"); haptics.error(); }
  }, [profileUrl]);

  const handleWhatsApp = useCallback(() => {
    const url = buildWhatsAppLink(`${shareMessage}\n${profileUrl}`);
    window.open(url, "_blank");
  }, [shareMessage, profileUrl]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="[@media(max-height:500px)_and_(min-width:600px)]:max-w-xl">
        <DialogHeader>
          <DialogTitle>Compartilhar perfil</DialogTitle>
          <DialogDescription>@{handle}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-y-auto [@media(max-height:500px)_and_(min-width:600px)]:grid-cols-[224px_minmax(0,1fr)]">
          <div className="flex min-w-0 items-center gap-3 [@media(max-height:500px)_and_(min-width:600px)]:col-start-2">
            <UserAvatar id={id} name={name} avatarUrl={avatarUrl} size="lg" />
            <p title={name} className="min-w-0 truncate text-lg font-bold">{name}</p>
          </div>
          <div className="flex justify-center rounded-2xl bg-paper p-3 [@media(max-height:500px)_and_(min-width:600px)]:col-start-1 [@media(max-height:500px)_and_(min-width:600px)]:row-span-2 [@media(max-height:500px)_and_(min-width:600px)]:row-start-1">
            <canvas ref={paintQr} role="img" aria-label={`QR code do perfil de ${name}`} />
          </div>
          {qrFailed && <p role="alert" className="text-sm text-destructive-text">O QR code não carregou. O link continua disponível.</p>}
          <div className="grid gap-2 [@media(max-height:500px)_and_(min-width:600px)]:col-start-2">
            <Button onClick={handleCopy}><Copy className="size-4" />Copiar link</Button>
            {canShare && <Button variant="outline" onClick={handleShare}><ExternalLink className="size-4" />Compartilhar</Button>}
            <Button variant="outline" onClick={handleWhatsApp}><MessageCircle className="size-4" />Enviar pelo WhatsApp</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
