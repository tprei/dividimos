"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { haptics } from "@/hooks/use-haptics";
import type { VoiceExpenseResult, MemberContext } from "@/lib/voice-expense-parser";

interface VoiceExpenseButtonProps {
  members?: MemberContext[];
  onResult: (result: VoiceExpenseResult) => void;
  onError: (message: string) => void;
}

export function VoiceExpenseButton({
  members,
  onResult,
  onError,
}: VoiceExpenseButtonProps) {
  const {
    isListening,
    transcript,
    interimTranscript,
    error: voiceError,
    startListening,
    stopListening,
    isSupported,
  } = useVoiceInput();
  const [parsing, setParsing] = useState(false);
  const wasListeningRef = useRef(false);

  const parseTranscript = useCallback(
    async (text: string) => {
      setParsing(true);
      try {
        const res = await fetch("/api/voice/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.trim(), members }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "Erro ao processar comando de voz");
        }

        const result: VoiceExpenseResult = await res.json();
        onResult(result);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Erro ao processar comando de voz");
      } finally {
        setParsing(false);
      }
    },
    [members, onResult, onError],
  );

  useEffect(() => {
    if (wasListeningRef.current && !isListening) {
      if (transcript.trim()) {
        parseTranscript(transcript);
      } else if (!voiceError) {
        onError("Nenhuma fala detectada. Tente novamente.");
      }
    }
    wasListeningRef.current = isListening;
  }, [isListening, transcript, voiceError, parseTranscript, onError]);

  if (!isSupported) return null;

  if (parsing) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center gap-4 py-6"
      >
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium">Processando...</p>
          {transcript && (
            <p className="text-sm italic text-muted-foreground">&ldquo;{transcript}&rdquo;</p>
          )}
        </div>
      </motion.div>
    );
  }

  if (isListening) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center gap-4 py-4"
      >
        <div className="relative">
          <motion.div
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-0 rounded-full bg-destructive/20"
          />
          <button
            onClick={() => {
              haptics.tap();
              stopListening();
            }}
            className="relative flex h-20 w-20 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg transition-transform active:scale-95"
          >
            <Square className="h-7 w-7" />
          </button>
        </div>
        <p className="text-sm font-medium text-muted-foreground">Toque pra parar</p>
        <AnimatePresence mode="wait">
          {(transcript || interimTranscript) && (
            <motion.div
              key="transcript"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="w-full rounded-2xl border bg-card p-4 text-center"
            >
              <p className="text-base font-medium">
                {transcript}
                {interimTranscript && (
                  <span className="text-muted-foreground"> {interimTranscript}</span>
                )}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
        {voiceError && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm text-destructive"
          >
            {voiceError}
          </motion.p>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-4 py-4"
    >
      <button
        onClick={() => {
          haptics.tap();
          startListening();
        }}
        className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary transition-all hover:bg-primary hover:text-primary-foreground active:scale-95"
      >
        <Mic className="h-8 w-8" />
      </button>
      <div className="space-y-1 text-center">
        <p className="text-sm font-medium">Toque pra falar</p>
        <p className="text-xs text-muted-foreground">
          Ex: &ldquo;Uber com João 25 reais&rdquo;
        </p>
      </div>
    </motion.div>
  );
}
