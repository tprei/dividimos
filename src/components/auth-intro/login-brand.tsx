"use client";

import {
  animate,
  cancelFrame,
  frame,
  useAnimate,
  useMotionValue,
  useReducedMotion,
  type AnimationPlaybackControls,
  type FrameData,
} from "framer-motion";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { haptics } from "@/hooks/use-haptics";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import type { IntroSceneStage } from "./scene-stage";

const CENTER_X = 120;
const CENTER_Y = 75;
const RADIUS_X = 96;
const RADIUS_Y = 44;
const BASE_ANGLES = [-150, -30, 90].map((degrees) => (degrees * Math.PI) / 180);
const RADIANS_PER_MS = (Math.PI * 2) / 22000;
const MAX_FRAME_MS = 64;
const BOOST_DECAY_PER_MS = 0.9975;
const GROW_BOOST = 6;
const TAP_BOOST = 10;
const GROW_SECONDS = 0.9;
const SPLIT_MS = 400;
const SPRING_EASE: [number, number, number, number] = [0.34, 1.56, 0.64, 1];

const easeBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

type OrbitLayerName = "back" | "front";
type OrbitNodes = Record<OrbitLayerName, (SVGGElement | null)[]>;

interface OrbitPose {
  transform: string;
  front: boolean;
}

