"use client";

import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "framer-motion";
import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { haptics } from "@/hooks/use-haptics";
import { REDUCED_MOTION_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { formatBRL } from "@/lib/currency";
import { INTRO_DEFAULT_SHARERS, INTRO_PEOPLE, splitIntroBill, type IntroPerson } from "@/lib/intro-demo-bill";
import { SceneAvatar } from "./scene-avatar";
import { scenePart, sceneParts } from "./scene-dom";
import { bump, createSceneRunner, EASE_OUT, EASE_SPRING, popIn, press, wiggle, type SceneClock } from "./scene-motion";
import type { IntroSceneProps, IntroSceneStage } from "./scene-stage";

const QR_PATTERN = [
  "111111101010101111111",
  "100000100101101000001",
  "101110101010001011101",
  "101110100111001011101",
  "101110101001101011101",
  "100000100100101000001",
  "111111101010101111111",
  "000000001101000000000",
  "101011110010111011010",
  "010100011011001100101",
  "101101100100101010110",
  "010010010110010101001",
  "110101101001101101101",
  "000000001010100010010",
  "111111100101011011101",
  "100000101010101100100",
  "101110100011010010111",
  "101110101100101001010",
  "101110101011011101001",
  "100000100101000110110",
  "111111101001111010101",
];
const QR_CELL = 84 / 21;
const QR_CELLS = QR_PATTERN.flatMap((row, r) =>
  [...row].flatMap((bit, c) => (bit === "1" ? [{ x: 48 + c * QR_CELL, y: 262 + r * QR_CELL }] : [])),
);

const CARD_Y = [84, 160];
const NOTIF_Y = [246, 304];
const FIRST_CHARGE_MS = [800, 2900];
const NOTIF_MS = 950;
const PAID_AFTER_NOTIF_MS = 300;
const FINALE_MS = 760;
const CONFETTI_COUNT = 42;
const CONFETTI_MS = 1700;
const CONFETTI_GRAVITY = 0.00042;
const CONFETTI_ORIGIN = { x: 180, y: 460 };
const CONFETTI_COLORS = [
  "var(--primary)",
  "var(--success)",
  "var(--pix)",
  "var(--avatar-tone-2)",
  "var(--warning)",
  "var(--accent)",
  "var(--secondary)",
];

interface Debt {
  person: IntroPerson;
  cents: number;
}

const DEFAULT_SPLIT = splitIntroBill(INTRO_DEFAULT_SHARERS);
const DEBTS: readonly Debt[] = INTRO_PEOPLE.filter((person) => person.id !== "voce").map((person) => ({
  person,
  cents: DEFAULT_SPLIT.totalCents[person.id],
}));
const OWED_CENTS = DEBTS.reduce((sum, debt) => sum + debt.cents, 0);

type DebtState = "idle" | "sent" | "paid";

interface Arrival {
  debt: number;
  drop: boolean;
}

interface ChargeState {
  debts: readonly DebtState[];
  arrivals: readonly Arrival[];
  qrLabel: string;
  finished: boolean;
}

const START_STATE: ChargeState = {
  debts: DEBTS.map(() => "idle"),
  arrivals: [],
  qrLabel: `${formatBRL(OWED_CENTS)} no total`,
  finished: false,
};

const FINAL_STATE: ChargeState = {
  debts: DEBTS.map(() => "paid"),
  arrivals: DEBTS.map((_, debt) => ({ debt, drop: false })),
  qrLabel: "Tudo recebido",
  finished: true,
};

function stateForStage(from: IntroSceneStage, to: IntroSceneStage, still: boolean): ChargeState {
  if (still || to === "rest" || (to === "play" && from === "rest")) return FINAL_STATE;
  return START_STATE;
}

interface ChargeRun {
  svg: SVGSVGElement;
  clock: SceneClock;
  remaining: MotionValue<number>;
  charged: Set<number>;
  paid: Set<number>;
  update: (change: (state: ChargeState) => ChargeState) => void;
  finish: () => void;
}

function withDebt(state: ChargeState, debt: number, next: DebtState): ChargeState {
  return { ...state, debts: state.debts.map((current, index) => (index === debt ? next : current)) };
}

function riseIn(node: Element): AnimationPlaybackControls {
  return animate(
    node,
    { y: [18, 0], scale: [0.8, 1], opacity: [0, 1] },
    { duration: 0.6, ease: EASE_SPRING },
  );
}

function hideConfetti(svg: SVGSVGElement) {
  sceneParts<SVGGElement>(svg, "confetti").forEach((bit) => (bit.style.visibility = "hidden"));
}

function burst(run: ChargeRun) {
  const bits = sceneParts<SVGGElement>(run.svg, "confetti").map((node) => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.3;
    const speed = 0.16 + Math.random() * 0.2;
    node.style.visibility = "visible";
    return {
      node,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: (Math.random() - 0.5) * 1.4,
      rotation: Math.random() * 180,
    };
  });
  void run.clock
    .play(
      animate(0, CONFETTI_MS, {
        duration: CONFETTI_MS / 1000,
        ease: "linear",
        onUpdate: (t) => {
          const opacity = t > CONFETTI_MS * 0.65 ? (CONFETTI_MS - t) / (CONFETTI_MS * 0.35) : 1;
          for (const bit of bits) {
            const x = CONFETTI_ORIGIN.x + bit.vx * t;
            const y = CONFETTI_ORIGIN.y + bit.vy * t + 0.5 * CONFETTI_GRAVITY * t * t;
            bit.node.setAttribute(
              "transform",
              `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(bit.rotation + bit.spin * t).toFixed(1)})`,
            );
            bit.node.style.opacity = opacity.toFixed(3);
          }
        },
      }),
    )
    .then(() => hideConfetti(run.svg));
}

