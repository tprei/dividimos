import type { CSSProperties, MouseEventHandler } from "react";
import { cn } from "@/lib/utils";
import styles from "./table-art.module.css";

const BOTTLE_PATH =
  "M21.5 21 L21.5 60 C21.5 76 17 82 11 92 C5 101 3 108 3 118 L3 222 Q3 229 10 229 L50 229 Q57 229 57 222 L57 118 C57 108 55 101 49 92 C43 82 38.5 76 38.5 60 L38.5 21 Z";

const SLEEVE_PATH = "M2 112 A36 7 0 0 0 74 112 L74 226 Q74 234 66 234 L10 234 Q2 234 2 226 Z";

const LABEL_RED = "oklch(0.52 0.19 27)";

function BottleGradients() {
  return (
    <>
      <linearGradient id="landing-amber-glass" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="oklch(0.22 0.06 45)" />
        <stop offset=".22" stopColor="oklch(0.36 0.10 55)" />
        <stop offset=".38" stopColor="oklch(0.46 0.12 60)" />
        <stop offset=".62" stopColor="oklch(0.33 0.09 52)" />
        <stop offset="1" stopColor="oklch(0.18 0.05 42)" />
      </linearGradient>
      <linearGradient id="landing-amber-empty" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="oklch(0.34 0.09 55)" />
        <stop offset=".38" stopColor="oklch(0.62 0.13 68)" />
        <stop offset="1" stopColor="oklch(0.30 0.08 50)" />
      </linearGradient>
      <linearGradient id="landing-cyl-shade" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="oklch(0 0 0 / .32)" />
        <stop offset=".3" stopColor="oklch(1 0 0 / .18)" />
        <stop offset=".5" stopColor="oklch(1 0 0 / 0)" />
        <stop offset="1" stopColor="oklch(0 0 0 / .38)" />
      </linearGradient>
      <linearGradient id="landing-crown" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="oklch(0.55 0.10 75)" />
        <stop offset=".35" stopColor="oklch(0.90 0.10 90)" />
        <stop offset="1" stopColor="oklch(0.50 0.09 70)" />
      </linearGradient>
      <linearGradient id="landing-eps" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="oklch(0.84 0.006 90)" />
        <stop offset=".3" stopColor="oklch(0.985 0.004 90)" />
        <stop offset=".62" stopColor="oklch(0.95 0.005 90)" />
        <stop offset="1" stopColor="oklch(0.80 0.007 90)" />
      </linearGradient>
      <pattern id="landing-eps-beads" width="6" height="6" patternUnits="userSpaceOnUse">
        <circle cx="1.5" cy="1.6" r="1.3" fill="none" stroke="oklch(0.70 0.006 90 / .35)" strokeWidth=".45" />
        <circle cx="4.5" cy="4.4" r="1.4" fill="none" stroke="oklch(0.70 0.006 90 / .3)" strokeWidth=".45" />
      </pattern>
      <clipPath id="landing-beer-shape">
        <path d={BOTTLE_PATH} />
      </clipPath>
    </>
  );
}

