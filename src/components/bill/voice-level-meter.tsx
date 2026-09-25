"use client";

import { useReducedMotion } from "framer-motion";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type VoiceMeterState = "idle" | "listening" | "working";

export interface VoiceLevelMeterProps {
  state: VoiceMeterState;
  /** Mic loudness 0..1; only meaningful when `live`. */
  level: number;
  /** The engine reports real loudness (recorder); otherwise bars breathe on their own. */
  live: boolean;
}

const BARS = 28;
const QUIET_SCALE = 0.12;
/** A resting silhouette: tall in the middle, short at the edges. */
const ENVELOPE = Array.from({ length: BARS }, (_, i) => 0.3 + 0.55 * Math.sin((Math.PI * i) / (BARS - 1)));

/**
 * The mic's waveform strip. With a real level feed it scrolls the last
 * second of loudness right to left; with reduced motion it holds the
 * silhouette still and lets brightness carry the level instead.
 */
export function VoiceLevelMeter({ state, level, live }: VoiceLevelMeterProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const [history, setHistory] = useState<number[]>(() => Array.from({ length: BARS }, () => 0));
  const [lastLevel, setLastLevel] = useState(level);
  if (level !== lastLevel) {
    setLastLevel(level);
    setHistory((previous) => [...previous.slice(1), level]);
  }

  const listening = state === "listening";
  const scrolling = listening && live && !reduceMotion;
  const breathing = listening && !live && !reduceMotion;

  return (
    <div
      aria-hidden="true"
      data-state={state}
      className={cn(
        "flex h-9 items-center justify-between gap-[3px] px-1 transition-opacity duration-200",
        state === "working" && "motion-safe:animate-pulse",
      )}
      style={listening && live && reduceMotion ? { opacity: 0.45 + level * 0.55 } : undefined}
    >
      {ENVELOPE.map((shape, i) => {
        let scale = shape * 0.35;
        if (state === "working") scale = shape * 0.45;
        if (listening) scale = scrolling ? Math.max(QUIET_SCALE, Math.min(1, history[i] * (0.6 + shape))) : shape;
        return (
          <span
            key={i}
            className={cn(
              "h-full w-full max-w-1 origin-center rounded-full transition-[transform,background-color] duration-100 ease-out",
              state === "idle" && "bg-muted-foreground/30",
              state === "listening" && "bg-primary",
              state === "working" && "bg-primary/60",
            )}
            style={
              breathing
                ? { animation: "voice-bar 1.1s ease-in-out infinite", animationDelay: `${-i * 0.07}s` }
                : { transform: `scaleY(${scale})` }
            }
          />
        );
      })}
    </div>
  );
}
