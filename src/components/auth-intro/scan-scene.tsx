"use client";

import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type EasingFunction,
  type EasingDefinition,
  type MotionValue,
} from "framer-motion";
import { useEffectEvent, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { haptics } from "@/hooks/use-haptics";
import { formatBRL } from "@/lib/currency";
import {
  INTRO_ITEMS,
  INTRO_SERVICE_CENTS,
  INTRO_TOTAL_CENTS,
  type IntroItemId,
} from "@/lib/intro-demo-bill";
import { centsText } from "@/lib/item-division";
import { FoodIcon } from "./food-icon";
import { scenePart, sceneParts, setFlag, setOpacity } from "./scene-dom";
import {
  bump,
  createSceneRunner,
  easeBack,
  EASE_IN_OUT,
  EASE_OUT,
  EASE_SNAP,
  popIn,
  press,
  type SceneClock,
} from "./scene-motion";
import type { IntroSceneProps, IntroSceneStage } from "./scene-stage";

interface PhonePose {
  x: number;
  y: number;
  r: number;
  s: number;
}

const PHONE_REST: PhonePose = { x: 290, y: 412, r: 12, s: 0.92 };
const PHONE_OFF: PhonePose = { x: 540, y: 330, r: 30, s: 0.92 };
const PHONE_AIM: PhonePose = { x: 112, y: 206, r: -4, s: 1.12 };
const RECEIPT_ROW_Y = [160.5, 181.5, 202.5, 223.5, 244.5];
const LIST_ROW_Y = [124.5, 149.5, 174.5, 199.5, 224.5];
const LIST_ICON_Y = [125, 151, 175, 200, 225];
const RECEIPT_TILT = (-4 * Math.PI) / 180;
const BEAM_FROM = 150;
const BEAM_TO = 258;
const RECEIPT_NAMES: Record<IntroItemId, string> = {
  chopp: "Chopp",
  batata: "Batata",
  caipirinha: "Caipirinha",
  pastel: "Pastel 6un",
  guarana: "Guaraná",
};
const RECEIPT_LEADERS = [
  { x: 112, dots: "......." },
  { x: 113, dots: "......" },
  { x: 122, dots: "..." },
  { x: 122, dots: "..." },
  { x: 113, dots: "......." },
];
const BARCODE: readonly (readonly [number, number])[] = [
  [80, 2], [84, 1], [87, 3], [92, 1], [95, 2], [99, 3], [104, 1], [107, 2], [111, 1],
  [114, 3], [119, 2], [123, 1], [126, 3], [131, 1], [134, 2], [138, 3], [143, 2],
];

interface ScanNodes {
  phone: SVGGElement;
  bump: SVGGElement;
  shutterDot: SVGCircleElement;
  flash: SVGRectElement;
  beam: SVGGElement;
  beamLine: SVGRectElement;
  beamGlow: SVGEllipseElement;
  highlights: SVGRectElement[];
  rows: SVGGElement[];
  ghosts: SVGRectElement[];
  totalWrap: SVGGElement;
  check: SVGGElement;
  checkMark: SVGGElement;
  chips: SVGGElement[];
  chipBodies: SVGGElement[];
}

interface ScanRun {
  nodes: ScanNodes;
  clock: SceneClock;
  count: MotionValue<number>;
  pose: RefObject<PhonePose>;
}

function readNodes(svg: SVGSVGElement): ScanNodes {
  return {
    phone: scenePart(svg, "phone"),
    bump: scenePart(svg, "phone-bump"),
    shutterDot: scenePart(svg, "shutter-dot"),
    flash: scenePart(svg, "flash"),
    beam: scenePart(svg, "beam"),
    beamLine: scenePart(svg, "beam-line"),
    beamGlow: scenePart(svg, "beam-glow"),
    highlights: sceneParts(svg, "highlight"),
    rows: sceneParts(svg, "row"),
    ghosts: sceneParts(svg, "ghost"),
    totalWrap: scenePart(svg, "total"),
    check: scenePart(svg, "check"),
    checkMark: scenePart(svg, "check-mark"),
    chips: sceneParts(svg, "chip"),
    chipBodies: sceneParts(svg, "chip-body"),
  };
}

function poseTransform({ x, y, r, s }: PhonePose): string {
  return `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${r.toFixed(2)}) scale(${s.toFixed(3)})`;
}

function setPhone(run: ScanRun, pose: PhonePose) {
  run.pose.current = pose;
  run.nodes.phone.setAttribute("transform", poseTransform(pose));
}

function movePhone(run: ScanRun, to: PhonePose, ms: number, ease: EasingDefinition | EasingFunction) {
  const from = run.pose.current;
  return run.clock.play(
    animate(0, 1, {
      duration: ms / 1000,
      ease,
      onUpdate: (t) =>
        setPhone(run, {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
          r: from.r + (to.r - from.r) * t,
          s: from.s + (to.s - from.s) * t,
        }),
    }),
  );
}

function countTo(run: ScanRun, cents: number, ms: number) {
  void run.clock.play(animate(run.count, cents, { duration: ms / 1000, ease: EASE_OUT }));
}

function resetEffects(nodes: ScanNodes) {
  nodes.chips.forEach((chip) => (chip.style.visibility = "hidden"));
  nodes.highlights.forEach((highlight) => setOpacity(highlight, 0));
  setOpacity(nodes.beam, 0);
  setOpacity(nodes.flash, 0);
}

function clearResult(run: ScanRun) {
  const { nodes } = run;
  resetEffects(nodes);
  nodes.rows.forEach((row) => setFlag(row, "on", false));
  nodes.ghosts.forEach((ghost) => setFlag(ghost, "off", false));
  setOpacity(nodes.check, 0);
  run.count.set(0);
}

function showResult(run: ScanRun) {
  const { nodes } = run;
  resetEffects(nodes);
  nodes.rows.forEach((row) => setFlag(row, "on", true));
  nodes.ghosts.forEach((ghost) => setFlag(ghost, "off", true));
  setOpacity(nodes.check, 1);
  run.count.set(INTRO_TOTAL_CENTS);
  setPhone(run, PHONE_REST);
}

function chipTransform(t: number, from: { x: number; y: number }, to: { x: number; y: number }) {
  const control = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 48 };
  const u = 1 - t;
  const x = u * u * from.x + 2 * u * t * control.x + t * t * to.x;
  const y = u * u * from.y + 2 * u * t * control.y + t * t * to.y;
  const scale = 0.8 + 0.3 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 0.2 * t;
  const rotation = -6 * (1 - t) + 4 * Math.sin(Math.PI * t);
  return `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rotation.toFixed(2)}) scale(${scale.toFixed(3)})`;
}