function finale(run: ChargeRun) {
  run.update((state) => ({ ...state, qrLabel: "Tudo recebido", finished: true }));
  run.clock.flourish(riseIn(scenePart(run.svg, "banner-body")));
  burst(run);
  run.finish();
}

async function markPaid(run: ChargeRun, debt: number) {
  run.paid.add(debt);
  run.update((state) => withDebt(state, debt, "paid"));
  run.clock.flourish(popIn(scenePart(run.svg, `paid-${debt}`)));
  run.clock.flourish(wiggle(scenePart(run.svg, `card-${debt}`)));
  run.clock.flourish(bump(scenePart(run.svg, "meter")));
  const left = DEBTS.reduce((sum, item, index) => (run.paid.has(index) ? sum : sum + item.cents), 0);
  void run.clock.play(animate(run.remaining, left, { duration: 0.7, ease: EASE_OUT }));
  if (run.paid.size < DEBTS.length) {
    run.update((state) => ({ ...state, qrLabel: `${formatBRL(left)} faltando` }));
    return;
  }
  await run.clock.wait(FINALE_MS);
  finale(run);
}

async function charge(run: ChargeRun, debt: number) {
  if (run.charged.has(debt)) return;
  run.charged.add(debt);
  const { person, cents } = DEBTS[debt];
  run.update((state) => ({ ...withDebt(state, debt, "sent"), qrLabel: `${formatBRL(cents)} · ${person.name}` }));
  run.clock.flourish(press(scenePart(run.svg, `pill-${debt}`)));
  run.clock.flourish(bump(scenePart(run.svg, "qr")));
  await run.clock.wait(NOTIF_MS);
  run.update((state) => ({ ...state, arrivals: [...state.arrivals, { debt, drop: true }] }));
  await run.clock.wait(PAID_AFTER_NOTIF_MS);
  await markPaid(run, debt);
}

function autoplay(run: ChargeRun) {
  FIRST_CHARGE_MS.forEach((ms, debt) => {
    void run.clock.wait(ms).then(() => charge(run, debt));
  });
}

function startChargeRun(setup: Omit<ChargeRun, "charged" | "paid">): ChargeRun {
  hideConfetti(setup.svg);
  setup.remaining.set(OWED_CENTS);
  const run: ChargeRun = { ...setup, charged: new Set(), paid: new Set() };
  autoplay(run);
  return run;
}

