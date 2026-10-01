"use client";

import { useRef, type ReactNode } from "react";
import { useOffscreenPause } from "@/components/scenery/use-offscreen-pause";
import styles from "./hero-scene.module.css";

export function HeroSceneFit({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useOffscreenPause(ref);
  return (
    <div ref={ref} className={styles.sceneFit}>
      {children}
    </div>
  );
}