async function flyRow(run: ScanRun, index: number) {
  const { nodes, clock } = run;
  clock.flourish(animate(nodes.highlights[index], { opacity: [0.5, 0] }, { duration: 0.8, ease: "easeOut" }));
  const dy = RECEIPT_ROW_Y[index] - 205;
  const from = { x: 112 - dy * Math.sin(RECEIPT_TILT), y: 205 + dy * Math.cos(RECEIPT_TILT) };
  const to = { x: 268, y: LIST_ROW_Y[index] };
  const chip = nodes.chips[index];
  const body = nodes.chipBodies[index];
  chip.setAttribute("transform", chipTransform(0, from, to));
  setOpacity(body, 1);
  chip.style.visibility = "visible";
  await clock.play(
    animate(0, 1, {
      duration: 0.6,
      ease: EASE_SNAP,
      onUpdate: (t) => {
        chip.setAttribute("transform", chipTransform(t, from, to));
        setOpacity(body, t > 0.86 ? (1 - t) / 0.14 : 1);
      },
    }),
  );
  chip.style.visibility = "hidden";
  setFlag(nodes.rows[index], "on", true);
  setFlag(nodes.ghosts[index], "off", true);
  const landed = INTRO_ITEMS.slice(0, index + 1).reduce((sum, item) => sum + item.totalCents, 0);
  countTo(run, landed, 360);
}

