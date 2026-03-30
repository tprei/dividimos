"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, ScanLine } from "lucide-react";

export interface QrScannerViewProps {
  /** Called with the raw decoded string from any QR code */
  onDecode: (data: string) => void;
  /** Whether scanning is paused (e.g. while processing a result) */
  paused?: boolean;
}

/**
 * Live camera QR code scanner using the qr-scanner library.
 * Uses BarcodeDetector API on supported browsers (Chrome Android),
 * falls back to WASM-based decoding otherwise.
 */
export function QrScannerView({ onDecode, paused = false }: QrScannerViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<import("qr-scanner").default | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

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
        const QrScanner = (await import("qr-scanner")).default;

        if (destroyed) return;

        const scanner = new QrScanner(
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

        setStarting(false);
      } catch (err) {
        if (destroyed) return;
        setStarting(false);

        if (err instanceof DOMException && err.name === "NotAllowedError") {
          setError("Permissão de câmera negada. Habilite nas configurações do navegador.");
        } else if (err instanceof DOMException && err.name === "NotFoundError") {
          setError("Nenhuma câmera encontrada neste dispositivo.");
        } else {
          setError("Não foi possível iniciar a câmera.");
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

  // Pause/resume scanning
  useEffect(() => {
    const scanner = scannerRef.current;
    if (!scanner) return;

    if (paused) {
      scanner.pause();
    } else {
      scanner.start();
    }
  }, [paused]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-destructive/30 bg-destructive/5 p-8 text-center">
        <Camera className="h-8 w-8 text-destructive/60" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-black">
      {starting && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/80"
        >
          <ScanLine className="h-8 w-8 animate-pulse text-primary" />
          <p className="text-sm text-white/70">Iniciando câmera...</p>
        </motion.div>
      )}
      <video
        ref={videoRef}
        className="h-64 w-full object-cover"
        playsInline
        muted
      />
      {!starting && !paused && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-40 w-40 rounded-xl border-2 border-primary/50" />
        </div>
      )}
      {paused && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <p className="text-sm text-white/70">QR detectado!</p>
        </div>
      )}
    </div>
  );
}
