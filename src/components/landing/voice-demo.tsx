"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useReducedMotion } from "framer-motion";
import { Mic } from "lucide-react";
import { parseDemoExpense, type DemoExpenseDraft } from "@/lib/landing-expense-draft";
import { cn } from "@/lib/utils";
import { DraftCard } from "./draft-card";
import styles from "./voice-demo.module.css";

const PHRASES = [
  "uber 32 reais com o Bruno",
  "pizza 90 reais em 3",
  "churrasco 240 reais entre 6",
  "mercado 86 reais, divide com a Carla",
];
const INITIAL_PHRASE = PHRASES[3];
const LISTEN_MS = 2400;

const BARS = [
  { h: "14px", dl: "0s" },
  { h: "26px", dl: ".12s" },
  { h: "18px", dl: ".3s" },
  { h: "34px", dl: ".05s" },
  { h: "22px", dl: ".22s" },
  { h: "40px", dl: ".36s" },
  { h: "16px", dl: ".1s" },
  { h: "30px", dl: ".28s" },
  { h: "12px", dl: ".18s" },
  { h: "24px", dl: ".4s" },
  { h: "36px", dl: ".08s" },
  { h: "18px", dl: ".25s" },
  { h: "28px", dl: ".33s" },
  { h: "14px", dl: ".14s" },
];

interface VoiceState {
  listening: boolean;
  seconds: number;
  transcript: string;
  draft: DemoExpenseDraft | null;
}

export function VoiceDemo() {
  const reduceMotion = useReducedMotion();
  const [state, setState] = useState<VoiceState>(() => ({
    listening: false,
    seconds: 0,
    transcript: `“${INITIAL_PHRASE}”`,
    draft: parseDemoExpense(INITIAL_PHRASE),
  }));
  const phraseIndex = useRef(0);
  const frame = useRef(0);
  const activePhrase = useRef(INITIAL_PHRASE);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const finish = (phrase: string, seconds: number) => {
    setState({ listening: false, seconds, transcript: `“${phrase}”`, draft: parseDemoExpense(phrase) });
  };

  const listen = () => {
    const phrase = PHRASES[phraseIndex.current % PHRASES.length];
    phraseIndex.current += 1;
    activePhrase.current = phrase;
    const words = phrase.split(" ");
    const duration = reduceMotion ? 0 : LISTEN_MS;
    const startedAt = performance.now();

    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const progress = duration === 0 ? 1 : Math.min(1, elapsed / duration);
      const seconds = Math.floor(elapsed / 1000);
      if (progress < 1) {
        const shown = words.slice(0, Math.max(1, Math.ceil(progress * words.length))).join(" ");
        setState({ listening: true, seconds, transcript: `“${shown}…`, draft: null });
        frame.current = requestAnimationFrame(tick);
        return;
      }
      finish(phrase, seconds);
    };
    tick();
  };

  const toggle = () => {
    if (!state.listening) {
      listen();
      return;
    }
    cancelAnimationFrame(frame.current);
    finish(activePhrase.current, state.seconds);
  };

  return (
    <>
      <div className={styles.top}>
        <button
          type="button"
          className={cn(styles.mic, state.listening && styles.listening)}
          aria-label="Falar uma despesa"
          aria-pressed={state.listening}
          onClick={toggle}
        >
          {state.listening ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" />
            </svg>
          ) : (
            <Mic strokeWidth={2.2} aria-hidden="true" />
          )}
        </button>
        <div className={cn(styles.wave, state.listening && styles.listening)} aria-hidden="true">
          {BARS.map((bar) => (
            <i key={bar.dl} style={{ "--h": bar.h, "--dl": bar.dl } as CSSProperties} />
          ))}
        </div>
        <span className={styles.time}>0:{String(state.seconds).padStart(2, "0")}</span>
      </div>
      <p className={styles.transcript}>{state.transcript}</p>
      <div className={styles.out} aria-live="polite">
        {state.draft && <DraftCard draft={state.draft} />}
      </div>
    </>
  );
}