async function finishScan(run: ScanRun) {
  const { nodes, clock } = run;
  setFlag(nodes.rows[INTRO_ITEMS.length], "on", true);
  countTo(run, INTRO_TOTAL_CENTS, 520);
  void clock.wait(420).then(() => {
    setOpacity(nodes.check, 1);
    clock.flourish(popIn(nodes.checkMark));
    clock.flourish(bump(nodes.totalWrap));
  });
  await clock.wait(560);
  await movePhone(run, PHONE_REST, 760, EASE_SNAP);
}

async function capture(run: ScanRun) {
  const { nodes, clock } = run;
  clock.flourish(press(nodes.shutterDot));
  clock.flourish(bump(nodes.bump));
  void clock.play(animate(0.85, 0, { duration: 0.3, ease: EASE_OUT, onUpdate: (v) => setOpacity(nodes.flash, v) }));
  clearResult(run);
  setOpacity(nodes.beam, 1);
  const flights: Promise<void>[] = [];
  await clock.play(
    animate(BEAM_FROM, BEAM_TO, {
      duration: 1.35,
      ease: EASE_IN_OUT,
      onUpdate: (y) => {
        nodes.beamLine.setAttribute("y", (y - 2).toFixed(2));
        nodes.beamGlow.setAttribute("cy", y.toFixed(2));
        RECEIPT_ROW_Y.forEach((rowY, index) => {
          if (y >= rowY && flights.length === index) flights.push(flyRow(run, index));
        });
      },
    }),
  );
  void clock.play(animate(1, 0, { duration: 0.22, ease: EASE_OUT, onUpdate: (v) => setOpacity(nodes.beam, v) }));
  await Promise.all(flights);
  await clock.wait(320);
  await finishScan(run);
}

async function aimAndCapture(run: ScanRun, ms: number) {
  await movePhone(run, PHONE_AIM, ms, easeBack);
  await run.clock.wait(140);
  await capture(run);
}

async function autoplay(run: ScanRun) {
  setPhone(run, PHONE_OFF);
  clearResult(run);
  await run.clock.wait(260);
  await aimAndCapture(run, 720);
}

async function rescan(run: ScanRun) {
  clearResult(run);
  await aimAndCapture(run, 520);
}

export function ScanScene({ stage, onSettle, onBusy }: IntroSceneProps) {
  const still = useReducedMotion() === true;
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [firstFrame] = useState(() => stage !== "rest");
  const pose = useRef<PhonePose>(firstFrame ? PHONE_OFF : PHONE_REST);
  const previousStage = useRef<IntroSceneStage | null>(null);
  const [runner] = useState(createSceneRunner);
  const count = useMotionValue(firstFrame ? 0 : INTRO_TOTAL_CENTS);
  const totalText = useTransform(count, (cents) => formatBRL(Math.round(cents)));
  const settle = useEffectEvent(onSettle);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const from = previousStage.current;
    previousStage.current = stage;
    const run: ScanRun = { nodes: readNodes(svg), clock: runner.start(), count, pose };

    if (still || stage === "rest" || (stage === "play" && from === "rest")) {
      showResult(run);
      if (stage === "play") settle();
    } else if (stage === "ready") {
      setPhone(run, PHONE_OFF);
      clearResult(run);
    } else {
      void autoplay(run).then(settle);
    }
    return () => runner.stop();
  }, [stage, still, runner, count]);

  const handleTap = () => {
    haptics.tap();
    const svg = svgRef.current;
    if (still || svg === null) return;
    onBusy();
    void rescan({ nodes: readNodes(svg), clock: runner.start(), count, pose }).then(onSettle);
  };

  return (
    <svg
      ref={svgRef}
      viewBox="0 56 360 432"
      aria-hidden="true"
      onClick={handleTap}
      className="block size-full overflow-visible select-none"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="-6" y="60" width="372" height="424" rx="30" />
        </clipPath>
      </defs>
      <rect x="-6" y="60" width="372" height="424" rx="30" fill="var(--tint-1)" />
      <g clipPath={`url(#${clipId})`}>
        <circle cx="64" cy="128" r="94" fill="var(--primary)" opacity=".10" />
        <circle cx="318" cy="330" r="74" fill="var(--primary)" opacity=".07" />
        <circle cx="330" cy="70" r="6" fill="var(--primary)" opacity=".35" />
        <circle cx="178" cy="60" r="4" fill="var(--primary)" opacity=".3" />
      </g>

      <ChoppMug />
      <LimeWedge />
      <Receipt />
      <ItemsCard totalText={totalText} scanned={!firstFrame} />
      <Phone pose={firstFrame ? PHONE_OFF : PHONE_REST} />
      <FlyingChips />

      <rect
        data-part="flash"
        x="-40"
        y="-40"
        width="440"
        height="600"
        fill="#fff"
        pointerEvents="none"
        style={{ opacity: 0 }}
      />
    </svg>
  );
}

