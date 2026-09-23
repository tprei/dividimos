"use client";

import { Check, Copy, QrCode, RefreshCw, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { RoomActivity } from "@/components/assignment-room/room-activity";
import { Button } from "@/components/ui/button";
import { useClientOnly } from "@/hooks/use-client-only";
import { copyText } from "@/lib/platform/clipboard";
import { isShareSupported, shareLink } from "@/lib/platform/share";
import { qrToCanvas } from "@/lib/qr";
import type {
  AssignmentRoomActivity,
  AssignmentRoomItem,
  AssignmentRoomParticipant,
} from "@/types/assignment-room";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  const canShare = useClientOnly(isShareSupported);

  // The QR stays hidden while a rotation is in flight so an old code is never
  // presented as current. The cancellation flag keeps a completion from an
  // older URL from overwriting the current dialog state.
  useEffect(() => {
    if (!open || !url || rotating || !canvas) return;
    let cancelled = false;
    void qrToCanvas(canvas, url, { width: 224, margin: 2 }).then(
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
    if (await copyText(url)) {
      setCopiedUrl(url);
      setCopyFailedUrl(null);
    } else {
      setCopiedUrl(null);
      setCopyFailedUrl(url);
    }
  }

  async function handleShare() {
    if (!url || !canShare) return;
    const outcome = await shareLink({ title: "Dividimos", url });
    if (outcome === "shared") {
      setSharedUrl(url);
      setShareFailedUrl(null);
    } else if (outcome === "unsupported") {
      setSharedUrl(null);
      setShareFailedUrl(url);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={<Button type="button" variant="ghost" className="min-h-11 min-w-11 px-0 sm:px-3" />}
      >
        <QrCode className="size-4" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Convidar</span>
      </DialogTrigger>
      <DialogContent variant="sheet">
        <DialogHeader className="gap-1">
          <DialogTitle>Sala de itens</DialogTitle>
          <DialogDescription>Cada pessoa marca o que consumiu</DialogDescription>
        </DialogHeader>

        {url && (
          <div className="space-y-3">
            <div className="flex min-h-64 items-center justify-center rounded-2xl border bg-card p-4">
              <canvas
                key={url}
                ref={setCanvas}
                aria-label="QR code do convite"
                aria-hidden={rotating || qrFailed}
                hidden={rotating || qrFailed}
                width={224}
                height={224}
                className="max-w-full rounded-lg"
              />
              {rotating && (
                <p role="status" className="text-sm text-muted-foreground">Gerando convite...</p>
              )}
              {qrFailed && !rotating && (
                <p role="status" className="text-center text-sm text-muted-foreground">
                  Não foi possível gerar o QR. Você ainda pode copiar o link.
                </p>
              )}
            </div>
            <p className="text-center text-xs text-muted-foreground">Aponte a câmera do celular</p>
          </div>
        )}

        {url === null && (
          <p className="text-sm text-muted-foreground">
            Gere um convite pra mostrar o QR.
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

        <div className="space-y-2">
          <div className="flex gap-2">
            {canShare && (
              <Button
                type="button"
                variant="outline"
                className="min-h-12 min-w-0 flex-1 gap-2 motion-reduce:transform-none motion-reduce:transition-none"
                disabled={!url || rotating}
                onClick={handleShare}
              >
                {sharedUrl === url ? <Check className="size-4" aria-hidden="true" /> : <Share2 className="size-4" aria-hidden="true" />}
                Compartilhar
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="min-h-12 min-w-0 flex-1 gap-2 motion-reduce:transform-none motion-reduce:transition-none"
              disabled={!url || rotating}
              onClick={handleCopy}
            >
              {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              {copied ? "Link copiado" : "Copiar link"}
            </Button>
          </div>
          {url ? (
            <Button
              type="button"
              className="min-h-12 w-full font-semibold motion-reduce:transform-none motion-reduce:transition-none"
              onClick={() => onOpenChange(false)}
            >
              Entrar na sala
            </Button>
          ) : (
            <Button
              type="button"
              className="min-h-12 w-full font-semibold motion-reduce:transform-none motion-reduce:transition-none"
              disabled={rotationDisabled || rotating}
              onClick={onRotate}
            >
              {rotating ? "Gerando convite..." : "Gerar convite"}
            </Button>
          )}
          {url && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 w-full text-xs text-muted-foreground motion-reduce:transform-none motion-reduce:transition-none"
              disabled={rotationDisabled || rotating}
              onClick={onRotate}
            >
              <RefreshCw className={rotating ? "size-3.5 motion-safe:animate-spin" : "size-3.5"} aria-hidden="true" />
              {rotating ? "Gerando convite..." : "Gerar novo link"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
