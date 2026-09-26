"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Loader2, Mic, MicOff, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { haptics } from "@/hooks/use-haptics";
import { parseVoiceExpenseCommand } from "@/lib/sync/voice";
import { sketchVoiceBill } from "@/lib/voice-bill-sketch";
import type { VoiceExpenseResult, MemberContext } from "@/lib/voice-expense-parser";
import { VoiceBillPreview, VoiceExamples } from "@/components/bill/voice-bill-preview";
import { VoiceLevelMeter, type VoiceMeterState } from "@/components/bill/voice-level-meter";
import { Button } from "@/components/ui/button";
import { fade, popIn } from "@/lib/animations";

interface VoiceExpenseButtonProps {
  members?: MemberContext[];
  onResult: (result: VoiceExpenseResult) => void;
  onError: (message: string) => void;
  /** Full-screen step: add the live bill preview and example phrases under the mic. */
  preview?: boolean;
}

function statusLabel(
  recording: boolean,
  transcribing: boolean,
  parsing: boolean,
  attempted: boolean,
): string {
  if (recording) return "Ouvindo…";
  if (transcribing) return "Entendendo…";
  if (parsing) return "Entendendo sua conta…";
  if (attempted) return "Tentar novamente";
  return "Falar conta";
}

export function VoiceExpenseButton({
  members,
  onResult,
  onError,
  preview = false,
}: VoiceExpenseButtonProps) {
  const {
    isListening,
    transcript,
    interimTranscript,
    error: voiceError,
    startListening,
    stopListening,
    isSupported,
    phase,
    level,
    engine,
  } = useVoiceInput();
  const reduceMotion = useReducedMotion();
  const [parsing, setParsing] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const wasListeningRef = useRef(false);

  const transcribing = phase === "transcribing";
  const recording = isListening && !transcribing;
  const busy = parsing || transcribing;

  const parseTranscript = useCallback(
    async (text: string) => {
      setParsing(true);
      try {
        const result = await parseVoiceExpenseCommand({ text: text.trim(), members });
        haptics.success();
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
  let micAriaLabel = "Gravar conta";
  if (attempted) micAriaLabel = "Tentar novamente";
  if (recording) micAriaLabel = "Parar gravação";
  const message = statusLabel(recording, transcribing, parsing, attempted);
  let hint = preview ? "O que foi, quanto e com quem" : "“Uber com João, 25 reais”";
  if (recording) hint = "Toque para parar e revisar";
  let meterState: VoiceMeterState = "idle";
  if (recording) meterState = "listening";
  else if (busy) meterState = "working";
  const liveLevel = engine === "recorder";
  let micIcon = <Mic className="size-6" />;
  if (recording) micIcon = <Square className="size-5 fill-current" />;
  if (busy) micIcon = <Loader2 className="size-6 motion-safe:animate-spin" />;

  const card = (
    <motion.div variants={reduceMotion ? fade : popIn} initial="hidden" animate="visible" className="gradient-mesh space-y-2 overflow-hidden rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-4">
        <div className="relative flex size-16 shrink-0 items-center justify-center">
          {recording && liveLevel && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-primary/25 transition-transform duration-100 ease-out"
              style={reduceMotion ? undefined : { transform: `scale(${1 + level * 0.45})` }}
            />
          )}
          {recording && !liveLevel && (
            <span aria-hidden="true" className="absolute inset-0 rounded-full bg-primary/20 motion-safe:animate-ping" />
          )}
          {recording && <span aria-hidden="true" className="absolute -inset-1.5 rounded-full border border-primary/40" />}
          <Button disabled={busy}
            aria-label={micAriaLabel}
            onClick={() => {
              haptics.tap();
              if (recording) stopListening();
              else { setAttempted(true); onError(""); startListening(); }
            }}
            className="relative size-14 rounded-full shadow-sm">
            {micIcon}
          </Button>
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold" role="status">{message}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
        </div>
      </div>
      <VoiceLevelMeter state={meterState} level={level} live={liveLevel} />
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

  if (!preview) return card;
  return (
    <div className="space-y-4">
      {card}
      <VoiceBillPreview
        sketch={sketchVoiceBill(`${transcript} ${interimTranscript}`)}
        state={recording || busy ? "active" : "idle"}
      />
      <VoiceExamples />
    </div>
  );
}
