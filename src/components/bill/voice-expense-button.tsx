"use client";

import { Loader2, Mic, MicOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { Button } from "@/components/ui/button";
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
      <div className="space-y-3 text-center">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Processando...
        </div>
        {transcript && (
          <p className="text-sm italic text-muted-foreground">&ldquo;{transcript}&rdquo;</p>
        )}
      </div>
    );
  }

  if (isListening) {
    return (
      <div className="space-y-3">
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={stopListening}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg transition-transform active:scale-95"
          >
            <MicOff className="h-7 w-7" />
          </button>
          <p className="text-sm text-muted-foreground">Toque pra parar</p>
        </div>
        {(transcript || interimTranscript) && (
          <p className="text-center text-sm">
            {transcript}
            {interimTranscript && (
              <span className="text-muted-foreground">{interimTranscript}</span>
            )}
          </p>
        )}
        {voiceError && <p className="text-center text-sm text-destructive">{voiceError}</p>}
      </div>
    );
  }

  return (
    <Button variant="outline" className="w-full gap-2" onClick={startListening}>
      <Mic className="h-4 w-4" />
      Falar despesa
    </Button>
  );
}
