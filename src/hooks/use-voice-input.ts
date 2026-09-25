"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isNativeSpeechAvailable,
  isNativeSpeechSupported,
  startNativeListening,
} from "@/lib/capacitor/speech";
import { haptics } from "@/hooks/use-haptics";
import {
  isAppleMobileWebKit,
  pickSpeechEngine,
  type SpeechEngine,
} from "@/lib/speech-engine";
import { transcribeVoiceAudio } from "@/lib/sync/voice";

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
    webkitAudioContext?: typeof AudioContext;
  }
}

function getSpeechRecognitionConstructor():
  | (new () => SpeechRecognition)
  | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Libere o microfone nas configurações.",
  "no-speech": "Nenhuma fala detectada. Tente novamente.",
  network: "Erro de rede. Verifique sua conexão.",
  "audio-capture": "Nenhum microfone encontrado.",
  aborted: "",
};

const SILENCE_TIMEOUT_MS = 3000;

/** MediaRecorder mime candidates, most iOS-friendly first. */
const RECORDER_MIME_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
/** Silence that ends a recording after at least one voiced frame. */
const RECORDER_SILENCE_MS = 1800;
const RECORDER_HARD_CAP_MS = 15_000;
const RECORDER_SPEECH_RMS = 0.015;
/** Maps raw RMS (spoken speech sits around 0.05-0.3) onto the 0..1 level. */
const RECORDER_LEVEL_GAIN = 3;
const LEVEL_UPDATE_INTERVAL_MS = 66;

const NO_SPEECH_MESSAGE = "Não ouvi nada. Tente de novo.";
const PERMISSION_DENIED_MESSAGE =
  "Permissão do microfone negada. Libere nas configurações do navegador.";
const MIC_UNAVAILABLE_MESSAGE = "Não foi possível acessar o microfone.";
const RECORD_FAILED_MESSAGE = "Não foi possível gravar o áudio. Tente de novo.";

export type VoicePhase = "idle" | "listening" | "transcribing";

export interface UseVoiceInputReturn {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  isSupported: boolean;
  engine: SpeechEngine;
  phase: VoicePhase;
  /** Mic loudness 0..1 for a recording visualizer; 0 when not listening. */
  level: number;
}

