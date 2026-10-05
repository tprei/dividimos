"use client";

import { Check, Clock3, Copy, MessageCircle, QrCode, RefreshCw, Share2, Ticket } from "lucide-react";
import { useEffect, useState } from "react";
import { RoomActivity } from "@/components/assignment-room/room-activity";
import { RoomCodeTiles } from "@/components/assignment-room/room-code-tiles";
import { Button } from "@/components/ui/button";
import { useClientOnly } from "@/hooks/use-client-only";
import { haptics } from "@/hooks/use-haptics";
import { copyText } from "@/lib/platform/clipboard";
import { isShareSupported, shareLink } from "@/lib/platform/share";
import { qrToCanvas } from "@/lib/qr";
import type {
  AssignmentRoomActivity,
  AssignmentRoomCodeState,
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
  code: AssignmentRoomCodeState;
  codeEntryAddress: string | null;
  onRetryCode: () => void;
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
  code,
  codeEntryAddress,
  onRetryCode,
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
  const spokenCode: AssignmentRoomCodeState =
    rotating && code.status === "ready" ? { status: "issuing" } : code;

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
      haptics.success();
      setCopiedUrl(url);
      setCopyFailedUrl(null);
    } else {
      haptics.error();
      setCopiedUrl(null);
      setCopyFailedUrl(url);
    }
  }

  async function handleShare() {
    if (!url || !canShare) return;
    const outcome = await shareLink({ title: "Dividimos", url });
    if (outcome === "shared") {
      haptics.success();
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
      <DialogContent showCloseButton={!url} className="gap-4 [&>[data-slot=dialog-close]]:min-h-11 [&>[data-slot=dialog-close]]:min-w-11">
        <DialogHeader className="shrink-0 flex-row items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary-text">
            <Ticket className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <DialogTitle>Sala de itens</DialogTitle>
            <DialogDescription className="leading-snug">Cada pessoa marca o que consumiu</DialogDescription>
          </div>
        </DialogHeader>

        <div className="min-w-0 shrink-0 rounded-2xl border border-border bg-muted/30">
          {url && (
            <div className="flex flex-col items-center gap-2 px-3 py-3">
              <div className="flex size-54 max-w-full items-center justify-center rounded-2xl border border-border bg-paper p-2 text-primary-foreground">
                <canvas
                  key={url}
                  ref={setCanvas}
                  aria-label="QR code do convite"
                  aria-hidden={rotating || qrFailed}
                  hidden={rotating || qrFailed}
                  width={224}
                  height={224}
                  className="size-48! max-w-full rounded-lg"
                />
                {rotating && (
                  <p role="status" className="text-sm">Gerando convite...</p>
                )}
                {qrFailed && !rotating && (
                  <p role="status" className="text-center text-sm">
                    Não foi possível gerar o QR. Você ainda pode copiar o link.
                  </p>
                )}
              </div>
              <p className="text-center text-sm font-medium leading-snug">
                Aponte a câmera pra entrar
              </p>
            </div>
          )}

          {url === null && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Gere um convite pra mostrar o QR.
            </p>
          )}

          {spokenCode.status !== "idle" && (
            <section className="min-w-0 space-y-3 rounded-b-2xl border-t border-dashed border-primary/30 bg-primary/10 p-3" aria-labelledby="room-share-code-heading">
              <h3 id="room-share-code-heading" className="flex items-center gap-2 text-sm font-semibold">
                <MessageCircle className="size-4 text-primary-text" aria-hidden="true" />
                Ou fala o código
              </h3>
              {spokenCode.status === "ready" && (
                <>
                  <div role="group" aria-labelledby="room-share-code-value">
                    <span id="room-share-code-value" className="sr-only">{spokenCode.display}</span>
                    <RoomCodeTiles words={spokenCode.display.split("-") as [string, string]} />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm leading-snug text-muted-foreground">
                      {codeEntryAddress ? (
                        <>Quem for entrar abre <span className="font-semibold text-foreground wrap-anywhere">{codeEntryAddress}</span> e digita.</>
                      ) : (
                        <>Quem for entrar digita o código.</>
                      )}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs leading-relaxed text-muted-foreground">
                      <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                      Vale por 15 minutos.
                    </p>
                  </div>
                </>
              )}
              {spokenCode.status === "issuing" && (
                <>
                  <RoomCodeTiles words={["", ""]} loading />
                  <p role="status" className="text-sm text-muted-foreground">Gerando código...</p>
                </>
              )}
              {spokenCode.status === "error" && (
                <div className="space-y-2">
                  <p role="alert" className="text-sm text-destructive-text">{spokenCode.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 motion-reduce:transform-none motion-reduce:transition-none"
                    onClick={onRetryCode}
                  >
                    Tentar de novo
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>

        {errorMessage && (
          <p role="alert" className="text-sm text-destructive-text">
            {errorMessage}
          </p>
        )}

        {shareFailed && (
          <p role="alert" className="text-sm text-destructive-text">
            Não foi possível compartilhar.
          </p>
        )}

        {copyFailed && (
          <p role="alert" className="text-sm text-destructive-text">
            Não foi possível copiar. Tente novamente.
          </p>
        )}
        <RoomActivity
          activity={latestActivity}
          participants={participants}
          items={items}
          connected={connected}
        />

        <div className="-mx-4 -mb-4 shrink-0 space-y-2 rounded-b-2xl border-t bg-muted/30 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {canShare && (
              <Button
                type="button"
                variant="outline"
                className="min-h-12 min-w-0 flex-1 basis-36 gap-2 px-3 motion-reduce:transform-none motion-reduce:transition-none"
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
              className="min-h-12 min-w-0 flex-1 basis-36 gap-2 px-3 motion-reduce:transform-none motion-reduce:transition-none"
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
