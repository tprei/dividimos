"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, ImagePlus, QrCode, RotateCcw, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrScannerView } from "./qr-scanner-view";
import type { NfceQrResult } from "@/lib/nfce-qr";

type Tab = "photo" | "qr";

export interface ReceiptScannerProps {
  /** Called with the captured/selected image file when user taps "Processar" */
  onProcess: (file: File) => void;
  /** Called when user wants to go back to type selection */
  onBack: () => void;
  /** Whether processing is in progress (disables button, shows spinner) */
  processing?: boolean;
  /** Called when a valid NFC-e QR code is detected */
  onQrDetected?: (result: NfceQrResult) => void;
}

export function ReceiptScanner({
  onProcess,
  onBack,
  processing = false,
  onQrDetected,
}: ReceiptScannerProps) {
  const [tab, setTab] = useState<Tab>("photo");
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [qrPaused, setQrPaused] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    const url = URL.createObjectURL(selected);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });

    // Reset the input so the same file can be re-selected
    e.target.value = "";
  }, []);

  const clearPreview = useCallback(() => {
    setFile(null);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const handleProcess = useCallback(() => {
    if (file) onProcess(file);
  }, [file, onProcess]);

  const handleQrDetected = useCallback(
    (result: NfceQrResult) => {
      setQrPaused(true);
      onQrDetected?.(result);
    },
    [onQrDetected],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
          aria-label="Voltar"
        >
          <X className="h-4 w-4" />
        </button>
        <div>
          <h2 className="text-lg font-semibold">Escanear nota</h2>
          <p className="text-sm text-muted-foreground">
            {tab === "photo"
              ? "Tire uma foto ou escolha da galeria."
              : "Aponte para o QR code da nota fiscal."}
          </p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        <button
          type="button"
          onClick={() => setTab("photo")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            tab === "photo"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Camera className="h-4 w-4" />
          Foto
        </button>
        <button
          type="button"
          onClick={() => { setTab("qr"); setQrPaused(false); }}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            tab === "qr"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <QrCode className="h-4 w-4" />
          QR Code
        </button>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
        aria-hidden="true"
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
        aria-hidden="true"
      />

      <AnimatePresence mode="wait">
        {tab === "qr" ? (
          <motion.div
            key="qr-scanner"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="space-y-2"
          >
            <QrScannerView onDetected={handleQrDetected} paused={qrPaused} />
            <p className="text-center text-xs text-muted-foreground">
              Posicione o QR code da nota dentro do quadrado
            </p>
          </motion.div>
        ) : !preview ? (
          <motion.div
            key="input-modes"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-2 gap-3"
          >
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-6 text-center transition-colors hover:border-primary/50 hover:bg-primary/10"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Camera className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-semibold">Camera</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Tirar foto agora
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-6 text-center transition-colors hover:border-primary/50 hover:bg-primary/10"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ImagePlus className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-semibold">Galeria</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Escolher foto
                </p>
              </div>
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            <div className="relative overflow-hidden rounded-2xl border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Foto da nota fiscal"
                className="max-h-80 w-full object-contain"
              />
              <button
                type="button"
                onClick={clearPreview}
                disabled={processing}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 disabled:opacity-50"
                aria-label="Remover foto"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={clearPreview}
                disabled={processing}
              >
                <RotateCcw className="h-4 w-4" />
                Trocar foto
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleProcess}
                disabled={processing}
              >
                {processing ? (
                  <ScanLine className="h-4 w-4 animate-pulse" />
                ) : (
                  <ScanLine className="h-4 w-4" />
                )}
                {processing ? "Processando..." : "Processar"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
