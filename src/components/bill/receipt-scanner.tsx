"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Camera, ImagePlus, RotateCcw, ScanLine, X } from "lucide-react";
import { ReceiptCameraView } from "@/components/bill/receipt-camera-view";
import { ReceiptCaptureArt } from "@/components/bill/receipt-capture-art";
import { OpenAppSettingsButton } from "@/components/shared/open-app-settings-button";
import { Button } from "@/components/ui/button";
import { haptics } from "@/hooks/use-haptics";
import { useAiConsent } from "@/hooks/use-ai-consent";
import { fade, popIn } from "@/lib/animations";
import { opensAppSettings } from "@/lib/capacitor/app-settings";
import {
  isNativeCameraAvailable,
  pickNativeGalleryPhoto,
  picksGalleryNatively,
  takeNativePhoto,
  type PhotoOutcome,
} from "@/lib/capacitor/camera";

const CAMERA_DENIED_MESSAGE = "Permita o acesso à câmera nas configurações do aparelho.";
const IOS_CAMERA_DENIED_MESSAGE = "Permita o acesso à câmera nos Ajustes.";

function cameraDeniedMessage(): string {
  return opensAppSettings() ? IOS_CAMERA_DENIED_MESSAGE : CAMERA_DENIED_MESSAGE;
}

export interface ReceiptScannerProps {
  /** Called with the captured/selected image file when user taps "Processar" */
  onProcess: (file: File) => void;
  /** Called when user wants to go back to type selection */
  onBack: () => void;
  /** Whether processing is in progress (disables button, shows spinner) */
  processing?: boolean;
}