function BeerBottleSymbol() {
  return (
    <symbol id="landing-beer" viewBox="0 0 60 230">
      <path d={BOTTLE_PATH} fill="url(#landing-amber-glass)" />
      <rect x="0" y="21" width="60" height="62" fill="url(#landing-amber-empty)" opacity=".55" clipPath="url(#landing-beer-shape)" />
      <path d="M13 83 Q30 80 47 83" fill="none" stroke="oklch(0.62 0.12 70 / .6)" strokeWidth="1.2" clipPath="url(#landing-beer-shape)" />
      <rect x="19.6" y="17" width="20.8" height="6" rx="3" fill="oklch(0.30 0.08 50)" />
      <path d="M21.5 42 h17 v12 l-8.5 6 l-8.5 -6 z" fill={LABEL_RED} />
      <path d="M21.5 42 h17 M21.5 45 h17" stroke="oklch(0.82 0.12 85)" strokeWidth="1.1" />
      <path d="M21.5 42 h17 v12 l-8.5 6 l-8.5 -6 z" fill="url(#landing-cyl-shade)" />
      <rect x="3" y="138" width="54" height="62" fill="oklch(0.95 0.03 88)" />
      <rect x="3" y="138" width="54" height="6" fill={LABEL_RED} />
      <rect x="3" y="194" width="54" height="6" fill={LABEL_RED} />
      <path d="M3 146 h54 M3 192 h54" stroke="oklch(0.78 0.12 85)" strokeWidth="1" />
      <ellipse cx="30" cy="169" rx="16" ry="13" fill={LABEL_RED} />
      <ellipse cx="30" cy="169" rx="13" ry="10.2" fill="none" stroke="oklch(0.86 0.1 88)" strokeWidth="1" />
      <rect x="21" y="164" width="18" height="3" rx="1.5" fill="oklch(0.95 0.03 88)" />
      <rect x="24" y="170" width="12" height="2.4" rx="1.2" fill="oklch(0.95 0.03 88 / .85)" />
      <rect x="3" y="138" width="54" height="62" fill="url(#landing-cyl-shade)" />
      <path d="M3 216 h54" stroke="oklch(0.15 0.04 40 / .5)" strokeWidth="1.2" />
      <path d="M9 118 L9 134 M9 204 L9 222" stroke="oklch(1 0 0 / .38)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M25 26 L25 40" stroke="oklch(1 0 0 / .38)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M17 88 Q12 96 10 106" fill="none" stroke="oklch(1 0 0 / .3)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M19.2 8.5 Q30 5 40.8 8.5 L41.2 17.6 L18.8 17.6 Z" fill="url(#landing-crown)" />
      <path d="M18.9 17.2 h22.2" stroke="oklch(0.48 0.09 70)" strokeWidth="2.6" strokeDasharray="1.5 1.1" />
      <path d="M23 9.5 Q30 7.5 37 9.5" fill="none" stroke="oklch(1 0 0 / .55)" strokeWidth="1.2" strokeLinecap="round" />
    </symbol>
  );
}

function IsoporBottleSymbol() {
  return (
    <symbol id="landing-beer-isopor" viewBox="0 0 76 236">
      <ellipse cx="38" cy="112" rx="36" ry="7" fill="oklch(0.93 0.004 90)" />
      <ellipse cx="38" cy="112.6" rx="30.5" ry="5" fill="oklch(0.55 0.01 80)" />
      <use href="#landing-beer" x="8" y="4" width="60" height="230" />
      <path d={SLEEVE_PATH} fill="url(#landing-eps)" />
      <path d={SLEEVE_PATH} fill="url(#landing-eps-beads)" />
      <path d="M2.6 113 A35.4 6.6 0 0 0 73.4 113" fill="none" stroke="oklch(1 0 0)" strokeWidth="1.6" />
      <path d="M2 128 A36 7 0 0 0 74 128" fill="none" stroke="oklch(0.72 0.17 58)" strokeWidth="3" />
      <path d="M2 214 A36 7 0 0 0 74 214" fill="none" stroke="oklch(0.72 0.17 58)" strokeWidth="3" />
      <g transform="translate(24 150)">
        <rect width="28" height="28" rx="8" fill="oklch(0.74 0.16 68)" />
        <circle cx="7.6" cy="14" r="2.4" fill="white" />
        <rect x="12" y="6.4" width="4" height="15.2" rx="2" fill="white" />
        <circle cx="20.4" cy="14" r="2.4" fill="white" />
      </g>
      <text
        x="38"
        y="194"
        textAnchor="middle"
        fontSize="8.4"
        fontWeight="900"
        fill="oklch(0.52 0.13 58)"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        dividimos
      </text>
      <path d={SLEEVE_PATH} fill="url(#landing-cyl-shade)" opacity=".55" />
    </symbol>
  );
}

function CoasterSymbol() {
  return (
    <symbol id="landing-coaster" viewBox="0 0 120 44">
      <ellipse cx="60" cy="22" rx="58" ry="20" fill="oklch(0.80 0.055 75)" />
      <ellipse cx="60" cy="22" rx="58" ry="20" fill="none" stroke="oklch(0.66 0.06 70 / .8)" strokeWidth="1.6" />
      <ellipse cx="60" cy="22" rx="48" ry="16" fill="none" stroke="oklch(0.66 0.06 70 / .7)" strokeWidth="1.4" strokeDasharray="2 3.6" />
    </symbol>
  );
}

export function TableArtDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <BottleGradients />
        <BeerBottleSymbol />
        <IsoporBottleSymbol />
        <CoasterSymbol />
      </defs>
    </svg>
  );
}

export function BeerBottle() {
  return (
    <svg viewBox="0 0 60 230" className={styles.fill}>
      <use href="#landing-beer" />
    </svg>
  );
}

