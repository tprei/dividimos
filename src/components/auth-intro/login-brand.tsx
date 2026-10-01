"use client";

import { useAnimate, type AnimationPlaybackControls } from "framer-motion";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { haptics } from "@/hooks/use-haptics";
import { REDUCED_MOTION_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { easeBack, EASE_SPRING } from "./scene-motion";
import type { IntroSceneStage } from "./scene-stage";

const CENTER_X = 120;
const CENTER_Y = 75;
const RADIUS_X = 96;
const RADIUS_Y = 44;
const BASE_ANGLES = [-150, -30, 90].map((degrees) => (degrees * Math.PI) / 180);
const ORBIT_MS = 22000;
const MAX_FRAME_MS = 64;
const BOOST_DECAY_PER_MS = 0.9975;
const GROW_BOOST = 6;
const TAP_BOOST = 10;
const GROW_SECONDS = 0.9;
const SPLIT_MS = 400;

type OrbitLayerName = "back" | "front";
type OrbitNodes = Record<OrbitLayerName, (HTMLDivElement | null)[]>;

interface OrbitPose {
  transform: string;
  front: boolean;
}

function orbitPose(baseAngle: number, angle: number): OrbitPose {
  const a = baseAngle + angle;
  const depth = Math.sin(a);
  const x = CENTER_X + Math.cos(a) * RADIUS_X;
  const y = CENTER_Y + depth * RADIUS_Y;
  const scale = 0.95 + (0.35 * (depth + 1)) / 2;
  return {
    transform: `translate(${(((x - 15) / 30) * 100).toFixed(3)}%, ${(((y - 15) / 30) * 100).toFixed(3)}%) scale(${scale.toFixed(3)})`,
    front: depth > 0,
  };
}

const BASE_POSES = BASE_ANGLES.map((baseAngle) => orbitPose(baseAngle, 0));

const COLLAPSED_LAYER: CSSProperties = { transform: "scale(0)" };

const ORBIT_KEYFRAMES = Array.from({ length: 73 }, (_, k) => ({
  transform: orbitPose(0, (Math.PI * 2 * k) / 72).transform,
}));

const ORBIT_OPACITY: Record<OrbitLayerName, Keyframe[]> = {
  back: [
    { opacity: 0, easing: "step-end" },
    { opacity: 1, easing: "step-end", offset: 0.5 },
    { opacity: 0 },
  ],
  front: [
    { opacity: 1, easing: "step-end" },
    { opacity: 0, easing: "step-end", offset: 0.5 },
    { opacity: 1 },
  ],
};

const GROW_KEYFRAMES = Array.from({ length: 25 }, (_, k) => ({
  transform: `scale(${easeBack(k / 24).toFixed(4)})`,
  offset: k / 24,
}));

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
  register: (layer: OrbitLayerName, index: number, node: HTMLDivElement | null) => void;
  registerWrapper: (layer: OrbitLayerName, node: HTMLDivElement | null) => void;
}

/** Each object is drawn in both layers so it can pass behind and in front of the mark without moving React-owned nodes. */
function OrbitLayer({ layer, register, registerWrapper }: OrbitLayerProps) {
  return (
    <div
      ref={(node) => registerWrapper(layer, node)}
      className="pointer-events-none absolute inset-0"
      style={COLLAPSED_LAYER}
    >
      {ORBIT_ART.map(({ id, Art }, index) => (
        <div
          key={id}
          ref={(node) => register(layer, index, node)}
          className="absolute top-0 left-0 aspect-square w-[12.5%]"
          style={{
            transform: BASE_POSES[index].transform,
            opacity: BASE_POSES[index].front === (layer === "front") ? 1 : 0,
          }}
        >
          <svg viewBox="-15 -15 30 30" className="block size-full overflow-visible">
            <Art />
          </svg>
        </div>
      ))}
    </div>
  );
}

function createOrbitAnimations(nodes: OrbitNodes): Animation[] {
  const animations: Animation[] = [];
  for (const layer of ["back", "front"] as const) {
    BASE_ANGLES.forEach((baseAngle, index) => {
      const node = nodes[layer][index];
      if (!node) return;
      const phase = ((((baseAngle / (Math.PI * 2)) % 1) + 1) % 1) * ORBIT_MS;
      const options: KeyframeAnimationOptions = {
        duration: ORBIT_MS,
        iterations: Infinity,
        easing: "linear",
        delay: -phase,
      };
      animations.push(node.animate(ORBIT_KEYFRAMES, options));
      animations.push(node.animate(ORBIT_OPACITY[layer], options));
    });
  }
  return animations;
}

interface LoginBrandProps {
  stage: IntroSceneStage;
}