function orbitPose(baseAngle: number, angle: number, radius: number): OrbitPose {
  const a = baseAngle + angle;
  const depth = Math.sin(a);
  const x = CENTER_X + Math.cos(a) * RADIUS_X * radius;
  const y = CENTER_Y + depth * RADIUS_Y * radius;
  const scale = (0.95 + (0.35 * (depth + 1)) / 2) * Math.min(1.2, Math.max(0, radius));
  return {
    transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(3)})`,
    front: depth > 0,
  };
}

const COLLAPSED_POSES = BASE_ANGLES.map((baseAngle) => orbitPose(baseAngle, 0, 0));

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function isDocumentVisible() {
  return document.visibilityState === "visible";
}

function isServerVisible() {
  return true;
}

function ReceiptArt() {
  return (
    <g transform="translate(-11 -15)">
      <path
        d="M0,0 H22 V26 L18.3,30 L14.7,26 L11,30 L7.3,26 L3.7,30 L0,26 Z"
        fill="var(--paper)"
        stroke="var(--obj-receipt-edge)"
        strokeWidth="1.2"
      />
      <rect x="4" y="5" width="14" height="2.4" rx="1.2" fill="var(--ink)" opacity=".75" />
      <rect x="4" y="10.5" width="14" height="1.8" rx=".9" fill="var(--ink-soft)" opacity=".5" />
      <rect x="4" y="15" width="10" height="1.8" rx=".9" fill="var(--ink-soft)" opacity=".5" />
      <rect x="4" y="19.5" width="14" height="1.8" rx="1.8" fill="var(--primary)" />
    </g>
  );
}

function ChoppArt() {
  return (
    <g transform="translate(-10 -14)">
      <path d="M1,6 L19,6 L17,27 Q16.6,30 13.6,30 H6.4 Q3.4,30 3,27 Z" fill="var(--food-gold)" />
      <path d="M5,10 L6,25" stroke="#fff" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
      <path d="M-1,8 C-2,1 5,-2 8,1 C10,-3 16,-3 17,1 C21,0 23,5 21,8 Z" fill="var(--food-foam)" />
    </g>
  );
}

function PixQrArt() {
  return (
    <g transform="translate(-13 -13)">
      <rect width="26" height="26" rx="7" fill="var(--paper)" stroke="var(--pix)" strokeWidth="1.6" />
      <rect x="5" y="5" width="6.5" height="6.5" rx="1.5" fill="var(--pix-deep)" />
      <rect x="14.5" y="5" width="6.5" height="6.5" rx="1.5" fill="var(--pix-deep)" />
      <rect x="5" y="14.5" width="6.5" height="6.5" rx="1.5" fill="var(--pix-deep)" />
      <rect x="15" y="15" width="2.6" height="2.6" fill="var(--pix)" />
      <rect x="18.4" y="18.4" width="2.6" height="2.6" fill="var(--pix)" />
    </g>
  );
}

const ORBIT_ART = [
  { id: "receipt", Art: ReceiptArt },
  { id: "chopp", Art: ChoppArt },
  { id: "pix", Art: PixQrArt },
];

interface OrbitLayerProps {
  layer: OrbitLayerName;
  register: (layer: OrbitLayerName, index: number, node: SVGGElement | null) => void;
}

/** Each object is drawn in both layers so it can pass behind and in front of the mark without moving React-owned nodes. */
function OrbitLayer({ layer, register }: OrbitLayerProps) {
  return (
    <g>
      {ORBIT_ART.map(({ id, Art }, index) => (
        <g
          key={id}
          ref={(node) => register(layer, index, node)}
          transform={COLLAPSED_POSES[index].transform}
          style={{ visibility: COLLAPSED_POSES[index].front === (layer === "front") ? "visible" : "hidden" }}
        >
          <Art />
        </g>
      ))}
    </g>
  );
}

interface LoginBrandProps {
  stage: IntroSceneStage;
}

export function LoginBrand({ stage }: LoginBrandProps) {
  const still = useReducedMotion() === true;
  const visible = useSyncExternalStore(subscribeVisibility, isDocumentVisible, isServerVisible);
  const [intro] = useState(() => stage === "play");
  const [splitTaps, setSplitTaps] = useState(0);
  const [scope, animateInScope] = useAnimate<SVGSVGElement>();
  const rootRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<SVGGElement>(null);
  const nodes = useRef<OrbitNodes>({ back: [], front: [] });
  const angle = useRef(0);
  const boost = useRef(0);
  const bump = useRef<AnimationPlaybackControls | null>(null);
  const previousStage = useRef<IntroSceneStage | null>(null);
  const radius = useMotionValue(0);

  const register = useCallback((layer: OrbitLayerName, index: number, node: SVGGElement | null) => {
    nodes.current[layer][index] = node;
  }, []);

  const place = useCallback(() => {
    const currentRadius = radius.get();
    BASE_ANGLES.forEach((baseAngle, index) => {
      const pose = orbitPose(baseAngle, angle.current, currentRadius);
      for (const layer of ["back", "front"] as const) {
        const node = nodes.current[layer][index];
        if (!node) continue;
        node.setAttribute("transform", pose.transform);
        node.style.visibility = pose.front === (layer === "front") ? "visible" : "hidden";
      }
    });
  }, [radius]);

  useEffect(() => radius.on("change", place), [radius, place]);

  useEffect(() => {
    const from = previousStage.current;
    previousStage.current = stage;
    bump.current?.complete();

    if (still) {
      angle.current = 0;
      boost.current = 0;
      radius.set(1);
      place();
      return;
    }
    if (stage !== "play") {
      radius.set(stage === "ready" ? 0 : 1);
      place();
      return;
    }
    if (from === "rest") return;

    radius.set(0);
    place();
    boost.current = GROW_BOOST;
    const grow = animate(radius, 1, { duration: GROW_SECONDS, ease: easeBack });
    return () => grow.stop();
  }, [stage, still, radius, place]);

  const live = stage === "play" && !still && visible;

  useEffect(() => {
    const root = rootRef.current;
    if (!live || !root) return;

    root.dataset.loop = "";
    let last = performance.now();
    const spin = ({ timestamp }: FrameData) => {
      const elapsed = Math.min(MAX_FRAME_MS, Math.max(0, timestamp - last));
      last = timestamp;
      boost.current *= Math.pow(BOOST_DECAY_PER_MS, elapsed);
      angle.current += elapsed * RADIANS_PER_MS * (1 + boost.current);
      place();
    };
    frame.update(spin, true);
    return () => {
      cancelFrame(spin);
      delete root.dataset.loop;
    };
  }, [live, place]);

  useEffect(() => {
    if (splitTaps === 0) return;
    const timer = setTimeout(() => setSplitTaps(0), SPLIT_MS);
    return () => clearTimeout(timer);
  }, [splitTaps]);

  const handleWordmarkTap = () => {
    haptics.tap();
    if (still) return;
    setSplitTaps((taps) => taps + 1);
  };

  const handleMarkTap = () => {
    haptics.tap();
    if (still) return;
    setSplitTaps((taps) => taps + 1);
    boost.current = TAP_BOOST;
    const mark = markRef.current;
    if (!mark) return;
    bump.current?.stop();
    bump.current = animateInScope(
      mark,
      { scale: [1, 1.05, 1] },
      { duration: 0.46, times: [0, 0.3, 1], ease: [SPRING_EASE, SPRING_EASE] },
    );
  };

  return (
    <div ref={rootRef} className={cn("flex flex-col items-center", intro && "intro-enter-up")}>
      <svg
        ref={scope}
        viewBox="0 0 240 150"
        aria-hidden="true"
        className="h-42.5 w-68 flex-none overflow-visible intro-short:h-32 intro-tiny:h-23"
      >
        <ellipse
          cx={CENTER_X}
          cy={CENTER_Y}
          rx={RADIUS_X}
          ry={RADIUS_Y}
          fill="none"
          stroke="var(--border)"
          strokeWidth="1.4"
          strokeDasharray="2 6"
          strokeLinecap="round"
        />
        <OrbitLayer layer="back" register={register} />
        <g className="cursor-pointer" onClick={handleMarkTap}>
          <circle cx={CENTER_X} cy={CENTER_Y} r="36" fill="var(--primary)" opacity=".14" />
          <g transform={`translate(${CENTER_X} ${CENTER_Y})`}>
            <g ref={markRef} className="intro-fx">
              <rect x="-24" y="-24" width="48" height="48" rx="13.5" fill="var(--primary)" />
              <circle className="intro-mark-dot-left" cx="-12" cy="0" r="4.2" fill="#fff" />
              <rect x="-3.5" y="-11.4" width="7" height="22.8" rx="3.5" fill="#fff" />
              <circle className="intro-mark-dot-right" cx="12" cy="0" r="4.2" fill="#fff" />
            </g>
          </g>
        </g>
        <OrbitLayer layer="front" register={register} />
      </svg>
      <button
        type="button"
        aria-label={BRAND.domain}
        data-split={splitTaps > 0 ? "" : undefined}
        onClick={handleWordmarkTap}
        className="intro-wordmark mt-0.5 flex min-h-11 touch-manipulation items-center rounded-[14px] px-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          aria-hidden="true"
          className="text-[34px] leading-none font-extrabold tracking-[-0.035em] intro-tiny:text-[28px]"
        >
          <span className="intro-wordmark-left">
            <i>divid</i>
          </span>
          <span className="intro-wordmark-right">
            <i>imos</i>
          </span>
          <span className="text-primary-text">.ai</span>
        </span>
      </button>
      <p className="text-[15px] font-semibold text-muted-foreground">{BRAND.tagline}</p>
    </div>
  );
}