export function ChargeScene({ stage, onSettle, onBusy }: IntroSceneProps) {
  const still = useMediaQuery(REDUCED_MOTION_QUERY);
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const runRef = useRef<ChargeRun | null>(null);
  const previousStage = useRef<IntroSceneStage | null>(null);
  const [runner] = useState(createSceneRunner);
  const [state, setState] = useState<ChargeState>(() => stateForStage(stage, stage, still));
  const [tracked, setTracked] = useState({ stage, still });
  const remaining = useMotionValue(state.finished ? 0 : OWED_CENTS);
  const settle = useEffectEvent(onSettle);

  if (tracked.stage !== stage || tracked.still !== still) {
    setTracked({ stage, still });
    setState(stateForStage(tracked.stage, stage, still));
  }

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const from = previousStage.current;
    previousStage.current = stage;
    if (svg === null) return;
    const stopRun = () => {
      runner.stop();
      runRef.current = null;
      hideConfetti(svg);
    };
    const final = still || stage === "rest" || (stage === "play" && from === "rest");
    remaining.set(final ? 0 : OWED_CENTS);
    if (stage !== "play") return stopRun;
    if (final) {
      settle();
      return stopRun;
    }
    runRef.current = startChargeRun({ svg, clock: runner.start(), remaining, update: setState, finish: settle });
    return stopRun;
  }, [stage, still, runner, remaining]);

  const handleCharge = (debt: number) => {
    const run = runRef.current;
    if (still || run === null || state.debts[debt] !== "idle") return;
    haptics.tap();
    onBusy();
    void charge(run, debt);
  };

  const handleReplay = () => {
    haptics.tap();
    const svg = svgRef.current;
    if (still || svg === null) return;
    onBusy();
    setState(START_STATE);
    runRef.current = startChargeRun({ svg, clock: runner.start(), remaining, update: setState, finish: onSettle });
  };

  return (
    <svg ref={svgRef} viewBox="0 0 360 492" aria-hidden="true" className="block size-full overflow-visible select-none">
      <defs>
        <clipPath id={clipId}>
          <rect x="-6" y="-6" width="372" height="502" rx="30" />
        </clipPath>
      </defs>
      <rect x="-6" y="-6" width="372" height="502" rx="30" fill="var(--tint-3)" />
      <g clipPath={`url(#${clipId})`}>
        <circle cx="40" cy="80" r="84" fill="var(--accent)" opacity=".22" />
        <circle cx="330" cy="300" r="70" fill="var(--pix)" opacity=".10" />
        <circle cx="318" cy="36" r="5" fill="var(--pix)" opacity=".4" />
      </g>

      <Meter remaining={remaining} />

      {DEBTS.map((debt, index) => (
        <DebtCard key={debt.person.id} debt={debt} index={index} state={state.debts[index]} onCharge={handleCharge} />
      ))}

      <QrCard label={state.qrLabel} />
      <Coins />

      <g>
        {state.arrivals.map((arrival, slot) => (
          <Notification key={arrival.debt} debt={DEBTS[arrival.debt]} slot={slot} drop={arrival.drop} />
        ))}
      </g>

      <g
        opacity={state.finished ? 1 : 0}
        pointerEvents={state.finished ? undefined : "none"}
        className="cursor-pointer"
        onClick={handleReplay}
      >
        <g data-part="banner-body" className="intro-fx">
          <rect x="62" y="438" width="236" height="44" rx="22" fill="var(--success)" />
          <circle cx="87" cy="460" r="11" fill="#fff" fillOpacity=".25" />
          <path
            d="M82.2,460 l3.3,3.4 l5.6,-6.4"
            fill="none"
            stroke="#fff"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text x="106" y="465" fontSize="13" fontWeight="900" fill="#fff">
            Tudo certo, no centavo.
          </text>
        </g>
      </g>

      <g pointerEvents="none">
        {Array.from({ length: CONFETTI_COUNT }, (_, index) => (
          <g key={index} data-part="confetti" style={{ visibility: "hidden" }}>
            {index % 3 === 0 ? (
              <circle r={2.4 + ((index * 7) % 12) / 10} fill={CONFETTI_COLORS[index % CONFETTI_COLORS.length]} />
            ) : (
              <rect x="-3.5" y="-1.8" width="7" height="3.6" rx="1" fill={CONFETTI_COLORS[index % CONFETTI_COLORS.length]} />
            )}
          </g>
        ))}
      </g>
    </svg>
  );
}

