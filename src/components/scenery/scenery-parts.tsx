import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SceneryVariant } from "./scenery";
import styles from "./scenery.module.css";

interface Bulb {
  x: string;
  k: number;
  wide: boolean;
}

const BULBS: ReadonlyArray<Bulb> = [
  { x: "7.1%", k: 0.49, wide: false },
  { x: "14.3%", k: 0.82, wide: true },
  { x: "21.4%", k: 0.98, wide: false },
  { x: "28.6%", k: 0.98, wide: true },
  { x: "35.7%", k: 0.82, wide: false },
  { x: "42.9%", k: 0.49, wide: true },
  { x: "57.1%", k: 0.49, wide: false },
  { x: "64.3%", k: 0.82, wide: true },
  { x: "71.4%", k: 0.98, wide: false },
  { x: "78.6%", k: 0.98, wide: true },
  { x: "85.7%", k: 0.82, wide: false },
  { x: "92.9%", k: 0.49, wide: true },
];

export const VARAL_BOXES: Record<SceneryVariant, ReadonlyArray<string>> = {
  hero: [styles.varal],
};

function bulbStyle(bulb: Bulb, index: number): CSSProperties {
  return {
    "--x": bulb.x,
    "--k": bulb.k,
    "--sway": `${3.4 + (index % 3) * 0.6}s`,
    "--p": `${-index * 0.45}s`,
    "--on": `${0.3 + index * 0.08}s`,
  } as CSSProperties;
}

export function SceneryDefs() {
  return (
    <svg className={styles.defs} aria-hidden="true" focusable="false">
      <symbol id="sc-bulb" viewBox="0 0 20 34">
        <rect x="6" width="8" height="9" rx="1.6" style={{ fill: "var(--bulb-socket)" }} />
        <path
          d="M6.6 8.5h6.8l1.4 3.6c2.6 2 4.2 5.2 4.2 8.9 0 6.1-4.3 11-9 11s-9-4.9-9-11c0-3.7 1.6-6.9 4.2-8.9z"
          style={{ fill: "var(--bulb-glass)" }}
        />
        <path
          d="M5.2 17.5c-1.1 1.7-1.5 3.6-1.2 5.6"
          style={{ fill: "none", stroke: "var(--bulb-shine)", strokeWidth: 1.6, strokeLinecap: "round" }}
        />
        <path
          d="M7.6 23l1.2-3.6 1.2 3.6 1.2-3.6 1.2 3.6"
          style={{ fill: "none", stroke: "var(--bulb-filament)", strokeWidth: 1.1, strokeLinejoin: "round" }}
        />
      </symbol>
      <symbol id="sc-glint-a" viewBox="0 0 100 220">
        <path d="M44 6h12M39 17h22M45 29h10M35 41h28M41 55h18" />
        <path d="M31 70h32M40 87h24M27 105h42M37 125h26M25 147h48M35 171h32M29 198h40" opacity=".55" />
      </symbol>
      <symbol id="sc-glint-b" viewBox="0 0 100 220">
        <path d="M41 10h18M47 22h7M37 34h24M33 47h32M45 61h12" />
        <path d="M34 77h30M28 95h40M42 115h20M30 136h40M26 160h46M38 185h26" opacity=".55" />
      </symbol>
    </svg>
  );
}

export function Glint() {
  return (
    <div className={styles.glint}>
      <svg className={styles.glintA} viewBox="0 0 100 220">
        <use href="#sc-glint-a" />
      </svg>
      <svg className={styles.glintB} viewBox="0 0 100 220">
        <use href="#sc-glint-b" />
      </svg>
    </div>
  );
}

export function SeaMotion({ children }: { children?: ReactNode }) {
  return (
    <>
      <div className={styles.sea}>
        <i className={cn(styles.waves, styles.wavesFar)} />
        <i className={cn(styles.waves, styles.wavesNear)} />
        {children}
      </div>
      <svg className={styles.foam} viewBox="0 0 100 14" preserveAspectRatio="none">
        <path d="M0 6Q6.25 1 12.5 6T25 6T37.5 6T50 6T62.5 6T75 6T87.5 6T100 6" />
        <path d="M0 11Q8 7 16 11T32 11T48 11T64 11T80 11T96 11T112 11" opacity=".45" />
      </svg>
    </>
  );
}

export function VaralLine({ lit, className }: { lit: boolean; className: string }) {
  return (
    <div className={className}>
      <svg className={styles.wire} viewBox="0 0 100 10" preserveAspectRatio="none">
        <path d="M0 0Q25 20 50 0Q75 20 100 0" />
      </svg>
      {lit &&
        BULBS.map((bulb, index) => (
          <i key={bulb.x} className={cn(styles.halo, bulb.wide && styles.wide)} style={bulbStyle(bulb, index)} />
        ))}
    </div>
  );
}

export function VaralBulbs({ lit, className }: { lit: boolean; className: string }) {
  return (
    <div className={className}>
      {BULBS.map((bulb, index) => (
        <i
          key={bulb.x}
          className={cn(styles.bulb, lit && styles.lit, bulb.wide && styles.wide)}
          style={bulbStyle(bulb, index)}
        >
          <svg viewBox="0 0 20 34">
            <use href="#sc-bulb" />
          </svg>
        </i>
      ))}
    </div>
  );
}