function ChoppMug() {
  return (
    <g>
      <ellipse cx="74" cy="459" rx="40" ry="6" fill="var(--obj-shadow)" />
      <path d="M48,362 L100,362 L95.5,444 Q95,454 85,454 L63,454 Q53,454 52.5,444 Z" fill="var(--food-gold)" />
      <path
        d="M100,378 h8 a12,12 0 0 1 12,12 v26 a12,12 0 0 1 -12,12 h-10"
        fill="none"
        stroke="var(--food-gold)"
        strokeWidth="7"
        strokeLinecap="round"
        opacity=".85"
      />
      <path d="M58,376 L60.5,440" stroke="#fff" strokeOpacity=".45" strokeWidth="5" strokeLinecap="round" />
      <circle cx="74" cy="426" r="2.3" fill="#fff" fillOpacity=".55" />
      <circle cx="85" cy="402" r="1.8" fill="#fff" fillOpacity=".5" />
      <circle cx="70" cy="396" r="1.4" fill="#fff" fillOpacity=".5" />
      <circle cx="88" cy="436" r="2" fill="#fff" fillOpacity=".45" />
      <path
        d="M44,368 C40,351 55,343 63,350 C65,337 85,336 88,348 C95,341 108,348 104,364 L101,370 L47,370 Z"
        fill="var(--food-foam)"
      />
      <circle cx="58" cy="357" r="2.2" fill="var(--food-gold)" opacity=".3" />
      <circle cx="90" cy="355" r="1.6" fill="var(--food-gold)" opacity=".3" />
    </g>
  );
}

function LimeWedge() {
  return (
    <g>
      <ellipse cx="186" cy="462" rx="26" ry="4" fill="var(--obj-shadow)" />
      <path d="M186,458 L169,433 A31,31 0 0 1 203,433 Z" fill="var(--food-lime)" />
      <line x1="186" y1="458" x2="177" y2="436.5" stroke="#fff" strokeOpacity=".65" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="186" y1="458" x2="195" y2="436.5" stroke="#fff" strokeOpacity=".65" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M172.5,435.5 A26,26 0 0 1 199.5,435.5" fill="none" stroke="var(--food-lime-rim)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M169,433 A31,31 0 0 1 203,433" fill="none" stroke="var(--food-lime-deep)" strokeWidth="3.2" strokeLinecap="round" />
    </g>
  );
}