export function LoginBrand({ stage }: LoginBrandProps) {
  const still = useMediaQuery(REDUCED_MOTION_QUERY);
  const visible = useSyncExternalStore(subscribeVisibility, isDocumentVisible, isServerVisible);
  const [intro] = useState(() => stage === "play");
  const [splitTaps, setSplitTaps] = useState(0);
  const [scope, animateInScope] = useAnimate<HTMLDivElement>();
  const rootRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const nodes = useRef<OrbitNodes>({ back: [], front: [] });
  const wrappers = useRef<Record<OrbitLayerName, HTMLDivElement | null>>({ back: null, front: null });
  const orbit = useRef<Animation[] | null>(null);
  const boost = useRef(0);
  const boostFrame = useRef<number | null>(null);
  const bump = useRef<AnimationPlaybackControls | null>(null);
  const previousStage = useRef<IntroSceneStage | null>(null);

  const register = useCallback((layer: OrbitLayerName, index: number, node: HTMLDivElement | null) => {
    nodes.current[layer][index] = node;
  }, []);

  const registerWrapper = useCallback((layer: OrbitLayerName, node: HTMLDivElement | null) => {
    wrappers.current[layer] = node;
  }, []);

  const setWrapperScale = useCallback((transform: string) => {
    if (wrappers.current.back) wrappers.current.back.style.transform = transform;
    if (wrappers.current.front) wrappers.current.front.style.transform = transform;
  }, []);

  const startBoostDecay = useCallback(() => {
    if (boostFrame.current !== null) return;
    let last = performance.now();
    const tick = (timestamp: number) => {
      const elapsed = Math.min(MAX_FRAME_MS, Math.max(0, timestamp - last));
      last = timestamp;
      boost.current *= Math.pow(BOOST_DECAY_PER_MS, elapsed);
      const settled = boost.current < 0.01;
      if (settled) boost.current = 0;
      for (const animation of orbit.current ?? []) animation.playbackRate = 1 + boost.current;
      boostFrame.current = settled ? null : requestAnimationFrame(tick);
    };
    boostFrame.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const from = previousStage.current;
    previousStage.current = stage;
    bump.current?.complete();

    if (still) {
      boost.current = 0;
      for (const animation of orbit.current ?? []) animation.cancel();
      orbit.current = null;
      setWrapperScale("scale(1)");
      return;
    }
    if (stage !== "play") {
      for (const animation of orbit.current ?? []) animation.pause();
      setWrapperScale(stage === "ready" ? "scale(0)" : "scale(1)");
      return;
    }
    if (from === "rest") return;

    setWrapperScale("scale(1)");
    const growBack = wrappers.current.back?.animate(GROW_KEYFRAMES, {
      duration: GROW_SECONDS * 1000,
      easing: "linear",
    });
    const growFront = wrappers.current.front?.animate(GROW_KEYFRAMES, {
      duration: GROW_SECONDS * 1000,
      easing: "linear",
    });
    boost.current = GROW_BOOST;
    startBoostDecay();
    return () => {
      growBack?.cancel();
      growFront?.cancel();
    };
  }, [stage, still, setWrapperScale, startBoostDecay]);

  const live = stage === "play" && !still && visible;

  useEffect(() => {
    const root = rootRef.current;
    if (!live || !root) return;

    if (orbit.current === null) orbit.current = createOrbitAnimations(nodes.current);
    for (const animation of orbit.current) animation.play();
    root.dataset.loop = "";
    return () => {
      for (const animation of orbit.current ?? []) animation.pause();
      delete root.dataset.loop;
    };
  }, [live]);

  useEffect(
    () => () => {
      if (boostFrame.current !== null) cancelAnimationFrame(boostFrame.current);
      boostFrame.current = null;
    },
    [],
  );

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
    startBoostDecay();
    const mark = markRef.current;
    if (!mark) return;
    bump.current?.stop();
    bump.current = animateInScope(
      mark,
      { scale: [1, 1.05, 1] },
      { duration: 0.46, times: [0, 0.3, 1], ease: EASE_SPRING },
    );
  };

  return (
    <div ref={rootRef} className={cn("flex flex-col items-center", intro && "intro-enter-up")}>
      <div
        aria-hidden="true"
        className="flex h-42.5 w-68 flex-none justify-center intro-short:h-32 intro-tiny:h-23"
      >
        <div ref={scope} className="relative aspect-[240/150] h-full">
          <svg viewBox="0 0 240 150" className="absolute inset-0 size-full overflow-visible">
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
          </svg>
          <OrbitLayer layer="back" register={register} registerWrapper={registerWrapper} />
          <div
            className="absolute top-[26%] left-[35%] aspect-square w-[30%] cursor-pointer rounded-full"
            onClick={handleMarkTap}
          >
            <span className="absolute inset-0 rounded-full bg-primary opacity-14" />
            <span ref={markRef} className="absolute top-[16.6667%] left-[16.6667%] size-[66.6667%]">
              <svg viewBox="-24 -24 48 48" className="absolute inset-0 size-full">
                <rect x="-24" y="-24" width="48" height="48" rx="13.5" fill="var(--primary)" />
                <rect x="-3.5" y="-11.4" width="7" height="22.8" rx="3.5" fill="#fff" />
              </svg>
              <svg viewBox="-24 -24 48 48" className="intro-mark-dot-left absolute inset-0 size-full">
                <circle cx="-12" cy="0" r="4.2" fill="#fff" />
              </svg>
              <svg viewBox="-24 -24 48 48" className="intro-mark-dot-right absolute inset-0 size-full">
                <circle cx="12" cy="0" r="4.2" fill="#fff" />
              </svg>
            </span>
          </div>
          <OrbitLayer layer="front" register={register} registerWrapper={registerWrapper} />
        </div>
      </div>
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
