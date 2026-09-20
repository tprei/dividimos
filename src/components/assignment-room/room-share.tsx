"use client";

import QRCode from "qrcode";
import { Check, Copy, QrCode, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useBackHandler } from "@/hooks/use-back-handler";

interface RoomShareProps {
  url: string | null;
  rotating: boolean;
  onRotate: () => void;
}

export function RoomShare({ url, rotating, onRotate }: RoomShareProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wasOpenRef = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    setCopied(false);
    setCopyFailed(false);
  }, []);
  useBackHandler(open, close);

  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open || !url || !canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, url, { width: 224, margin: 2 });
  }, [open, url]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close, open]);

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  if (!open) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className="min-h-11 w-full"
        onClick={() => setOpen(true)}
      >
        <QrCode className="size-4" />
        Mostrar convite
      </Button>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4" aria-label="Convite da sala">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading font-semibold">Convide o pessoal</h2>
          <p className="text-sm text-muted-foreground">Mostre o QR ou copie o link.</p>
        </div>
        <Button type="button" size="icon" variant="ghost" className="min-h-11 min-w-11" onClick={close}>
          <X className="size-4" />
          <span className="sr-only">Recolher convite</span>
        </Button>
      </div>

      {url ? (
        <div className="space-y-3 text-center">
          <canvas ref={canvasRef} className="mx-auto max-w-full rounded-xl bg-white p-2" aria-label="QR code do convite" />
          <Button type="button" variant="outline" className="min-h-11 w-full" onClick={handleCopy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Link copiado" : "Copiar link"}
          </Button>
          {copyFailed && <p role="alert" className="text-sm text-destructive">Não foi possível copiar. Tente novamente.</p>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Gere um novo convite para continuar compartilhando.</p>
      )}

      <Button type="button" variant="ghost" className="min-h-11 w-full" disabled={rotating} onClick={onRotate}>
        <RefreshCw className={rotating ? "size-4 animate-spin" : "size-4"} />
        {rotating ? "Gerando novo convite..." : "Gerar novo convite"}
      </Button>
    </section>
  );
}