function Meter({ remaining }: { remaining: MotionValue<number> }) {
  const text = useTransform(remaining, (cents) => formatBRL(Math.round(cents)));
  const done = useTransform(remaining, (cents) => Math.round(cents) === 0);
  const textFill = useTransform(done, (isDone) => (isDone ? "var(--success-text)" : "var(--foreground)"));
  const barFill = useTransform(done, (isDone) => (isDone ? "var(--success)" : "var(--pix)"));
  const barWidth = useTransform(remaining, (cents) => (200 * (OWED_CENTS - Math.round(cents))) / OWED_CENTS);
  return (
    <g>
      <text x="180" y="18" textAnchor="middle" fontSize="8.5" fontWeight="900" letterSpacing="2" fill="var(--muted-foreground)">
        FALTA RECEBER
      </text>
      <g data-part="meter" className="intro-fx">
        <motion.text
          x="180"
          y="50"
          textAnchor="middle"
          fontSize="27"
          fontWeight="700"
          className="font-mono tabular-nums"
          style={{ fill: textFill }}
        >
          {text}
        </motion.text>
      </g>
      <rect x="80" y="60" width="200" height="7" rx="3.5" fill="var(--muted)" />
      <rect x="80" y="60" width="200" height="7" rx="3.5" fill="none" stroke="var(--border)" />
      <motion.rect x="80" y="60" height="7" rx="3.5" width={barWidth} style={{ fill: barFill }} />
    </g>
  );
}

interface DebtCardProps {
  debt: Debt;
  index: number;
  state: DebtState;
  onCharge: (debt: number) => void;
}

function debtNote(state: DebtState): string {
  if (state === "paid") return "Pagou via Pix";
  if (state === "sent") return "Pix enviado…";
  return "Te deve";
}

function DebtCard({ debt, index, state, onCharge }: DebtCardProps) {
  const paid = state === "paid";
  const idle = state === "idle";
  return (
    <g transform={`translate(12 ${CARD_Y[index]})`}>
      <g data-part={`card-${index}`} className="intro-fx">
        <rect y="4" width="336" height="66" rx="20" fill="var(--obj-shadow)" />
        <rect width="336" height="66" rx="20" fill="var(--obj-card)" />
        <rect
          x=".5"
          y=".5"
          width="335"
          height="65"
          rx="19.5"
          fill={paid ? "color-mix(in oklab, var(--success) 8%, var(--obj-card))" : "var(--obj-card)"}
          stroke={paid ? "color-mix(in oklab, var(--success) 55%, transparent)" : "var(--obj-border)"}
        />
        <SceneAvatar person={debt.person} cx={34} cy={33} r={19} />
        <text x="62" y="30" fontSize="13.5" fontWeight="800" fill="var(--obj-ink)">
          {debt.person.name}
        </text>
        <text x="62" y="46" fontSize="10" fontWeight="700" fill={paid ? "var(--obj-success-ink)" : "var(--obj-ink-soft)"}>
          {debtNote(state)}
        </text>
        <text
          x="236"
          y="38.5"
          textAnchor="end"
          fontSize="15"
          fontWeight="700"
          fill={paid ? "var(--obj-success-ink)" : "var(--obj-ink)"}
          className="font-mono tabular-nums"
        >
          {formatBRL(debt.cents)}
        </text>
        <g display={paid ? "none" : "inline"} className={idle ? "cursor-pointer" : undefined} onClick={() => onCharge(index)}>
          <rect x="240" y="0" width="96" height="66" fill="transparent" />
          <g data-part={`pill-${index}`} className="intro-fx">
            <rect x="250" y="16" width="76" height="34" rx="17" fill={idle ? "var(--cta)" : "var(--obj-muted)"} />
            <text
              x="288"
              y="37.5"
              textAnchor="middle"
              fontSize="11.5"
              fontWeight="800"
              fill={idle ? "var(--cta-foreground)" : "var(--obj-ink-soft)"}
            >
              {idle ? "Cobrar" : "Cobrado"}
            </text>
          </g>
        </g>
        <g display={paid ? "inline" : "none"}>
          <g data-part={`paid-${index}`} className="intro-fx">
            <circle cx="300" cy="33" r="15" fill="var(--success)" />
            <path
              d="M293.6,33 l4.4,4.6 l8,-9.2"
              fill="none"
              stroke="#fff"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>
      </g>
    </g>
  );
}