export function ReceiptScanner({
  onProcess,
  onBack,
  processing = false,
}: ReceiptScannerProps) {
  const isNative = isNativeCameraAvailable();
  const nativeGallery = picksGalleryNatively();
  const { granted } = useAiConsent();
  const reducedMotion = useReducedMotion();
  const entrance = reducedMotion ? fade : popIn;
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(!isNative);
  const [nativeCamera, setNativeCamera] = useState(isNative);
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

  const showFile = useCallback((next: File) => {
    if (!granted) return;
    haptics.success();
    setFile(next);
    setCaptureError(null);
    // A photo exists now, so the live camera has nothing left to do; leaving
    // it mounted would keep it stacked over the preview and Processar.
    setCameraOpen(false);
    const url = URL.createObjectURL(next);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, [granted]);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (!selected) return;

      showFile(selected);

      // Reset the input so the same file can be re-selected
      e.target.value = "";
    },
    [showFile],
  );

  const clearPreview = useCallback(() => {
    setFile(null);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const handleProcess = useCallback(() => {
    if (file && granted) onProcess(file);
  }, [file, granted, onProcess]);

  const applyNativeOutcome = useCallback(
    (outcome: PhotoOutcome) => {
      if (outcome.kind === "captured") {
        showFile(outcome.file);
        return;
      }

      // Backing out of the native camera lands on the choice screen below,
      // where the user can retry the camera or pick from the gallery.
      if (outcome.kind === "cancelled") {
        setCaptureError(null);
        return;
      }
      haptics.error();
      setCaptureError(outcome.kind === "permission_denied" ? cameraDeniedMessage() : outcome.message);
    },
    [showFile],
  );

  // Native camera entry: launch exactly one capture per intent, deliver the
  // outcome exactly once, and ignore handlers from StrictMode replays
  // (cleaned up) or superseded intents.
  useEffect(() => {
    if (!nativeCamera || !granted) return;
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
  }, [nativeCamera, granted, applyNativeOutcome]);

  const startWebCamera = useCallback(() => {
    if (!granted) return;
    setCaptureError(null);
    setCameraOpen(true);
  }, [granted]);

  const startNativeCamera = useCallback(() => {
    if (!granted) return;
    setCaptureError(null);
    setNativeCamera(true);
  }, [granted]);

  const handleCameraCapture = useCallback(
    (captured: File) => {
      setCameraOpen(false);
      showFile(captured);
    },
    [showFile],
  );

  // The gallery must open inside the user gesture, so the camera stops and
  // the hidden input is clicked synchronously in the same event.
  const handleCameraGallery = useCallback(() => {
    if (!granted) return;
    setCameraOpen(false);
    galleryRef.current?.click();
  }, [granted]);

  const handleNativeGallery = useCallback(() => {
    if (!granted) return;
    void pickNativeGalleryPhoto().then(
      (outcome) => {
        if (outcome.kind === "captured") {
          showFile(outcome.file);
          return;
        }
        if (outcome.kind === "cancelled") return;
        setCaptureError(
          outcome.kind === "permission_denied"
            ? "Permita o acesso às fotos nas configurações do aparelho."
            : outcome.message,
        );
      },
      () => setCaptureError("Não foi possível abrir a galeria."),
    );
  }, [granted, showFile]);

  const handleRetake = useCallback(() => {
    clearPreview();
    if (isNative) startNativeCamera();
    else startWebCamera();
  }, [clearPreview, isNative, startNativeCamera, startWebCamera]);

  if (!granted) {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed">
          Permita o uso de IA antes de escanear uma nota.
        </p>
        <Button variant="outline" className="min-h-11 w-full" onClick={onBack}>
          Voltar e preencher manualmente
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {captureError !== null && (
        <div role="alert" className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive-text">
          {captureError}
        </div>
      )}
      {captureError === IOS_CAMERA_DENIED_MESSAGE && <OpenAppSettingsButton />}

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
            variants={entrance} initial="hidden" animate="visible" exit="exit"
          >
            <ReceiptCameraView
              onCapture={handleCameraCapture}
              onGallery={handleCameraGallery}
              onClose={onBack}
            />
          </motion.div>
        ) : preview ? (
          <motion.div
            key="preview"
            variants={entrance} initial="hidden" animate="visible" exit="exit"
            className="mx-auto flex min-h-[calc(var(--app-viewport-height)-8rem)] max-w-sm flex-col justify-center gap-6 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <div className="relative overflow-hidden rounded-2xl border bg-muted">
              <img
                src={preview}
                alt="Foto da nota fiscal"
                className="h-[min(48dvh,24rem)] w-full object-contain p-4"
              />
              <button
                type="button"
                onClick={clearPreview}
                disabled={processing}
                className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-full bg-background text-foreground shadow disabled:opacity-50"
                aria-label="Remover foto"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3">
              <Button
                variant="outline"
                className="min-h-12 gap-2"
                onClick={handleRetake}
                disabled={processing}
              >
                <RotateCcw className="h-4 w-4" />
                Trocar foto
              </Button>
              <Button
                className="min-h-14 gap-2 text-base"
                onClick={handleProcess}
                disabled={processing}
              >
                {processing ? (
                  <ScanLine className="h-4 w-4 motion-safe:animate-pulse" />
                ) : (
                  <ScanLine className="h-4 w-4" />
                )}
                {processing ? "Processando..." : "Processar"}
              </Button>
            </div>
          </motion.div>
        ) : nativeCamera ? null : (
          <motion.div
            key="fallback"
            variants={entrance} initial="hidden" animate="visible" exit="exit"
            className="mx-auto flex min-h-[calc(var(--app-viewport-height)-8rem)] w-full max-w-sm flex-col justify-center gap-8 pb-[max(1rem,env(safe-area-inset-bottom))] compact:gap-4"
          >
            <div className="text-center">
              <ReceiptCaptureArt />
              <h2 className="mt-4 text-xl font-bold tracking-tight">Sua nota, sem digitar</h2>
            </div>
            <div className="grid gap-3">
              <Button
                className="min-h-14 w-full gap-2 text-base"
                onClick={isNative ? startNativeCamera : startWebCamera}
              >
                <Camera className="size-5" />
                Tirar foto
              </Button>
              <Button
                variant="outline"
                className="min-h-12 w-full gap-2"
                onClick={nativeGallery ? handleNativeGallery : handleCameraGallery}
              >
                <ImagePlus className="size-5" />
                Escolher da galeria
              </Button>
              <Button
                variant="ghost"
                className="min-h-11 w-full"
                onClick={onBack}
              >
                Voltar
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
