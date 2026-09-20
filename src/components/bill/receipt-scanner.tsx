"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, ImagePlus, RotateCcw, ScanLine, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { ReceiptCameraView } from "@/components/bill/receipt-camera-view";
import { Button } from "@/components/ui/button";
import {
  pickNativeGalleryPhoto,
  takeNativePhoto,
  type PhotoOutcome,
} from "@/lib/capacitor/camera";

export interface ReceiptScannerProps {
  /** Called with the captured/selected image file when user taps "Processar" */
  onProcess: (file: File) => void;
  /** Called when user wants to go back to type selection */
  onBack: () => void;
  /** Whether processing is in progress (disables button, shows spinner) */
  processing?: boolean;
  /** Opening surface: `camera` starts the camera right away, `picker` shows the chooser. */
  initialSource?: "camera" | "picker";
}

/** Where the current preview photo came from; decides what "Trocar foto" reopens. */
type FileOrigin = "camera" | "picker";

export function ReceiptScanner({
  onProcess,
  onBack,
  processing = false,
  initialSource = "picker",
}: ReceiptScannerProps) {
  const isAndroid = Capacitor.getPlatform() === "android";
  const openWithCamera = initialSource === "camera";
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileOrigin, setFileOrigin] = useState<FileOrigin | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(openWithCamera && !isAndroid);
  const [nativeCamera, setNativeCamera] = useState(openWithCamera && isAndroid);
  const galleryRef = useRef<HTMLInputElement>(null);
  /**
   * The one in-flight native camera promise for the current entry intent. A
   * StrictMode effect replay attaches a fresh handler to this same promise
   * instead of launching a second camera or dropping the result; a retake
   * replaces it with a new intent.
   */
  const nativeIntentRef = useRef<Promise<PhotoOutcome> | null>(null);

  // Mirror for revoking the preview URL on unmount. StrictMode double-runs
  // mount cleanups while state survives, so the cleanup reads the mirror
  // (null at mount) instead of revoking a URL the state still references.
  const previewRef = useRef(preview);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const showFile = useCallback((next: File, origin: FileOrigin) => {
    setFile(next);
    setFileOrigin(origin);
    setCaptureError(null);
    // A photo exists now, so the live camera has nothing left to do; leaving
    // it mounted would keep it stacked over the preview and Processar.
    setCameraOpen(false);
    const url = URL.createObjectURL(next);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, []);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (!selected) return;

      showFile(selected, "picker");

      // Reset the input so the same file can be re-selected
      e.target.value = "";
    },
    [showFile],
  );

  const clearPreview = useCallback(() => {
    setFile(null);
    setFileOrigin(null);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const handleProcess = useCallback(() => {
    if (file) onProcess(file);
  }, [file, onProcess]);

  const applyNativeOutcome = useCallback(
    (outcome: PhotoOutcome) => {
      if (outcome.kind === "captured") {
        showFile(outcome.file, "camera");
        return;
      }

      // Backing out is a choice, so it stays silent. Anything else left the
      // user tapping a button that appeared to do nothing.
      if (outcome.kind === "cancelled") return;
      setCaptureError(
        outcome.kind === "permission_denied"
          ? "Permita o acesso à câmera nas configurações do aparelho."
          : outcome.message,
      );
    },
    [showFile],
  );

  // Native camera entry: launch exactly one capture per intent, deliver the
  // outcome exactly once, and ignore handlers from StrictMode replays
  // (cleaned up) or superseded intents.
  useEffect(() => {
    if (!nativeCamera) return;
    if (nativeIntentRef.current === null) {
      nativeIntentRef.current = takeNativePhoto();
    }
    const intent = nativeIntentRef.current;
    let active = true;
    void intent.then(
      (outcome) => {
        if (!active || nativeIntentRef.current !== intent) return;
        nativeIntentRef.current = null;
        setNativeCamera(false);
        applyNativeOutcome(outcome);
      },
      () => {
        if (!active || nativeIntentRef.current !== intent) return;
        nativeIntentRef.current = null;
        setNativeCamera(false);
        setCaptureError("Não foi possível abrir a câmera.");
      },
    );
    return () => {
      active = false;
    };
  }, [nativeCamera, applyNativeOutcome]);

  const startWebCamera = useCallback(() => {
    setCaptureError(null);
    setCameraOpen(true);
  }, []);

  const startNativeCamera = useCallback(() => {
    setCaptureError(null);
    setNativeCamera(true);
  }, []);

  const handleCameraCapture = useCallback(
    (captured: File) => {
      setCameraOpen(false);
      showFile(captured, "camera");
    },
    [showFile],
  );

  // The gallery must open inside the user gesture, so the camera stops and
  // the hidden input is clicked synchronously in the same event.
  const handleCameraGallery = useCallback(() => {
    setCameraOpen(false);
    galleryRef.current?.click();
  }, []);

  const handleCameraClose = useCallback(() => {
    setCameraOpen(false);
  }, []);

  const handleNativeGallery = useCallback(() => {
    void pickNativeGalleryPhoto().then(
      (outcome) => {
        if (outcome.kind === "captured") {
          showFile(outcome.file, "picker");
          return;
        }
        if (outcome.kind === "cancelled") return;
        setCaptureError(
          outcome.kind === "permission_denied"
            ? "Permita o acesso à câmera nas configurações do aparelho."
            : outcome.message,
        );
      },
      () => setCaptureError("Não foi possível abrir a câmera."),
    );
  }, [showFile]);

  const handleRetake = useCallback(() => {
    const fromCamera = fileOrigin === "camera";
    clearPreview();
    if (fromCamera) {
      if (isAndroid) startNativeCamera();
      else startWebCamera();
    }
  }, [clearPreview, fileOrigin, isAndroid, startNativeCamera, startWebCamera]);

  return (
    <div className="space-y-4">
      {captureError !== null && (
        <p role="alert" className="text-sm text-destructive">
          {captureError}
        </p>
      )}
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
            Tire uma foto ou escolha da galeria.
          </p>
        </div>
      </div>

      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
        aria-hidden="true"
      />
      <AnimatePresence mode="wait">
        {cameraOpen ? (
          <motion.div
            key="camera"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            <ReceiptCameraView
              onCapture={handleCameraCapture}
              onGallery={handleCameraGallery}
              onClose={handleCameraClose}
            />
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
              onClick={isAndroid ? startNativeCamera : startWebCamera}
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
              onClick={
                isAndroid
                  ? handleNativeGallery
                  : () => galleryRef.current?.click()
              }
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
                onClick={handleRetake}
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
