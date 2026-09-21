"use client";

import { Check, Copy, QrCode, RefreshCw, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { RoomActivity } from "@/components/assignment-room/room-activity";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import type {
  AssignmentRoomActivity,
  AssignmentRoomItem,
  AssignmentRoomParticipant,
} from "@/types/assignment-room";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface RoomShareProps {
  url: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rotating: boolean;
  rotationDisabled: boolean;
  errorMessage: string | null;
  onRotate: () => void;
  latestActivity?: AssignmentRoomActivity | null;
  participants?: AssignmentRoomParticipant[];
  items?: AssignmentRoomItem[];
  connected?: boolean;
}

export function RoomShare({
  url,
  open,
  onOpenChange,
  rotating,
  rotationDisabled,
  errorMessage,
  onRotate,
  latestActivity = null,
  participants = [],
  items = [],
  connected = false,
}: RoomShareProps) {
  // Feedback is remembered against the invite it belongs to, so a rotated
  // link or a reopened dialog drops stale "copiado" and QR failures without an
  // effect writing state back on every render.
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copyFailedUrl, setCopyFailedUrl] = useState<string | null>(null);
  const [qrFailedUrl, setQrFailedUrl] = useState<string | null>(null);
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);
  const [shareFailedUrl, setShareFailedUrl] = useState<string | null>(null);
  // The dialog mounts its content in a portal, so the canvas can arrive after
  // the effect that wants to draw on it. Tracking the node as state makes the
  // draw run when the element exists instead of silently skipping it and
  // leaving an empty white square where the QR should be.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  const copied = open && url !== null && copiedUrl === url;
  const copyFailed = open && url !== null && copyFailedUrl === url;
  const qrFailed = url !== null && qrFailedUrl === url;
  const shareFailed = open && url !== null && shareFailedUrl === url;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  // The QR stays hidden while a rotation is in flight so an old code is never
  // presented as current. The cancellation flag keeps a completion from an
  // older URL from overwriting the current dialog state.
  useEffect(() => {
    if (!open || !url || rotating || !canvas) return;
    let cancelled = false;
    void QRCode.toCanvas(canvas, url, { width: 224, margin: 2 }).then(
      () => {
        if (!cancelled) setQrFailedUrl(null);
      },
      () => {
        if (!cancelled) setQrFailedUrl(url);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [canvas, open, url, rotating]);

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setCopyFailedUrl(null);
    } catch {
      setCopiedUrl(null);
      setCopyFailedUrl(url);
    }
  }

  async function handleShare() {
    if (!url || !navigator.share) return;
    try {
      await navigator.share({ title: "Dividimos", url });
      setSharedUrl(url);
      setShareFailedUrl(null);
    } catch (error) {
      // The share sheet closing counts as a cancel, not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSharedUrl(null);
      setShareFailedUrl(url);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={<Button type="button" variant="ghost" className="min-h-11" />}
      >
        <QrCode className="size-4" />
        Convidar
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convide o pessoal</DialogTitle>
          <DialogDescription>
            Escaneie o QR ou copie o link. Quem já tem conta entra com ela; quem não tem entra
            com um nome.
          </DialogDescription>
        </DialogHeader>

        {url && (
          <canvas
            key={url}
            ref={setCanvas}
            aria-label="QR code do convite"
            aria-hidden={rotating || qrFailed}
            hidden={rotating || qrFailed}
            width={224}
            height={224}
            className="mx-auto max-w-full rounded-xl bg-white p-2"
          />
        )}
        {qrFailed && !rotating && (
          <p role="status" className="text-sm text-muted-foreground">
            Não foi possível gerar o QR. Você ainda pode copiar o link.
          </p>
        )}

        {url === null && !rotating && (
          <p className="text-sm text-muted-foreground">
            Este aparelho não tem o convite atual. Gere um novo para compartilhar.
          </p>
        )}

        {errorMessage && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        {shareFailed && (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível compartilhar.
          </p>
        )}

        {copyFailed && (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível copiar. Tente novamente.
          </p>
        )}
        <RoomActivity
          activity={latestActivity}
          participants={participants}
          items={items}
          connected={connected}
        />

        {/* Full-width actions stack in reading order; the shared footer's row
            layout would push them past the popup edge on a wide screen. */}
        <DialogFooter className="flex-col sm:flex-col sm:justify-stretch">
          <Button
            type="button"
            className="min-h-11 w-full"
            disabled={!url || rotating}
            onClick={handleCopy}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Link copiado" : "Copiar link"}
          </Button>
          {canShare && (
            <Button
              type="button"
              className="min-h-11 w-full"
              disabled={!url || rotating}
              onClick={handleShare}
            >
              {sharedUrl === url ? <Check className="size-4" /> : <Share2 className="size-4" />}
              Compartilhar
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            onClick={() => onOpenChange(false)}
          >
            Voltar para a sala
          </Button>
        </DialogFooter>

        {url !== null && !rotating && (
          <p className="text-xs text-muted-foreground">
            O link anterior deixará de funcionar. Quem já entrou continua na sala.
          </p>
        )}
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 w-full"
          disabled={rotationDisabled || rotating}
          onClick={onRotate}
        >
          <RefreshCw className={rotating ? "size-4 animate-spin" : "size-4"} />
          {rotating ? "Gerando convite..." : url ? "Gerar novo convite" : "Gerar convite"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
