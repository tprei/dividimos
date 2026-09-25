"use client";

import { motion } from "framer-motion";
import { Loader2, Mic, MicOff, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { haptics } from "@/hooks/use-haptics";
import { parseVoiceExpenseCommand } from "@/lib/sync/voice";
import type { VoiceExpenseResult, MemberContext } from "@/lib/voice-expense-parser";
import { Button } from "@/components/ui/button";
import { popIn } from "@/lib/animations";

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
  const [attempted, setAttempted] = useState(false);
  const wasListeningRef = useRef(false);

  const parseTranscript = useCallback(
    async (text: string) => {
      setParsing(true);
      try {
        const result = await parseVoiceExpenseCommand({ text: text.trim(), members });
        onResult(result);
      } catch (err) {
        haptics.error();
        onError(err instanceof Error ? err.message : "Erro ao processar comando de voz");
      } finally {
        setParsing(false);
      }
    },
    [members, onResult, onError],
  );

  useEffect(() => {
    if (wasListeningRef.current && !isListening) {
      if (transcript.trim() && !voiceError) {
        parseTranscript(transcript);
      } else if (!voiceError) {
        onError("Nenhuma fala detectada. Tente novamente.");
      }
    }
    wasListeningRef.current = isListening;
  }, [isListening, transcript, voiceError, parseTranscript, onError]);

  if (!isSupported) return null;
  const message = isListening ? "Ouvindo…" : parsing ? "Entendendo sua conta…" : attempted ? "Tentar novamente" : "Falar conta";
  const hint = isListening ? "Toque para parar e revisar" : "“Uber com João, 25 reais”";
  return (
    <motion.div variants={popIn} initial="hidden" animate="visible" className="gradient-mesh space-y-3 overflow-hidden rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-4">
        <div className="relative flex size-16 shrink-0 items-center justify-center">
          {isListening && (
            <>
              <span aria-hidden="true" className="absolute inset-0 rounded-full bg-primary/20 motion-safe:animate-ping" />
              <span aria-hidden="true" className="absolute -inset-1.5 rounded-full border border-primary/40" />
            </>
          )}
          <Button disabled={parsing}
            aria-label={isListening ? "Parar gravação" : attempted ? "Tentar novamente" : "Gravar conta"}
            onClick={() => {
              haptics.tap();
              if (isListening) stopListening();
              else { setAttempted(true); onError(""); startListening(); }
            }}
            className="relative size-14 rounded-full shadow-sm">
            {parsing ? <Loader2 className="size-6 motion-safe:animate-spin" /> : isListening ? <Square className="size-5 fill-current" /> : <Mic className="size-6" />}
          </Button>
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold" role="status">{message}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
        </div>
      </div>
      {(transcript || interimTranscript) && (
        <p aria-live="polite" className="rounded-[0.75rem] border border-border bg-background/70 px-3 py-2 text-base leading-snug">
          {transcript}{interimTranscript && <span className="text-muted-foreground"> {interimTranscript}</span>}
        </p>
      )}
      {voiceError && (
        <p role="alert" className="flex items-start gap-2 rounded-[0.75rem] bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
          <MicOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {voiceError}
        </p>
      )}
    </motion.div>
  );
}