function QrCard({ label }: { label: string }) {
  return (
    <g>
      <rect x="14" y="249" width="152" height="172" rx="20" fill="var(--obj-shadow)" />
      <rect x="14" y="244" width="152" height="172" rx="20" fill="var(--paper)" />
      <rect x="14.5" y="244.5" width="151" height="171" rx="19.5" fill="none" stroke="var(--qr-card-edge)" />
      <g data-part="qr" className="intro-fx">
        <rect x="44" y="258" width="92" height="92" rx="10" fill="var(--qr-plate)" />
        <g fill="var(--pix-deep)">
          {QR_CELLS.map((cell) => (
            <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width={QR_CELL} height={QR_CELL} rx=".6" />
          ))}
        </g>
        <rect x="79" y="293" width="22" height="22" rx="6" fill="var(--paper)" />
        <rect x="84" y="298" width="12" height="12" rx="2.5" transform="rotate(45 90 304)" fill="var(--pix)" />
      </g>
      <text x="90" y="372" textAnchor="middle" fontSize="10.5" fontWeight="900" fill="var(--ink)">
        Pix copia e cola
      </text>
      <text x="90" y="392" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--ink-soft)" className="tabular-nums">
        {label}
      </text>
    </g>
  );
}

function Coins() {
  return (
    <g>
      <ellipse cx="292" cy="412" rx="36" ry="4" fill="var(--obj-shadow)" />
      <ellipse cx="276" cy="402" rx="19" ry="7" fill="var(--coin-ink)" />
      <ellipse cx="276" cy="398" rx="19" ry="7" fill="var(--food-gold)" />
      <ellipse cx="276" cy="394" rx="19" ry="7" fill="var(--coin-ink)" />
      <ellipse cx="276" cy="390" rx="19" ry="7" fill="var(--food-gold)" />
      <ellipse cx="276" cy="390" rx="12" ry="4" fill="none" stroke="var(--coin-ink)" strokeOpacity=".45" strokeWidth="1.2" />
      <ellipse cx="312" cy="404" rx="17" ry="6" fill="var(--coin-ink)" />
      <ellipse cx="312" cy="400" rx="17" ry="6" fill="var(--food-gold)" />
      <ellipse cx="312" cy="400" rx="10.5" ry="3.4" fill="none" stroke="var(--coin-ink)" strokeOpacity=".45" strokeWidth="1.2" />
      <g transform="rotate(-18 322 370)">
        <rect x="310" y="356" width="24" height="26" rx="12" fill="var(--food-gold)" stroke="var(--coin-ink)" strokeWidth="1.6" />
        <text x="322" y="373" textAnchor="middle" fontSize="10" fontWeight="900" fill="var(--coin-ink)">
          R$
        </text>
      </g>
    </g>
  );
}

function Notification({ debt, slot, drop }: { debt: Debt; slot: number; drop: boolean }) {
  const bodyRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!drop || body === null) return;
    const controls = animate(
      body,
      { y: [-70, 0], opacity: [0, 1, 1] },
      { duration: 0.55, ease: EASE_SPRING, opacity: { times: [0, 0.55, 1] } },
    );
    return () => controls.complete();
  }, [drop]);

  return (
    <g transform={`translate(176 ${NOTIF_Y[slot]})`}>
      <g ref={bodyRef} className="intro-fx">
        <rect y="4" width="172" height="48" rx="16" fill="var(--obj-shadow)" />
        <rect width="172" height="48" rx="16" fill="var(--obj-card)" />
        <rect x=".5" y=".5" width="171" height="47" rx="15.5" fill="none" stroke="var(--obj-border)" />
        <circle cx="23" cy="24" r="13" fill="var(--pix)" />
        <rect
          x="17.5"
          y="18.5"
          width="11"
          height="11"
          rx="2.6"
          transform="rotate(45 23 24)"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
        />
        <text x="43" y="21" fontSize="10" fontWeight="800" fill="var(--obj-ink)">
          {`${debt.person.name} te pagou `}
          <tspan fontWeight="700" className="font-mono">
            {formatBRL(debt.cents)}
          </tspan>
        </text>
        <text x="43" y="36" fontSize="9.2" fontWeight="700" fill="var(--obj-ink-soft)">
          via Pix · agora
        </text>
      </g>
    </g>
  );
}