export function IsoporBottle() {
  return (
    <svg viewBox="0 0 76 236" className={styles.fill}>
      <use href="#landing-beer-isopor" />
    </svg>
  );
}

export function Coaster({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 44" className={className} aria-hidden="true">
      <use href="#landing-coaster" />
    </svg>
  );
}

const BUBBLES = [
  { cx: 22, r: 1.3, t: "2.8s", d: "0s" },
  { cx: 31, r: 1, t: "2.2s", d: ".7s" },
  { cx: 40, r: 1.5, t: "3.1s", d: "1.3s" },
  { cx: 48, r: 1, t: "2.5s", d: ".3s" },
  { cx: 27, r: 0.9, t: "2s", d: "1.8s" },
  { cx: 44, r: 1.2, t: "2.7s", d: "2.2s" },
  { cx: 35, r: 0.8, t: "1.9s", d: "1s" },
];

export function Copo() {
  return (
    <svg viewBox="0 0 70 100" className={styles.fill}>
      <defs>
        <linearGradient id="landing-beer-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="oklch(0.82 0.15 82)" />
          <stop offset="1" stopColor="oklch(0.68 0.16 66)" />
        </linearGradient>
        <clipPath id="landing-beer-clip">
          <path d="M9.6 27 L60.4 27 L57 96 L13 96 Z" />
        </clipPath>
      </defs>
      <path d="M6 4 L64 4 L57 96 L13 96 Z" fill="oklch(0.97 0.01 90 / .35)" />
      <path d="M9.6 27 L60.4 27 L57 96 L13 96 Z" fill="url(#landing-beer-fill)" />
      <g clipPath="url(#landing-beer-clip)" fill="oklch(1 0 0 / .85)">
        {BUBBLES.map((bubble) => (
          <circle
            key={bubble.cx}
            className={styles.bubble}
            cx={bubble.cx}
            cy="94"
            r={bubble.r}
            style={{ "--t": bubble.t, "--d": bubble.d } as CSSProperties}
          />
        ))}
      </g>
      <g className={styles.foam}>
        <path d="M8 13 Q14 7 20 12 Q27 6 34 11 Q41 5 48 11 Q55 6 62 12 L60.4 28 L9.6 28 Z" fill="oklch(0.98 0.02 95)" />
        <circle cx="22" cy="20" r="2" fill="oklch(0.9 0.03 90)" />
        <circle cx="44" cy="18" r="2.4" fill="oklch(0.9 0.03 90)" />
        <circle cx="33" cy="23" r="1.6" fill="oklch(0.9 0.03 90)" />
      </g>
      <g stroke="oklch(1 0 0 / .45)" strokeWidth="1.4">
        <path d="M16 44 L18 94" />
        <path d="M24 44 L25 94" />
        <path d="M32 44 L32.5 94" />
        <path d="M40 44 L39.5 94" />
        <path d="M48 44 L46 94" />
        <path d="M55 44 L52.5 94" />
      </g>
      <path d="M11 42 L59 42" stroke="oklch(1 0 0 / .5)" strokeWidth="1.2" />
      <path d="M6 4 L64 4 L57 96 L13 96 Z" fill="none" stroke="oklch(1 0 0 / .8)" strokeWidth="2" />
      <path d="M12 8 L17 90" stroke="oklch(1 0 0 / .55)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export type CapTone = "amber" | "silver" | "ink";

const CAP_TONES: Record<CapTone, string> = {
  amber: styles.amber,
  silver: styles.silver,
  ink: styles.ink,
};

interface BottleCapProps {
  tone: CapTone;
  className?: string;
  onClick?: MouseEventHandler<SVGSVGElement>;
}

export function BottleCap({ tone, className, onClick }: BottleCapProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn(styles.cap, CAP_TONES[tone], className)}
      aria-hidden="true"
      onClick={onClick}
    >
      <circle cx="32" cy="32" r="27" fill="var(--cap-edge)" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="var(--cap-crimp)" strokeWidth="7" strokeDasharray="3.3 3.75" />
      <circle cx="32" cy="32" r="22.5" fill="var(--cap-body)" />
      <circle cx="32" cy="32" r="13" fill="none" stroke="var(--cap-dent)" strokeWidth="2.5" />
      <path d="M19 24a16 16 0 0 1 9-7" fill="none" stroke="oklch(1 0 0 / .45)" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}
