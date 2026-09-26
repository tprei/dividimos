"use client";

import { useRef, type CSSProperties, type MouseEvent } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { pointOf, useClickFx } from "./click-fx";
import { BeerBottle, BottleCap, IsoporBottle, type CapTone } from "./table-art";
import styles from "./hero-scene.module.css";

interface Drop {
  x: string;
  y: string;
  delay: string;
}

const BOTTLE_DROPS: Drop[] = [
  { x: "20%", y: "57%", delay: ".2s" },
  { x: "70%", y: "54%", delay: "2.1s" },
  { x: "44%", y: "88%", delay: "3.4s" },
  { x: "80%", y: "89%", delay: "1.2s" },
  { x: "40%", y: "28%", delay: "4.3s" },
];

const ISOPOR_DROPS: Drop[] = [
  { x: "40%", y: "14%", delay: "1.6s" },
  { x: "56%", y: "34%", delay: "3.8s" },
];

function Drops({ drops }: { drops: Drop[] }) {
  return drops.map((drop) => (
    <i
      key={`${drop.x}-${drop.y}`}
      className={styles.drop}
      style={{ "--x": drop.x, "--y": drop.y, "--d": drop.delay } as CSSProperties}
    />
  ));
}

function clinkKeyframes(tilt: number): Keyframe[] {
  return [
    { transform: "rotate(0deg)" },
    { transform: `rotate(${tilt}deg)`, offset: 0.35 },
    { transform: `rotate(${tilt * -0.375}deg)`, offset: 0.7 },
    { transform: "rotate(0deg)" },
  ];
}

export function ClinkBottles() {
  const reduceMotion = useReducedMotion();
  const fx = useClickFx();
  const bottle = useRef<HTMLDivElement>(null);
  const isopor = useRef<HTMLDivElement>(null);

  const clink = (event: MouseEvent<HTMLDivElement>) => {
    if (reduceMotion) return;
    const options = { duration: 800, easing: "ease-in-out" };
    bottle.current?.animate(clinkKeyframes(8), options);
    isopor.current?.animate(clinkKeyframes(-8), options);
    const point = pointOf(event, event.currentTarget);
    fx.floatText(point, "tim-tim!", "amber");
    fx.burst(point, "amber", 10);
  };

  return (
    <>
      <div
        ref={bottle}
        className={cn(styles.prop, styles.toy, styles.bottle1)}
        aria-hidden="true"
        onClick={clink}
      >
        <BeerBottle />
        <Drops drops={BOTTLE_DROPS} />
      </div>
      <div
        ref={isopor}
        className={cn(styles.prop, styles.toy, styles.bottle2)}
        aria-hidden="true"
        onClick={clink}
      >
        <IsoporBottle />
        <Drops drops={ISOPOR_DROPS} />
      </div>
    </>
  );
}

export function FlipCap({ tone, className }: { tone: CapTone; className: string }) {
  const reduceMotion = useReducedMotion();

  const flip = (event: MouseEvent<SVGSVGElement>) => {
    if (reduceMotion) return;
    const direction = Math.random() < 0.5 ? -1 : 1;
    const shift = direction * (14 + Math.random() * 16);
    event.currentTarget.animate(
      [
        { transform: "translate(0, 0) rotate(0turn)" },
        { transform: `translate(${shift}px, -12px) rotate(${direction * 0.9}turn)`, offset: 0.45 },
        { transform: "translate(0, 0) rotate(0turn)" },
      ],
      { duration: 900, easing: "cubic-bezier(.3, .8, .3, 1)" },
    );
  };

  return <BottleCap tone={tone} className={cn(styles.toy, className)} onClick={flip} />;
}
