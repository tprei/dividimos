import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { Kite, Palm, Umbrella } from "./beach-props";
import type { SceneryVariant } from "./scenery";
import { Glint, SeaMotion, VARAL_BOXES, VaralBulbs, VaralLine } from "./scenery-parts";
import parts from "./scenery.module.css";
import styles from "./sunday-beach.module.css";

interface Cloud {
  x: string;
  width: string;
  k: number;
  o: number;
  duration: number;
  wide: boolean;
}

interface Gull {
  gx: number;
  gy: number;
  wide: boolean;
}

interface Sparkle {
  x: string;
  dy: number;
  wide: boolean;
}

const CLOUDS: ReadonlyArray<Cloud> = [
  { x: "8vw", width: "clamp(96px, 13vw, 190px)", k: 1, o: 0.15, duration: 110, wide: false },
  { x: "58vw", width: "clamp(70px, 9vw, 130px)", k: 0.72, o: 0.9, duration: 140, wide: false },
  { x: "34vw", width: "clamp(80px, 10vw, 150px)", k: 0.82, o: 0.5, duration: 125, wide: true },
];

const HERO_GULLS: ReadonlyArray<Gull> = [
  { gx: -1.05, gy: 0.35, wide: false },
  { gx: -0.78, gy: -0.25, wide: true },
  { gx: 1.25, gy: -0.62, wide: true },
];

const SKY_GULLS: ReadonlyArray<Gull> = [
  { gx: -1.05, gy: -0.5, wide: false },
  { gx: -0.78, gy: -0.25, wide: true },
];

const SPARKLES: ReadonlyArray<Sparkle> = [
  { x: "21%", dy: 9, wide: false },
  { x: "56%", dy: 14, wide: false },
  { x: "8%", dy: 34, wide: true },
  { x: "15%", dy: 86, wide: true },
  { x: "29%", dy: 52, wide: true },
  { x: "37%", dy: 128, wide: true },
  { x: "6%", dy: 160, wide: true },
];

const RAYS_LONG =
  "M39 0H60M27.6 27.6 42.4 42.4M0 39V60M-27.6 27.6-42.4 42.4M-39 0H-60M-27.6-27.6-42.4-42.4M0-39V-60M27.6-27.6 42.4-42.4";
const RAYS_SHORT =
  "M36 14.9 46.2 19.1M14.9 36 19.1 46.2M-14.9 36-19.1 46.2M-36 14.9-46.2 19.1M-36-14.9-46.2-19.1M-14.9-36-19.1-46.2M14.9-36 19.1-46.2M36-14.9 46.2-19.1";

function cloudStyle(cloud: Cloud, index: number): CSSProperties {
  return {
    "--x": cloud.x,
    "--w": cloud.width,
    "--k": cloud.k,
    "--o": cloud.o,
    "--t": `${cloud.duration}s`,
    "--d": `${-cloud.duration * (0.2 + index * 0.27)}s`,
  } as CSSProperties;
}

function gullStyle(gull: Gull, index: number): CSSProperties {
  return {
    "--gx": gull.gx,
    "--gy": gull.gy,
    "--t": `${11 + index * 3}s`,
    "--d": `${-index * 4}s`,
    "--flap": `${0.9 + index * 0.35}s`,
  } as CSSProperties;
}

function sparkleStyle(sparkle: Sparkle, index: number): CSSProperties {
  return {
    "--x": sparkle.x,
    "--dy": `${sparkle.dy}px`,
    "--d": `${-index * 0.7}s`,
  } as CSSProperties;
}

function Sun() {
  return (
    <div className={cn(parts.skyBody, styles.sun)}>
      <svg viewBox="-70 -70 140 140">
        <circle r="31" style={{ fill: "var(--sun-edge)" }} />
        <circle r="25" style={{ fill: "var(--sun-core)" }} />
        <path d="M-15-12a19 19 0 0 1 14-8" style={{ fill: "none", stroke: "var(--sun-shine)", strokeWidth: 4, strokeLinecap: "round" }} />
      </svg>
      <svg className={styles.rays} viewBox="-70 -70 140 140">
        <path d={RAYS_LONG} strokeWidth="5" />
        <path d={RAYS_SHORT} strokeWidth="3.5" />
      </svg>
    </div>
  );
}

export function SundayBeach({ variant }: { variant: SceneryVariant }) {
  const hero = variant === "hero";
  const props = hero ? parts.desk : parts.gutter;
  const boxes = hero ? VARAL_BOXES.hero : [];
  return (
    <div className={cn(styles.day, hero ? styles.hero : styles.onboarding)}>
      <div className={parts.ground} />
      {boxes.map((box) => (
        <VaralLine key={box} lit={false} className={box} />
      ))}
      <Sun />
      {boxes.map((box) => (
        <VaralBulbs key={box} lit={false} className={box} />
      ))}
      <div className={parts.lane}>
        {CLOUDS.map((cloud, index) => (
          <svg
            key={cloud.x}
            className={cn(styles.cloud, cloud.wide && parts.wide)}
            style={cloudStyle(cloud, index)}
            viewBox="0 0 120 50"
          >
            <path d="M14 47C5 47 2 36 10 32 8 21 21 15 30 21 34 9 51 5 60 15 67 5 85 8 87 22 97 17 110 26 105 36 114 38 115 47 106 47Z" />
            <path className={styles.cloudShade} d="M7 41C20 46 80 46 113 42 112 45 110 47 106 47H14C10 47 8 45 7 41Z" />
          </svg>
        ))}
      </div>
      {variant !== "auth" && <Palm className={props} />}
      {(hero ? HERO_GULLS : SKY_GULLS).map((gull, index) => (
        <i key={gull.gx} className={cn(styles.gull, gull.wide && parts.wide)} style={gullStyle(gull, index)}>
          <svg viewBox="0 0 40 16">
            <path d="M1 8C7 2 14 2 20 9 26 2 33 2 39 8 33 5 26 6 20 13 14 6 7 5 1 8Z" />
          </svg>
        </i>
      ))}
      <SeaMotion>
        <Glint />
        {SPARKLES.map((sparkle, index) => (
          <i
            key={sparkle.x}
            className={cn(styles.sparkle, sparkle.wide && parts.wide)}
            style={sparkleStyle(sparkle, index)}
          >
            <svg viewBox="0 0 100 100">
              <use href="#sc-sparkle" />
            </svg>
          </i>
        ))}
      </SeaMotion>
      {variant !== "auth" && <Kite className={props} tether={hero ? "short" : "long"} />}
      {variant !== "auth" && <Umbrella className={props} />}
    </div>
  );
}