export function useVoiceInput(): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [level, setLevel] = useState(0);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const nativeStopRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStoppingRef = useRef(false);
  const instanceCounterRef = useRef(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const hardCapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcribeAbortRef = useRef<AbortController | null>(null);

  // Running in the native shell is not the same as having a recognizer, so
  // the native answer is asked of the plugin and stays pending until it
  // replies; while pending no engine is offered. On the web the answer is
  // known synchronously.
  const [nativeState, setNativeState] = useState<"pending" | "available" | "absent">(() =>
    isNativeSpeechAvailable() ? "pending" : "absent",
  );
  useEffect(() => {
    if (nativeState !== "pending") return;
    let cancelled = false;
    void isNativeSpeechSupported().then((supported) => {
      if (!cancelled) setNativeState(supported ? "available" : "absent");
    });
    return () => {
      cancelled = true;
    };
  }, [nativeState]);

  const engine = useMemo<SpeechEngine>(
    () =>
      pickSpeechEngine({
        probePending: nativeState === "pending",
        nativeSupported: nativeState === "available",
        hasWebSpeech: getSpeechRecognitionConstructor() !== null,
        appleMobileWebKit:
          typeof navigator !== "undefined" && isAppleMobileWebKit(navigator),
        hasMediaRecorder:
          typeof window !== "undefined" &&
          typeof window.MediaRecorder === "function" &&
          typeof window.MediaRecorder.isTypeSupported === "function" &&
          typeof navigator !== "undefined" &&
          !!navigator.mediaDevices?.getUserMedia,
      }),
    [nativeState],
  );

  const isSupported = engine !== "none";

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      if (isStoppingRef.current) return;
      isStoppingRef.current = true;
      if (nativeStopRef.current) {
        nativeStopRef.current.stop();
      } else if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer]);

  /** Stops tracks, the analyser loop, and the hard-cap timer. Idempotent. */
  const releaseCapture = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (hardCapTimerRef.current !== null) {
      clearTimeout(hardCapTimerRef.current);
      hardCapTimerRef.current = null;
    }
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    // A rejected close() only means the context was already torn down.
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
  }, []);

  const transcribeAndFinish = useCallback(
    async (instanceId: number, blob: Blob) => {
      if (blob.size === 0) {
        haptics.error();
        setError(NO_SPEECH_MESSAGE);
        setIsListening(false);
        setPhase("idle");
        setLevel(0);
        return;
      }

      setPhase("transcribing");
      // isListening stays up through transcription so the consumer's
      // listening→stopped transition still sees the final transcript: the
      // recorder has no onresult that could deliver it earlier.
      const controller = new AbortController();
      transcribeAbortRef.current = controller;
      try {
        const text = await transcribeVoiceAudio(blob, controller.signal);
        if (instanceId !== instanceCounterRef.current) return;
        setTranscript(text);
      } catch (transcribeError) {
        if (instanceId !== instanceCounterRef.current) return;
        if (
          transcribeError instanceof Error &&
          transcribeError.name === "AbortError"
        ) {
          return;
        }
        haptics.error();
        setError(
          transcribeError instanceof Error
            ? transcribeError.message
            : "Não foi possível transcrever agora. Tente de novo.",
        );
      } finally {
        transcribeAbortRef.current = null;
        if (instanceId === instanceCounterRef.current) {
          setIsListening(false);
          setPhase("idle");
          setLevel(0);
        }
      }
    },
    [],
  );

  const startRecorder = useCallback(
    async (instanceId: number) => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micError) {
        if (instanceId !== instanceCounterRef.current) return;
        haptics.error();
        const name = micError instanceof Error ? micError.name : "";
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? PERMISSION_DENIED_MESSAGE
            : MIC_UNAVAILABLE_MESSAGE,
        );
        return;
      }
      if (instanceId !== instanceCounterRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      recorderStreamRef.current = stream;

      const RecorderCtor = window.MediaRecorder;
      const mimeType = RECORDER_MIME_TYPES.find((type) =>
        RecorderCtor.isTypeSupported(type),
      );
      let recorder: MediaRecorder;
      try {
        recorder = mimeType
          ? new RecorderCtor(stream, { mimeType })
          : new RecorderCtor(stream);
      } catch {
        releaseCapture();
        if (instanceId !== instanceCounterRef.current) return;
        haptics.error();
        setError(MIC_UNAVAILABLE_MESSAGE);
        return;
      }
      recorderRef.current = recorder;

      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      const stopRecording = () => {
        if (recorderRef.current === recorder && recorder.state !== "inactive") {
          recorder.stop();
        }
      };

      let failed = false;
      recorder.onerror = () => {
        failed = true;
        releaseCapture();
        recorderRef.current = null;
        if (instanceId !== instanceCounterRef.current) return;
        haptics.error();
        setError(RECORD_FAILED_MESSAGE);
        setIsListening(false);
        setPhase("idle");
        setLevel(0);
      };

      recorder.onstop = () => {
        releaseCapture();
        recorderRef.current = null;
        if (failed) return;
        if (instanceId !== instanceCounterRef.current) return;
        const blob = new Blob(chunks, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        void transcribeAndFinish(instanceId, blob);
      };

      let analysis: {
        analyser: AnalyserNode;
        samples: Float32Array<ArrayBuffer>;
      } | null = null;
      try {
        const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioContextRef.current = ctx;
          // After the async mic permission iOS can hand the context over
          // suspended; without a resume the level stays 0 and end-of-speech
          // detection never fires. A rejected resume leaves the same
          // degradation as no Web Audio at all: stop button and hard cap
          // still end the recording.
          if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
          const source = ctx.createMediaStreamSource(stream);
          const node = ctx.createAnalyser();
          node.fftSize = 1024;
          source.connect(node);
          analysis = { analyser: node, samples: new Float32Array(node.fftSize) };
        }
      } catch {
        // Without Web Audio there is no level or end-of-speech detection;
        // the recording still ends via the stop button or the hard cap.
        analysis = null;
      }

      hardCapTimerRef.current = setTimeout(() => {
        if (instanceId !== instanceCounterRef.current) return;
        stopRecording();
      }, RECORDER_HARD_CAP_MS);

      let speechDetected = false;
      let lastVoiceAt = 0;
      let lastLevelAt = 0;

      const tick = () => {
        if (
          instanceId !== instanceCounterRef.current ||
          recorderRef.current !== recorder
        ) {
          return;
        }
        rafRef.current = requestAnimationFrame(tick);

        const now = Date.now();
        if (!analysis || now - lastLevelAt < LEVEL_UPDATE_INTERVAL_MS) return;
        lastLevelAt = now;
        analysis.analyser.getFloatTimeDomainData(analysis.samples);
        let sum = 0;
        for (let i = 0; i < analysis.samples.length; i++) {
          sum += analysis.samples[i] * analysis.samples[i];
        }
        const rms = Math.sqrt(sum / analysis.samples.length);
        setLevel(Math.min(1, rms * RECORDER_LEVEL_GAIN));
        if (rms > RECORDER_SPEECH_RMS) {
          speechDetected = true;
          lastVoiceAt = now;
        }
        if (speechDetected && now - lastVoiceAt >= RECORDER_SILENCE_MS) {
          stopRecording();
        }
      };

      try {
        recorder.start();
      } catch {
        releaseCapture();
        recorderRef.current = null;
        haptics.error();
        setError(RECORD_FAILED_MESSAGE);
        return;
      }
      setIsListening(true);
      setPhase("listening");
      rafRef.current = requestAnimationFrame(tick);
    },
    [releaseCapture, transcribeAndFinish],
  );

  const stopListening = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder) {
      if (recorder.state !== "inactive") recorder.stop();
      return;
    }
    clearSilenceTimer();
    if (engine === "native") {
      instanceCounterRef.current += 1;
      isStoppingRef.current = true;
      setIsListening(false);
      setInterimTranscript((interim) => {
        if (interim.trim()) setTranscript(interim);
        return "";
      });
      const stop = nativeStopRef.current;
      nativeStopRef.current = null;
      if (stop) void stop.stop();
      return;
    }
    if (recognitionRef.current && !isStoppingRef.current) {
      isStoppingRef.current = true;
      recognitionRef.current.stop();
    }
  }, [clearSilenceTimer, engine]);

  const startListening = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setError(null);
    isStoppingRef.current = false;
    instanceCounterRef.current += 1;
    const instanceId = instanceCounterRef.current;

    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    const previousRecorder = recorderRef.current;
    recorderRef.current = null;
    if (previousRecorder) {
      previousRecorder.onstop = null;
      previousRecorder.ondataavailable = null;
      previousRecorder.onerror = null;
      if (previousRecorder.state !== "inactive") previousRecorder.stop();
      releaseCapture();
    }

    if (engine === "native") {
      const previousStop = nativeStopRef.current;
      nativeStopRef.current = null;
      if (previousStop) void previousStop.stop();

      void startNativeListening(
        (text) => {
          if (instanceId !== instanceCounterRef.current) return;
          setInterimTranscript(text);
          resetSilenceTimer();
        },
        (message) => {
          if (instanceId !== instanceCounterRef.current) return;
          haptics.error();
          setError(message);
          setPhase("idle");
          clearSilenceTimer();
        },
        () => {
          if (instanceId !== instanceCounterRef.current) return;
          setIsListening(false);
          setPhase("idle");
          setInterimTranscript((interim) => {
            if (interim.trim()) setTranscript(interim);
            return "";
          });
          clearSilenceTimer();
          isStoppingRef.current = false;
          nativeStopRef.current = null;
        },
      ).then((outcome) => {
        if (instanceId !== instanceCounterRef.current) {
          if (outcome.kind === "started") void outcome.stop();
          return;
        }

        if (outcome.kind === "started") {
          nativeStopRef.current = { stop: outcome.stop };
          setIsListening(true);
          setPhase("listening");
          resetSilenceTimer();
          return;
        }

        nativeStopRef.current = null;
        haptics.error();
        setIsListening(false);
        setPhase("idle");
        clearSilenceTimer();
        if (outcome.kind === "permission_denied") {
          setError("Permissão do microfone negada. Verifique as configurações.");
        } else if (outcome.kind === "unavailable") {
          setError("Este aparelho não reconhece voz.");
        } else {
          setError(outcome.message || "Erro ao iniciar reconhecimento de voz.");
        }
      });
      return;
    }

    if (engine === "recorder") {
      void startRecorder(instanceId);
      return;
    }

    if (engine !== "web-speech") return;

    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) return;

    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }


    const recognition = new Ctor();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (instanceId !== instanceCounterRef.current) return;
      setIsListening(true);
      setPhase("listening");
      resetSilenceTimer();
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (instanceId !== instanceCounterRef.current) return;
      let final = "";
      let interim = "";

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (final) setTranscript(final);
      setInterimTranscript(interim);
      resetSilenceTimer();
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (instanceId !== instanceCounterRef.current) return;
      if (event.error !== "aborted") haptics.error();
      const message = ERROR_MESSAGES[event.error];
      if (message !== undefined) {
        if (message) setError(message);
      } else {
        setError("Erro no reconhecimento de voz. Tente novamente.");
      }
      setPhase("idle");
      clearSilenceTimer();
    };

    recognition.onend = () => {
      if (instanceId !== instanceCounterRef.current) return;
      setIsListening(false);
      setPhase("idle");
      setInterimTranscript((interim) => {
        if (interim.trim()) setTranscript(interim);
        return "";
      });
      clearSilenceTimer();
      isStoppingRef.current = false;
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      haptics.error();
      setError("Reconhecimento de voz não disponível neste navegador.");
      setPhase("idle");
      recognitionRef.current = null;
    }
  }, [engine, resetSilenceTimer, clearSilenceTimer, startRecorder, releaseCapture]);

  useEffect(() => {
    return () => {
      instanceCounterRef.current += 1;
      clearSilenceTimer();
      transcribeAbortRef.current?.abort();
      transcribeAbortRef.current = null;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      // Synchronous teardown only: unmount must never wait on the mic or the
      // network, so Back/Close stay responsive.
      if (recorder) {
        recorder.onstop = null;
        recorder.ondataavailable = null;
        recorder.onerror = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      releaseCapture();
      if (nativeStopRef.current) {
        void nativeStopRef.current.stop();
        nativeStopRef.current = null;
      }
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, [clearSilenceTimer, releaseCapture]);

  return {
    isListening,
    transcript,
    interimTranscript,
    error,
    startListening,
    stopListening,
    isSupported,
    engine,
    phase,
    level,
  };
}
