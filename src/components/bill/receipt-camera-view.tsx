"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ReceiptCameraViewProps {
  /** Called with the captured JPEG when the user taps the shutter. */
  onCapture: (file: File) => void;
  /** Called when the user picks the gallery; must run inside the click gesture. */
  onGallery: () => void;
  /** Called when the user closes the camera without capturing. */
  onClose: () => void;
}

type CameraStatus = "starting" | "ready" | "error";

/** Rear camera when available; the device falls back to whatever it offers. */
const CAPTURE_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" } },
  audio: false,
};

const CAPTURE_ERROR_MESSAGE = "Não foi possível capturar a foto. Tente novamente.";
const PAUSED_ERROR_MESSAGE =
  "A câmera foi pausada. Toque em tentar novamente para voltar.";

/** Maps a getUserMedia failure to a PT-BR message with a next step. */
function describeCameraError(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Permita o acesso à câmera para tirar uma foto.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Nenhuma câmera foi encontrada neste aparelho.";
  }
  if (name === "NotReadableError") {
    return "A câmera está em uso por outro aplicativo.";
  }
  if (name === "CameraUnavailableError") {
    return "A câmera não está disponível nesta conexão. Escolha uma foto da galeria ou abra o app em https.";
  }
  return "Não foi possível abrir a câmera.";
}

/**
 * Live rear-camera photo capture for receipt scanning. Every exit (capture,
 * gallery, close, unmount, hidden tab, late permission grant) releases the
 * stream, and returning to the camera is always an explicit retry.
 */
export function ReceiptCameraView({
  onCapture,
  onGallery,
  onClose,
}: ReceiptCameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Bumped on every teardown so a late-resolving getUserMedia knows its
  // result is no longer wanted and releases the camera immediately.
  const streamGenerationRef = useRef(0);
  const [status, setStatus] = useState<CameraStatus>("starting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Mirror for the visibility listener, which must not resubscribe on
  // every status change.
  const statusRef = useRef<CameraStatus>(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const stopStream = useCallback(() => {
    streamGenerationRef.current += 1;
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }, []);

  const fail = useCallback(
    (message: string) => {
      stopStream();
      setStatus("error");
      setErrorMessage(message);
    },
    [stopStream],
  );

  const startCamera = useCallback(() => {
    const mediaDevices = navigator.mediaDevices;
    const generation = streamGenerationRef.current;
    // Every state change lives inside the promise callbacks: the effect
    // that calls this must stay free of synchronous setState.
    const request =
      mediaDevices && typeof mediaDevices.getUserMedia === "function"
        ? mediaDevices.getUserMedia(CAPTURE_CONSTRAINTS)
        : Promise.reject(
            Object.assign(new Error("getUserMedia indisponível"), {
              name: "CameraUnavailableError",
            }),
          );
    void request.then(
      (stream) => {
        if (generation !== streamGenerationRef.current) {
          // Resolved after a stop (unmount, hidden tab, retry): release it.
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          try {
            const playback = video.play();
            if (playback) playback.catch(() => {});
          } catch {
            // Autoplay refusal must not break the camera preview.
          }
        }
      },
      (cause: unknown) => {
        if (generation !== streamGenerationRef.current) return;
        setStatus("error");
        setErrorMessage(describeCameraError(cause));
      },
    );
  }, []);

  useEffect(() => {
    startCamera();
    return stopStream;
  }, [attempt, startCamera, stopStream]);

  // Releasing the camera when the tab or app goes to the background keeps no
  // stream alive unnoticed; coming back is an explicit retry.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      if (streamRef.current === null && statusRef.current !== "starting") return;
      fail(PAUSED_ERROR_MESSAGE);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [fail]);

  const handleVideoReady = useCallback(() => {
    const video = videoRef.current;
    // Capture stays disabled until the stream delivers real dimensions.
    if (video && video.videoWidth > 0 && streamRef.current !== null) {
      setStatus("ready");
    }
  }, []);
  const handleGallery = useCallback(() => {
    stopStream();
    onGallery();
  }, [onGallery, stopStream]);

  const handleClose = useCallback(() => {
    stopStream();
    onClose();
  }, [onClose, stopStream]);

  const handleRetry = useCallback(() => {
    setStatus("starting");
    setErrorMessage(null);
    setAttempt((current) => current + 1);
  }, []);

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      fail(CAPTURE_ERROR_MESSAGE);
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        // The camera's job is done either way: release it before reporting.
        stopStream();
        if (!blob) {
          setStatus("error");
          setErrorMessage(CAPTURE_ERROR_MESSAGE);
          return;
        }
        onCapture(new File([blob], "nota-fiscal.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  }, [fail, onCapture, stopStream]);

  if (status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-destructive/30 bg-destructive/5 p-6 text-center">
        <CameraOff className="h-8 w-8 text-destructive/60" />
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
        <div className="flex w-full flex-col gap-2">
          <Button type="button" onClick={handleRetry}>
            Tentar novamente
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={handleGallery}
          >
            <ImagePlus className="h-4 w-4" />
            Galeria
          </Button>
          <Button type="button" variant="ghost" onClick={handleClose}>
            Voltar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border bg-black">
        <video
          ref={videoRef}
          className="h-64 w-full object-cover"
          autoPlay
          playsInline
          muted
          onLoadedMetadata={handleVideoReady}
          data-testid="receipt-camera-video"
        />
        {status === "starting" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/80">
            <Camera className="h-8 w-8 animate-pulse text-primary" />
            <p className="text-sm text-white/70">Iniciando câmera...</p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={handleGallery}
        >
          <ImagePlus className="h-4 w-4" />
          Galeria
        </Button>
        <button
          type="button"
          onClick={handleCapture}
          disabled={status !== "ready"}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform active:scale-95 disabled:opacity-40"
          aria-label="Capturar foto"
        >
          <Camera className="h-5 w-5" />
        </button>
        <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}
