"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";

export const INTRO_AUTO_ADVANCE_MS = 4000;

export type AutoAdvancePause = "press" | "focus" | "hidden" | "hover";

export interface AutoAdvance {
  /** True while the countdown to the next slide runs. */
  counting: boolean;
  /** Changes every time a countdown restarts, so the progress fill can restart with it. */
  cycle: number;
  settle(): void;
  busy(): void;
  pause(reason: AutoAdvancePause): void;
  resume(reason: AutoAdvancePause): void;
}

interface AutoAdvanceOptions {
  enabled: boolean;
  slide: number;
  onAdvance: () => void;
}

/**
 * Once the current slide's scene settles and nobody is touching, focusing or hiding the intro,
 * waits INTRO_AUTO_ADVANCE_MS and advances. Any interaction pauses; the next settle or resume
 * starts a fresh countdown.
 */
export function useAutoAdvance({ enabled, slide, onAdvance }: AutoAdvanceOptions): AutoAdvance {
  const [settled, setSettled] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [pauses, setPauses] = useState<ReadonlySet<AutoAdvancePause>>(
    () => new Set<AutoAdvancePause>(typeof document !== "undefined" && document.hidden ? ["hidden"] : []),
  );
  const [trackedSlide, setTrackedSlide] = useState(slide);
  const advance = useEffectEvent(onAdvance);

  if (trackedSlide !== slide) {
    setTrackedSlide(slide);
    setSettled(false);
  }

  const counting = enabled && settled && pauses.size === 0;

  useEffect(() => {
    if (!counting) return;
    const timer = window.setTimeout(() => {
      setSettled(false);
      advance();
    }, INTRO_AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [counting, cycle]);

  const pause = useCallback((reason: AutoAdvancePause) => {
    setPauses((current) => (current.has(reason) ? current : new Set(current).add(reason)));
  }, []);

  const resume = useCallback((reason: AutoAdvancePause) => {
    setPauses((current) => {
      if (!current.has(reason)) return current;
      const next = new Set(current);
      next.delete(reason);
      return next;
    });
  }, []);

  useEffect(() => {
    const onVisibility = () => (document.hidden ? pause("hidden") : resume("hidden"));
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pause, resume]);

  const settle = useCallback(() => {
    setSettled(true);
    setCycle((current) => current + 1);
  }, []);

  const busy = useCallback(() => setSettled(false), []);

  return { counting, cycle, settle, busy, pause, resume };
}
