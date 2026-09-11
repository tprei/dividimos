"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isNativeSpeechAvailable,
  isNativeSpeechSupported,
  startNativeListening,
} from "@/lib/capacitor/speech";

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
  }
}

function getSpeechRecognitionConstructor():
  | (new () => SpeechRecognition)
  | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Permissão do microfone negada. Verifique as configurações do navegador.",
  "no-speech": "Nenhuma fala detectada. Tente novamente.",
  network: "Erro de rede. Verifique sua conexão.",
  "audio-capture": "Nenhum microfone encontrado. Conecte um microfone e tente novamente.",
  aborted: "",
};

const SILENCE_TIMEOUT_MS = 3000;

export interface UseVoiceInputReturn {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  isSupported: boolean;
}

export function useVoiceInput(): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const nativeStopRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStoppingRef = useRef(false);
  const instanceCounterRef = useRef(0);

  // Running in the native shell is not the same as having a recognizer, so
  // the native answer is asked of the plugin and assumed absent until it
  // replies. The web path stays synchronous.
  const [nativeSupported, setNativeSupported] = useState(false);
  useEffect(() => {
    if (!isNativeSpeechAvailable()) return;
    let cancelled = false;
    void isNativeSpeechSupported().then((supported) => {
      if (!cancelled) setNativeSupported(supported);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isSupported =
    nativeSupported ||
    (typeof window !== "undefined" && getSpeechRecognitionConstructor() !== null);

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

  const stopListening = useCallback(() => {
    clearSilenceTimer();
    if (nativeStopRef.current) {
      isStoppingRef.current = true;
      nativeStopRef.current.stop();
      return;
    }
    if (recognitionRef.current && !isStoppingRef.current) {
      isStoppingRef.current = true;
      recognitionRef.current.stop();
    }
  }, [clearSilenceTimer]);

  const startListening = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setError(null);
    isStoppingRef.current = false;

    if (isNativeSpeechAvailable()) {
      void startNativeListening(
        (text) => {
          setInterimTranscript(text);
          resetSilenceTimer();
        },
        (message) => {
          setError(message);
          clearSilenceTimer();
        },
        () => {
          setIsListening(false);
          setInterimTranscript((interim) => {
            if (interim.trim()) setTranscript(interim);
            return "";
          });
          clearSilenceTimer();
          isStoppingRef.current = false;
          nativeStopRef.current = null;
        },
      ).then((outcome) => {
        // Listening is shown only for a microphone that actually opened.
        if (outcome.kind === "started") {
          nativeStopRef.current = { stop: outcome.stop };
          setIsListening(true);
          resetSilenceTimer();
          return;
        }

        nativeStopRef.current = null;
        setIsListening(false);
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

    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) return;

    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    instanceCounterRef.current += 1;
    const instanceId = instanceCounterRef.current;

    const recognition = new Ctor();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (instanceId !== instanceCounterRef.current) return;
      setIsListening(true);
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
      const message = ERROR_MESSAGES[event.error];
      if (message !== undefined) {
        if (message) setError(message);
      } else {
        setError("Erro no reconhecimento de voz. Tente novamente.");
      }
      clearSilenceTimer();
    };

    recognition.onend = () => {
      if (instanceId !== instanceCounterRef.current) return;
      setIsListening(false);
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
      setError("Reconhecimento de voz não disponível neste navegador.");
      recognitionRef.current = null;
    }
  }, [resetSilenceTimer, clearSilenceTimer]);

  useEffect(() => {
    return () => {
      clearSilenceTimer();
      if (nativeStopRef.current) {
        nativeStopRef.current.stop();
        nativeStopRef.current = null;
      }
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, [clearSilenceTimer]);

  return {
    isListening,
    transcript,
    interimTranscript,
    error,
    startListening,
    stopListening,
    isSupported,
  };
}
