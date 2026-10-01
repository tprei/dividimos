"use client";

import { useEffect, useRef, useState } from "react";
import { haptics } from "@/hooks/use-haptics";
import { cn } from "@/lib/utils";
import { useOffscreenPause } from "@/components/scenery/use-offscreen-pause";
import { switchLights } from "./lights";
import styles from "./hero-lamp.module.css";

const TUG_DELAY_MS = 140;

export function HeroLamp() {
  const mountRef = useRef<HTMLDivElement>(null);
  const bulbRef = useRef<SVGCircleElement>(null);
  const timerRef = useRef<number | null>(null);
  const [tugs, setTugs] = useState(0);

  useOffscreenPause(mountRef);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const pull = () => {
    setTugs((count) => count + 1);
    haptics.tap();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timerRef.current = window.setTimeout(
      () => {
        timerRef.current = null;
        if (bulbRef.current) switchLights(bulbRef.current);
      },
      reduceMotion ? 0 : TUG_DELAY_MS,
    );
  };

  return (
    <div ref={mountRef} className={styles.mount}>
      <div className={styles.swing}>
        <i className={styles.cable} aria-hidden="true" />
        <button type="button" className={styles.lamp} tabIndex={-1} aria-hidden="true" onClick={pull}>
          <span className={styles.glow} aria-hidden="true" />
          <span key={tugs} className={cn(styles.body, tugs > 0 && styles.jolt)} aria-hidden="true">
            <svg className={styles.shade} viewBox="0 0 72 66">
              <rect x="30" width="12" height="9" rx="2.5" style={{ fill: "var(--lamp-cap)" }} />
              <path
                d="M36 7C22 7 14 17 12.5 30L4.5 43C3 45.5 4.5 48 7.5 48h57c3 0 4.5-2.5 3-5l-8-13C58 17 50 7 36 7Z"
                style={{ fill: "var(--lamp-enamel)" }}
              />
              <path
                d="M21 21c3-6 8.5-9 14-9.5"
                style={{ fill: "none", stroke: "var(--lamp-sheen)", strokeWidth: 3, strokeLinecap: "round" }}
              />
              <ellipse cx="36" cy="48" rx="30" ry="4.5" style={{ fill: "var(--lamp-inner)" }} />
              <circle ref={bulbRef} cx="36" cy="54.5" r="9.5" style={{ fill: "var(--lamp-bulb)" }} />
              <path
                d="M33.2 56.5v-2.2c0-1.7 1.2-2.8 2.8-2.8s2.8 1.1 2.8 2.8v2.2"
                style={{ fill: "none", stroke: "var(--lamp-filament)", strokeWidth: 1.2 }}
              />
            </svg>
            <i className={cn(styles.cord, tugs > 0 && styles.tug)} />
            <i className={cn(styles.bead, tugs > 0 && styles.tug)} />
          </span>
        </button>
      </div>
    </div>
  );
}