function Receipt() {
  return (
    <g>
      <ellipse cx="116" cy="318" rx="66" ry="6" fill="var(--obj-shadow)" />
      <g transform="rotate(-4 112 205)">
        <path
          fill="var(--paper)"
          stroke="var(--paper-edge)"
          strokeWidth="1.2"
          d="M62,110 H162 V300 L156.25,308 L150,300 L143.75,308 L137.5,300 L131.25,308 L125,300 L118.75,308 L112.5,300 L106.25,308 L100,300 L93.75,308 L87.5,300 L81.25,308 L75,300 L68.75,308 L62.5,300 Z"
        />
        <text x="112" y="129" textAnchor="middle" fontSize="9.5" fontWeight="900" letterSpacing=".8" fill="var(--ink)">
          BOTECO DO ZÉ
        </text>
        <text x="112" y="140" textAnchor="middle" fontSize="5.8" fontWeight="600" fill="var(--ink-soft)">
          mesa 04 · 21:37
        </text>
        <line x1="68" y1="148" x2="156" y2="148" stroke="var(--ink-soft)" strokeOpacity=".5" strokeDasharray="1.6 2.4" />
        {INTRO_ITEMS.map((item, index) => (
          <rect
            key={item.id}
            data-part="highlight"
            x="64"
            y={153 + index * 21}
            width="96"
            height="15"
            rx="4"
            fill="var(--primary)"
            style={{ opacity: 0 }}
          />
        ))}
        <g fontSize="7" fontWeight="800" fill="var(--ink)">
          {INTRO_ITEMS.map((item, index) => (
            <text key={item.id} x="68" y={163.5 + index * 21}>
              {`${item.quantity} ${RECEIPT_NAMES[item.id]}`}
            </text>
          ))}
        </g>
        <g fontSize="7" fill="var(--ink-soft)" opacity=".7">
          {RECEIPT_LEADERS.map((leader, index) => (
            <text key={index} x={leader.x} y={163.5 + index * 21}>
              {leader.dots}
            </text>
          ))}
        </g>
        <g fontSize="7" textAnchor="end" fill="var(--ink)" className="font-mono tabular-nums">
          {INTRO_ITEMS.map((item, index) => (
            <text key={item.id} x="156" y={163.5 + index * 21}>
              {centsText(item.totalCents)}
            </text>
          ))}
        </g>
        <line x1="68" y1="258" x2="156" y2="258" stroke="var(--ink-soft)" strokeOpacity=".5" strokeDasharray="1.6 2.4" />
        <text x="68" y="269" fontSize="6" fontWeight="700" fill="var(--ink-soft)">
          SERVIÇO 10%
        </text>
        <text x="156" y="269" textAnchor="end" fontSize="6" fill="var(--ink-soft)" className="font-mono tabular-nums">
          {centsText(INTRO_SERVICE_CENTS)}
        </text>
        <text x="68" y="282" fontSize="8" fontWeight="900" fill="var(--ink)">
          TOTAL
        </text>
        <text
          x="156"
          y="282"
          textAnchor="end"
          fontSize="8"
          fontWeight="700"
          fill="var(--ink)"
          className="font-mono tabular-nums"
        >
          {centsText(INTRO_TOTAL_CENTS)}
        </text>
        <g fill="var(--ink)" opacity=".7">
          {BARCODE.map(([x, width]) => (
            <rect key={x} x={x} y="287" width={width} height="7" />
          ))}
        </g>
        <g data-part="beam" style={{ opacity: 0 }}>
          <ellipse data-part="beam-glow" cx="112" cy="150" rx="52" ry="6" fill="var(--primary)" opacity=".22" />
          <rect data-part="beam-line" x="60" y="148" width="104" height="4" rx="2" fill="var(--primary)" />
        </g>
      </g>
    </g>
  );
}

