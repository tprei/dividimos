import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { NeonSign } from "./neon-sign";
import { Glint, SeaMotion, VARAL_BOXES, VaralBulbs, VaralLine } from "./scenery-parts";
import parts from "./scenery.module.css";
import styles from "./night-bar.module.css";

type Band = "phone" | "tablet" | "desk";

interface Star {
  x: string;
  y: number;
  size: number;
  big: boolean;
  bands: ReadonlyArray<Band>;
}

interface Firefly {
  x: string;
  dy: number;
  wide: boolean;
}

const HERO_STARS: ReadonlyArray<Star> = [
  { x: "74%", y: 0.12, size: 2, big: false, bands: ["phone", "desk"] },
  { x: "90%", y: 0.27, size: 9, big: true, bands: ["phone", "tablet", "desk"] },
  { x: "80%", y: 0.21, size: 1.5, big: false, bands: ["phone", "tablet", "desk"] },
  { x: "57%", y: 0.8, size: 1.5, big: false, bands: ["phone", "desk"] },
  { x: "66%", y: 0.93, size: 10, big: true, bands: ["phone", "desk"] },
  { x: "96%", y: 0.8, size: 2, big: false, bands: ["phone", "tablet", "desk"] },
  { x: "4%", y: 0.24, size: 2, big: false, bands: ["desk"] },
  { x: "14%", y: 0.13, size: 9, big: true, bands: ["desk"] },
  { x: "19%", y: 0.42, size: 1.5, big: false, bands: ["desk"] },
  { x: "29%", y: 0.27, size: 1.5, big: false, bands: ["desk"] },
  { x: "39%", y: 0.09, size: 1.5, big: false, bands: ["desk"] },
  { x: "45%", y: 0.36, size: 11, big: true, bands: ["desk"] },
  { x: "50%", y: 0.66, size: 1.5, big: false, bands: ["desk"] },
  { x: "55%", y: 0.18, size: 2, big: false, bands: ["desk"] },
  { x: "61%", y: 0.47, size: 1.5, big: false, bands: ["desk"] },
  { x: "68%", y: 0.07, size: 2, big: false, bands: ["desk"] },
  { x: "84%", y: 0.5, size: 1.5, big: false, bands: ["tablet", "desk"] },
  { x: "93%", y: 0.62, size: 2, big: false, bands: ["tablet", "desk"] },
];

const HERO_FIREFLIES: ReadonlyArray<Firefly> = [
  { x: "6%", dy: 40, wide: false },
  { x: "17%", dy: 150, wide: true },
  { x: "28%", dy: 80, wide: false },
  { x: "37%", dy: 205, wide: true },
  { x: "9%", dy: 230, wide: true },
];

function twinkleTiming(index: number) {
  return { "--t": `${3 + (index % 4) * 0.7}s`, "--d": `${-index * 0.83}s` };
}

function fireflyStyle(fly: Firefly, index: number): CSSProperties {
  return {
    "--x": fly.x,
    "--dy": `${fly.dy}px`,
    "--t": `${8 + index * 1.3}s`,
    "--d": `${-index * 2.1}s`,
  } as CSSProperties;
}

function Moon() {
  return (
    <div className={cn(parts.skyBody, styles.moon)}>
      <svg viewBox="0 0 100 100">
        <defs>
          <radialGradient id="sn-moon" cx=".4" cy=".36" r=".68">
            <stop offset=".2" style={{ stopColor: "var(--moon-light)" }} />
            <stop offset="1" style={{ stopColor: "var(--moon-edge)" }} />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="46" fill="url(#sn-moon)" />
        <g style={{ fill: "var(--moon-mare)" }}>
          <circle cx="35" cy="37" r="9" />
          <circle cx="58" cy="29" r="5.5" />
          <circle cx="62" cy="58" r="11" />
          <circle cx="40" cy="67" r="6.5" />
          <circle cx="75" cy="41" r="3.5" />
          <circle cx="24" cy="55" r="3" />
        </g>
      </svg>
    </div>
  );
}

function Stars() {
  return (
    <div className={styles.stars}>
      {HERO_STARS.map((star, index) => (
        <i
          key={star.x}
          className={cn(styles.star, star.big && styles.big, ...star.bands.map((band) => styles[band]))}
          style={{ "--x": star.x, "--y": star.y, "--s": `${star.size}px`, ...twinkleTiming(index) } as CSSProperties}
        />
      ))}
    </div>
  );
}

export function NightBar() {
  const boxes = VARAL_BOXES.hero;
  return (
    <div className={styles.night}>
      <div className={parts.ground} />
      <div className={styles.pool} />
      <Moon />
      {boxes.map((box) => (
        <VaralLine key={box} lit className={box} />
      ))}
      <NeonSign className={parts.desk} />
      {boxes.map((box) => (
        <VaralBulbs key={box} lit className={box} />
      ))}
      <Stars />
      <SeaMotion>
        <Glint />
      </SeaMotion>
      {HERO_FIREFLIES.map((fly, index) => (
        <i
          key={fly.x}
          className={cn(styles.firefly, fly.wide && parts.wide)}
          style={fireflyStyle(fly, index)}
        />
      ))}
    </div>
  );
}
