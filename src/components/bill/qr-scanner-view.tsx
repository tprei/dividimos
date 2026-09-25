"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, ScanLine } from "lucide-react";
import type QrScanner from "qr-scanner";
import { Button } from "@/components/ui/button";
import { popIn } from "@/lib/animations";
import { cn } from "@/lib/utils";

export interface QrScannerViewProps {
  /** Called with the raw decoded string from any QR code */
  onDecode: (data: string) => void;
  /** Whether scanning is paused (e.g. while processing a result) */
  paused?: boolean;
  /**
   * Shrinks the camera to a one-line strip and releases it, e.g. while a code
   * is typed by hand, so the field stays above the keyboard.
   */
  collapsed?: boolean;
  /** Offered on the collapsed strip to bring the camera back. */
  onExpand?: () => void;
}

const START_FAILED = "Não foi possível iniciar a câmera.";

/**
 * Live camera QR code scanner using the qr-scanner library.
 * Uses BarcodeDetector API on supported browsers (Chrome Android),
 * falls back to WASM-based decoding otherwise.
 */
export function QrScannerView({ onDecode, paused = false, collapsed = false, onExpand }: QrScannerViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const suspended = paused || collapsed;
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;

  // Stable callback ref to avoid re-creating scanner on every render
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;

  const handleDecode = useCallback((result: { data: string }) => {
    onDecodeRef.current(result.data);
  }, []);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    let destroyed = false;

    async function init() {
      try {
        // Dynamic import to avoid SSR issues with qr-scanner (uses Worker + DOM APIs)
        const QrScannerCtor = (await import("qr-scanner")).default;

        if (destroyed) return;

        const scanner = new QrScannerCtor(
          videoEl!,
          (result) => handleDecode(result),
          {
            preferredCamera: "environment",
            maxScansPerSecond: 5,
            highlightScanRegion: false,
            highlightCodeOutline: false,
            returnDetailedScanResult: true,
          },
        );

        scannerRef.current = scanner;
        await scanner.start();

        if (destroyed) {
          scanner.destroy();
          return;
        }
        // The camera may have been collapsed while permission was pending.
        if (suspendedRef.current) void scanner.pause(true);

        setStarting(false);
      } catch (err) {
        if (destroyed) return;
        setStarting(false);

        if (err instanceof DOMException && err.name === "NotAllowedError") {
          setError("Permissão de câmera negada. Habilite nas configurações do navegador.");
        } else if (err instanceof DOMException && err.name === "NotFoundError") {
          setError("Nenhuma câmera encontrada neste dispositivo.");
        } else {
          setError(START_FAILED);
        }
      }
    }

    init();

    return () => {
      destroyed = true;
      if (scannerRef.current) {
        scannerRef.current.destroy();
        scannerRef.current = null;
      }
    };
  }, [handleDecode]);

  useEffect(() => {
    const scanner = scannerRef.current;
    if (!scanner) return;

    // Collapsing releases the camera at once (no light left on behind the
    // keyboard); a result pause keeps it warm for the next scan.
    if (suspended) void scanner.pause(collapsed);
    else scanner.start().catch(() => setError(START_FAILED));
  }, [suspended, collapsed]);

  if (error) {
    return (
      <div className={cn(
        "flex items-center rounded-2xl border border-dashed border-destructive/30 bg-destructive/5 text-center",
        collapsed ? "gap-2 p-3 text-left" : "flex-col gap-3 p-8",
      )}>
        <Camera className={cn("shrink-0 text-destructive-text", collapsed ? "size-4" : "size-8")} />
        <p role="alert" className="text-sm text-destructive-text">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-muted">
      {starting && !collapsed && (
        <motion.div
          variants={popIn} initial="hidden" animate="visible"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/90"
        >
          <ScanLine className="h-8 w-8 motion-safe:animate-pulse text-primary" />
          <p className="text-sm">Iniciando câmera…</p>
        </motion.div>
      )}
      <video
        ref={videoRef}
        className={cn(
          "w-full object-cover transition-[height,min-height] duration-300 ease-out motion-reduce:transition-none",
          collapsed ? "h-14 min-h-0" : "h-[min(60svh,24rem)] min-h-44",
        )}
        playsInline
        muted
      />
      {!starting && !suspended && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-40 w-40 rounded-xl border-2 border-primary/50" />
        </div>
      )}
      {paused && !collapsed && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/90">
          <p role="status" className="text-sm font-semibold">QR detectado</p>
        </div>
      )}
      {collapsed && (
        <div className="absolute inset-0 flex items-center gap-3 bg-card pr-2 pl-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary-text">
            <Camera className="size-4" aria-hidden="true" />
          </span>
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">Câmera pausada</p>
          {onExpand && (
            <Button type="button" variant="ghost" className="h-11 shrink-0 text-primary-text" onClick={onExpand}>
              Mostrar câmera
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