/** `scanned` picks the markup's first paint: the finished list, or the empty one the scan fills in. */
function ItemsCard({ totalText, scanned }: { totalText: MotionValue<string>; scanned: boolean }) {
  const shown = scanned ? "" : undefined;
  return (
    <g>
      <rect x="188" y="91" width="160" height="220" rx="20" fill="var(--obj-shadow)" />
      <rect x="188" y="84" width="160" height="220" rx="20" fill="var(--obj-card)" />
      <rect x="188.5" y="84.5" width="159" height="219" rx="19.5" fill="none" stroke="var(--obj-border)" />
      <text x="202" y="106" fontSize="7.5" fontWeight="900" letterSpacing="1.4" fill="var(--obj-ink-soft)">
        ITENS DA CONTA
      </text>
      <g data-part="check" style={{ opacity: scanned ? 1 : 0 }}>
        <g data-part="check-mark" className="intro-fx">
          <circle cx="333" cy="103" r="8.5" fill="var(--success)" />
          <path
            d="M329.2,103 l2.7,2.8 l4.8,-5.4"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </g>
      <g stroke="var(--obj-border)" strokeDasharray="3 3" fill="none">
        {LIST_ROW_Y.map((rowY) => (
          <rect
            key={rowY}
            data-part="ghost"
            data-off={shown}
            className="intro-scan-ghost"
            x="200"
            y={rowY - 8.5}
            width="136"
            height="18"
            rx="7"
          />
        ))}
      </g>
      <g fontSize="8.5" fontWeight="800" fill="var(--obj-ink)">
        {INTRO_ITEMS.map((item, index) => (
          <g key={item.id} data-part="row" data-on={shown} className="intro-scan-row">
            <FoodIcon item={item.id} transform={`translate(208 ${LIST_ICON_Y[index]}) scale(.62)`} />
            <text x="220" y={LIST_ROW_Y[index] + 3.5}>
              {item.name}
            </text>
            <text x="336" y={LIST_ROW_Y[index] + 3.5} textAnchor="end" fontWeight="600" className="font-mono tabular-nums">
              {centsText(item.totalCents)}
            </text>
          </g>
        ))}
        <g data-part="row" data-on={shown} className="intro-scan-row" fontSize="7.5" fontWeight="700" fill="var(--obj-ink-soft)">
          <text x="202" y="250">
            Serviço 10%
          </text>
          <text x="336" y="250" textAnchor="end" fontWeight="500" className="font-mono tabular-nums">
            {centsText(INTRO_SERVICE_CENTS)}
          </text>
        </g>
      </g>
      <line x1="200" y1="262" x2="336" y2="262" stroke="var(--obj-border)" strokeDasharray="2 2.6" />
      <text x="202" y="287" fontSize="8" fontWeight="900" letterSpacing="1.2" fill="var(--obj-ink-soft)">
        TOTAL
      </text>
      <g data-part="total" className="intro-fx">
        <motion.text
          x="336"
          y="289"
          textAnchor="end"
          fontSize="16"
          fontWeight="700"
          fill="var(--obj-ink)"
          className="font-mono tabular-nums"
        >
          {totalText}
        </motion.text>
      </g>
    </g>
  );
}

function Phone({ pose }: { pose: PhonePose }) {
  return (
    <g data-part="phone" className="cursor-pointer" transform={poseTransform(pose)}>
      <g data-part="phone-bump" className="intro-fx">
        <path
          fillRule="evenodd"
          fill="var(--phone-body)"
          d="M-20,-84 H20 A20,20 0 0 1 40,-64 V68 A20,20 0 0 1 20,88 H-20 A20,20 0 0 1 -40,68 V-64 A20,20 0 0 1 -20,-84 Z M-23,-72 H23 A11,11 0 0 1 34,-61 V35 A11,11 0 0 1 23,46 H-23 A11,11 0 0 1 -34,35 V-61 A11,11 0 0 1 -23,-72 Z"
        />
        <rect x="-34" y="-72" width="68" height="118" rx="11" fill="var(--primary)" opacity=".08" />
        <rect x="-9" y="-80" width="18" height="3" rx="1.5" fill="#fff" opacity=".22" />
        <g stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M-27,-54 v-7 a4,4 0 0 1 4,-4 h7" />
          <path d="M27,-54 v-7 a4,4 0 0 0 -4,-4 h-7" />
          <path d="M-27,28 v7 a4,4 0 0 0 4,4 h7" />
          <path d="M27,28 v7 a4,4 0 0 1 -4,4 h-7" />
        </g>
        <g>
          <circle cx="0" cy="67" r="20" fill="transparent" />
          <circle cx="0" cy="67" r="12.5" fill="none" stroke="#fff" strokeWidth="2.4" />
          <circle data-part="shutter-dot" className="intro-fx" cx="0" cy="67" r="8.5" fill="var(--primary)" />
        </g>
      </g>
    </g>
  );
}

function FlyingChips() {
  return (
    <g pointerEvents="none">
      {INTRO_ITEMS.map((item) => (
        <g key={item.id} data-part="chip" style={{ visibility: "hidden" }}>
          <g data-part="chip-body">
            <rect x="-52" y="-8" width="104" height="22" rx="11" fill="var(--obj-shadow)" />
            <rect x="-52" y="-11" width="104" height="22" rx="11" fill="var(--obj-card)" stroke="var(--primary)" strokeWidth="1.6" />
            <FoodIcon item={item.id} transform="translate(-40 0) scale(.55)" />
            <text x="-30" y="3.2" fontSize="8.5" fontWeight="800" fill="var(--obj-ink)">
              {item.name.replace(" (6 un)", "")}
            </text>
          </g>
        </g>
      ))}
    </g>
  );
}
