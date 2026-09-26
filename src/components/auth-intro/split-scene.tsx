"use client";

import {
  animate,
  cubicBezier,
  motion,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
} from "framer-motion";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { haptics } from "@/hooks/use-haptics";
import { REDUCED_MOTION_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { formatBRL } from "@/lib/currency";
import {
  INTRO_DEFAULT_SHARERS,
  INTRO_ITEMS,
  INTRO_PEOPLE,
  splitIntroBill,
  splitIntroItem,
  type IntroItem,
  type IntroItemId,
  type IntroPerson,
  type IntroPersonId,
  type IntroSharers,
  type IntroSplit,
} from "@/lib/intro-demo-bill";
import { centsText } from "@/lib/item-division";
import { FoodIcon } from "./food-icon";
import { avatarRingColor, SceneAvatar } from "./scene-avatar";
import { scenePart, sceneParts } from "./scene-dom";
import { bump, createSceneRunner, EASE_OUT, popIn, press, wiggle, type SceneClock } from "./scene-motion";
import type { IntroSceneProps, IntroSceneStage } from "./scene-stage";

const CHIP_Y0 = 42;
const CHIP_STEP = 60;
const CHIP_H = 52;
const SLOT_X = [212, 262, 312];
const TRAY_Y = 346;
const TRAY_X = [12, 127, 242];
const HOP_LIFT = 54;
const HOP_FIRST_MS = 420;
const HOP_GAP_MS = 290;
const TOTAL_COUNT_MS = 380;
const RING_GAP = 0.36;
const easeInOut = cubicBezier(0.65, 0, 0.35, 1);

const NO_SHARERS: IntroSharers = { chopp: [], batata: [], caipirinha: [], pastel: [], guarana: [] };

const CYCLE: readonly (readonly IntroPersonId[])[] = [
  ["voce"],
  ["bia"],
  ["leo"],
  ["voce", "bia"],
  ["voce", "leo"],
  ["bia", "leo"],
  ["voce", "bia", "leo"],
];

interface HopStep {
  item: IntroItem;
  person: IntroPerson;
  personIndex: number;
  itemIndex: number;
}

const HOP_STEPS: readonly HopStep[] = INTRO_ITEMS.flatMap((item, itemIndex) =>
  INTRO_PEOPLE.flatMap((person, personIndex) =>
    INTRO_DEFAULT_SHARERS[item.id].includes(person.id) ? [{ item, person, personIndex, itemIndex }] : [],
  ),
);

interface SplitState {
  sharers: IntroSharers;
  autoplaying: boolean;
  countTotals: boolean;
}

function replayState(still: boolean): SplitState {
  return still
    ? { sharers: INTRO_DEFAULT_SHARERS, autoplaying: false, countTotals: false }
    : { sharers: NO_SHARERS, autoplaying: true, countTotals: false };
}

function stateForStage(previous: SplitState, from: IntroSceneStage, to: IntroSceneStage, still: boolean): SplitState {
  if (to === "rest" || (to === "play" && from === "rest")) {
    if (previous.autoplaying) return { sharers: INTRO_DEFAULT_SHARERS, autoplaying: false, countTotals: false };
    return { ...previous, countTotals: false };
  }
  return replayState(still);
}

function withSharers(sharers: IntroSharers, itemId: IntroItemId, next: readonly IntroPersonId[]): IntroSharers {
  const updated: Record<IntroItemId, readonly IntroPersonId[]> = { ...sharers };
  updated[itemId] = INTRO_PEOPLE.filter((person) => next.includes(person.id)).map((person) => person.id);
  return updated;
}

function sameSharers(a: IntroSharers, b: IntroSharers): boolean {
  return INTRO_ITEMS.every(
    (item) => a[item.id].length === b[item.id].length && a[item.id].every((id) => b[item.id].includes(id)),
  );
}

function toggled(sharers: IntroSharers, itemId: IntroItemId, personId: IntroPersonId): IntroSharers {
  const current = sharers[itemId];
  const next = current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId];
  return withSharers(sharers, itemId, next);
}

function cycled(sharers: IntroSharers, itemId: IntroItemId): IntroSharers {
  const current = sharers[itemId];
  const at = CYCLE.findIndex(
    (option) => option.length === current.length && option.every((id) => current.includes(id)),
  );
  return withSharers(sharers, itemId, CYCLE[(at + 1) % CYCLE.length]);
}

function describeItem(item: IntroItem, who: readonly IntroPersonId[], autoplaying: boolean): string {
  if (who.length === 0) return autoplaying ? formatBRL(item.totalCents) : "Ninguém ainda";
  if (who.length === 1) {
    const person = INTRO_PEOPLE.find((candidate) => candidate.id === who[0]);
    const name = who[0] === "voce" || person === undefined ? "você" : person.name;
    return `${formatBRL(item.totalCents)} · só ${name}`;
  }
  const parts = splitIntroItem(item, who.length);
  if (parts.every((part) => part === parts[0])) return `${formatBRL(item.totalCents)} · ${centsText(parts[0])} cada`;
  return parts.map(centsText).join(" + ");
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const start = [cx + r * Math.cos(from), cy + r * Math.sin(from)];
  const end = [cx + r * Math.cos(to), cy + r * Math.sin(to)];
  const large = to - from > Math.PI ? 1 : 0;
  return `M${start[0].toFixed(2)},${start[1].toFixed(2)} A${r},${r} 0 ${large} 1 ${end[0].toFixed(2)},${end[1].toFixed(2)}`;
}

function hopTransform(t: number, step: HopStep): string {
  const from = { x: TRAY_X[step.personIndex] + 53, y: TRAY_Y + 27 };
  const to = { x: 12 + SLOT_X[step.personIndex], y: CHIP_Y0 + step.itemIndex * CHIP_STEP + 26 };
  const e = easeInOut(t);
  const x = from.x + (to.x - from.x) * e;
  const y = from.y + (to.y - from.y) * e - HOP_LIFT * 4 * e * (1 - e);
  const scale = (1 + (13 / 17 - 1) * e) * (1 + 0.12 * Math.sin(Math.PI * t));
  return `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(3)})`;
}

function hideHops(svg: SVGSVGElement) {
  sceneParts<SVGGElement>(svg, "hop").forEach((hop) => (hop.style.visibility = "hidden"));
}

async function playHop(svg: SVGSVGElement, clock: SceneClock, step: HopStep, index: number) {
  const hop = sceneParts<SVGGElement>(svg, "hop")[index];
  clock.flourish(press(scenePart(svg, `tray-avatar-${step.person.id}`)));
  hop.setAttribute("transform", hopTransform(0, step));
  hop.style.visibility = "visible";
  await clock.play(
    animate(0, 1, {
      duration: 0.54,
      ease: "linear",
      onUpdate: (t) => hop.setAttribute("transform", hopTransform(t, step)),
    }),
  );
  hop.style.visibility = "hidden";
}

async function autoplay(svg: SVGSVGElement, clock: SceneClock, land: (step: HopStep, last: boolean) => void) {
  await Promise.all(
    HOP_STEPS.map(async (step, index) => {
      await clock.wait(HOP_FIRST_MS + index * HOP_GAP_MS);
      await playHop(svg, clock, step, index);
      const last = index === HOP_STEPS.length - 1;
      land(step, last);
      clock.flourish(popIn(scenePart(svg, `slot-${step.item.id}-${step.person.id}`)));
      if (last) clock.flourish(popIn(scenePart(svg, "foot")));
    }),
  );
}

function onActivateKey(event: KeyboardEvent, activate: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  activate();
}

export function SplitScene({ stage, onSettle, onBusy }: IntroSceneProps) {
  const still = useMediaQuery(REDUCED_MOTION_QUERY);
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const previousStage = useRef<IntroSceneStage | null>(null);
  const [runner] = useState(createSceneRunner);
  const [state, setState] = useState<SplitState>(() =>
    stage === "rest" ? replayState(true) : replayState(still),
  );
  const [tracked, setTracked] = useState({ stage, still });
  const settle = useEffectEvent(onSettle);

  if (tracked.stage !== stage || tracked.still !== still) {
    setTracked({ stage, still });
    setState((previous) => stateForStage(previous, tracked.stage, stage, still));
  }

  useEffect(() => {
    const svg = svgRef.current;
    const from = previousStage.current;
    previousStage.current = stage;
    if (svg === null) return;
    const stopRun = () => {
      runner.stop();
      hideHops(svg);
    };
    if (stage !== "play") return stopRun;
    if (still || from === "rest") {
      settle();
      return stopRun;
    }
    const land = (step: HopStep, last: boolean) =>
      setState((previous) => ({
        sharers: withSharers(previous.sharers, step.item.id, [...previous.sharers[step.item.id], step.person.id]),
        autoplaying: !last,
        countTotals: true,
      }));
    void autoplay(svg, runner.start(), land).then(settle);
    return stopRun;
  }, [stage, still, runner]);

  const react = (next: (sharers: IntroSharers) => IntroSharers, flourish: (svg: SVGSVGElement) => AnimationPlaybackControls[]) => {
    haptics.tap();
    setState((previous) => ({
      sharers: next(previous.autoplaying ? INTRO_DEFAULT_SHARERS : previous.sharers),
      autoplaying: false,
      countTotals: !still,
    }));
    const svg = svgRef.current;
    if (still || svg === null) return;
    const clock = runner.start();
    hideHops(svg);
    onBusy();
    flourish(svg).forEach((controls) => clock.flourish(controls));
    void clock.wait(TOTAL_COUNT_MS).then(onSettle);
  };

  const toggle = (item: IntroItem, person: IntroPerson) =>
    react(
      (sharers) => toggled(sharers, item.id, person.id),
      (svg) => [popIn(scenePart(svg, `slot-${item.id}-${person.id}`))],
    );

  const cycle = (item: IntroItem) =>
    react(
      (sharers) => cycled(sharers, item.id),
      (svg) => [wiggle(scenePart(svg, `chip-${item.id}`))],
    );

  const reset = () =>
    react(
      () => INTRO_DEFAULT_SHARERS,
      (svg) => INTRO_ITEMS.map((item) => wiggle(scenePart(svg, `chip-${item.id}`))),
    );

  const split = splitIntroBill(state.sharers);
  const complete = split.unassignedCents === 0;
  const showTotals = complete && !state.autoplaying;
  const resettable = !state.autoplaying && !sameSharers(state.sharers, INTRO_DEFAULT_SHARERS);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 360 492"
      role="group"
      aria-label="Quem dividiu cada item"
      className="block size-full overflow-visible select-none"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="-6" y="-6" width="372" height="502" rx="30" />
        </clipPath>
      </defs>
      <rect x="-6" y="-6" width="372" height="502" rx="30" fill="var(--tint-2)" />
      <g clipPath={`url(#${clipId})`} aria-hidden="true">
        <circle cx="318" cy="64" r="80" fill="var(--income)" opacity=".09" />
        <circle cx="30" cy="330" r="64" fill="var(--income)" opacity=".07" />
        <circle cx="344" cy="170" r="4" fill="var(--income)" opacity=".4" />
      </g>

      <text x="14" y="24" fontSize="10" fontWeight="800" fill="var(--muted-foreground)" aria-hidden="true">
        Toque nas bolinhas pra trocar quem divide
      </text>
      <ResetChip visible={resettable} onReset={reset} />

      {INTRO_ITEMS.map((item, index) => (
        <ItemChip
          key={item.id}
          item={item}
          index={index}
          who={state.sharers[item.id]}
          autoplaying={state.autoplaying}
          onCycle={() => cycle(item)}
          onToggle={(person) => toggle(item, person)}
        />
      ))}

      {INTRO_PEOPLE.map((person, index) => (
        <TrayCard
          key={person.id}
          person={person}
          index={index}
          subtotalCents={split.subtotalCents[person.id]}
          totalCents={split.totalCents[person.id]}
          showTotal={showTotals}
          countUp={state.countTotals && !still}
        />
      ))}

      <g data-part="foot" className="intro-fx">
        <text
          x="180"
          y="478"
          textAnchor="middle"
          fontSize="10.5"
          fontWeight="800"
          fill={complete ? "var(--success-text)" : "var(--primary-text)"}
        >
          {footText(state.autoplaying, split)}
        </text>
      </g>

      <g pointerEvents="none">
        {HOP_STEPS.map((step, index) => (
          <g key={index} data-part="hop" style={{ visibility: "hidden" }}>
            <SceneAvatar person={step.person} cx={0} cy={0} r={17} />
          </g>
        ))}
      </g>
    </svg>
  );
}

function footText(autoplaying: boolean, split: IntroSplit): string {
  if (autoplaying) return "";
  if (split.unassignedCents > 0) return `Ainda falta dividir ${formatBRL(split.unassignedCents)}`;
  const total = INTRO_PEOPLE.reduce((sum, person) => sum + split.totalCents[person.id], 0);
  return `Somou ${formatBRL(total)}, igual à notinha`;
}

function ResetChip({ visible, onReset }: { visible: boolean; onReset: () => void }) {
  return (
    <g
      role="button"
      tabIndex={visible ? 0 : -1}
      aria-label="Voltar à divisão original"
      aria-hidden={!visible}
      data-on={visible ? "" : undefined}
      className="intro-reset cursor-pointer"
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        onReset();
      }}
      onKeyDown={(event) => onActivateKey(event, onReset)}
    >
      <rect x="278" y="-2" width="78" height="44" fill="transparent" />
      <rect className="intro-reset-bg" x="290" y="10" width="58" height="20" rx="10" fill="var(--muted)" />
      <path d="M301,16.5 a4.2,4.2 0 1 0 1.2,3" fill="none" stroke="var(--foreground)" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M299,14.6 l3.4,1.6 l-1.8,3"
        fill="none"
        stroke="var(--foreground)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x="309" y="23.5" fontSize="9.5" fontWeight="800" fill="var(--foreground)">
        Resetar
      </text>
    </g>
  );
}

function ShareRing({ who }: { who: readonly IntroPersonId[] }) {
  const people = INTRO_PEOPLE.filter((person) => who.includes(person.id));
  if (people.length === 0) return null;
  if (people.length === 1) {
    return <circle cx="27" cy="26" r="19.5" fill="none" strokeWidth="3.4" stroke={avatarRingColor(people[0])} />;
  }
  const span = (Math.PI * 2) / people.length;
  return (
    <g fill="none" strokeWidth="3.4" strokeLinecap="round">
      {people.map((person, index) => {
        const start = -Math.PI / 2 + index * span + RING_GAP / 2;
        return <path key={person.id} d={arcPath(27, 26, 19.5, start, start + span - RING_GAP)} stroke={avatarRingColor(person)} />;
      })}
    </g>
  );
}

interface ItemChipProps {
  item: IntroItem;
  index: number;
  who: readonly IntroPersonId[];
  autoplaying: boolean;
  onCycle: () => void;
  onToggle: (person: IntroPerson) => void;
}

function ItemChip({ item, index, who, autoplaying, onCycle, onToggle }: ItemChipProps) {
  const flagged = who.length === 0 && !autoplaying;
  const shortName = item.name.replace(/ \(.*\)/, "");
  return (
    <g transform={`translate(12 ${CHIP_Y0 + index * CHIP_STEP})`}>
      <g data-part={`chip-${item.id}`} className="intro-fx cursor-pointer" onClick={onCycle}>
        <rect y="3.5" width="336" height={CHIP_H} rx="17" fill="var(--obj-shadow)" />
        <rect width="336" height={CHIP_H} rx="17" fill="var(--obj-card)" />
        <rect
          x=".5"
          y=".5"
          width="335"
          height={CHIP_H - 1}
          rx="16.5"
          fill="none"
          stroke={flagged ? "var(--primary)" : "var(--obj-border)"}
        />
        <circle cx="27" cy="26" r="16" fill="var(--obj-muted)" />
        <ShareRing who={who} />
        <FoodIcon item={item.id} transform="translate(27 27) scale(.82)" />
        <text x="54" y="23" fontSize="12.5" fontWeight="800" fill="var(--obj-ink)">
          {item.name}
        </text>
        <text
          x="54"
          y="39"
          fontSize="9.6"
          fontWeight="700"
          fill={flagged ? "var(--obj-primary-ink)" : "var(--obj-ink-soft)"}
        >
          {describeItem(item, who, autoplaying)}
        </text>
        {INTRO_PEOPLE.map((person, slot) => (
          <ShareSlot
            key={person.id}
            item={item}
            person={person}
            cx={SLOT_X[slot]}
            on={who.includes(person.id)}
            label={`${person.name} dividiu ${shortName}`}
            onToggle={() => onToggle(person)}
          />
        ))}
      </g>
    </g>
  );
}

interface ShareSlotProps {
  item: IntroItem;
  person: IntroPerson;
  cx: number;
  on: boolean;
  label: string;
  onToggle: () => void;
}

function ShareSlot({ item, person, cx, on, label, onToggle }: ShareSlotProps) {
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={on}
      aria-label={label}
      className="intro-slot cursor-pointer"
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        onToggle();
      }}
      onKeyDown={(event) => onActivateKey(event, onToggle)}
    >
      <rect x={cx - 25} y="0" width="50" height={CHIP_H} fill="transparent" />
      <g data-part={`slot-${item.id}-${person.id}`} className="intro-fx">
        {on ? (
          <SceneAvatar person={person} cx={cx} cy={26} r={13} />
        ) : (
          <g>
            <circle
              cx={cx}
              cy="26"
              r="13"
              fill="none"
              stroke="var(--obj-ink-soft)"
              strokeOpacity=".45"
              strokeWidth="1.4"
              strokeDasharray="3 3"
            />
            <text
              x={cx}
              y="29.2"
              textAnchor="middle"
              fontSize="8.5"
              fontWeight="800"
              fill="var(--obj-ink-soft)"
              opacity=".75"
            >
              {person.initials}
            </text>
          </g>
        )}
      </g>
      <circle className="intro-slot-ring" cx={cx} cy="26" r="18" fill="none" stroke="var(--ring)" strokeWidth="3" />
    </g>
  );
}

interface TrayCardProps {
  person: IntroPerson;
  index: number;
  subtotalCents: number;
  totalCents: number;
  showTotal: boolean;
  countUp: boolean;
}

function TrayCard({ person, index, subtotalCents, totalCents, showTotal, countUp }: TrayCardProps) {
  return (
    <g transform={`translate(${TRAY_X[index]} ${TRAY_Y})`}>
      <rect y="5" width="106" height="106" rx="20" fill="var(--obj-shadow)" />
      <rect width="106" height="106" rx="20" fill="var(--obj-card)" />
      <rect x=".5" y=".5" width="105" height="105" rx="19.5" fill="none" stroke="var(--obj-border)" />
      <g data-part={`tray-avatar-${person.id}`} className="intro-fx">
        <SceneAvatar person={person} cx={53} cy={27} r={17} />
      </g>
      <text x="53" y="60" textAnchor="middle" fontSize="11.5" fontWeight="800" fill="var(--obj-ink)">
        {person.name}
      </text>
      <TrayTotal cents={subtotalCents} countUp={countUp} />
      <text
        x="53"
        y="96"
        textAnchor="middle"
        fontSize="8.6"
        fontWeight="700"
        fill="var(--obj-ink-soft)"
        opacity={showTotal ? 1 : 0}
      >
        {`c/ 10%: ${formatBRL(totalCents)}`}
      </text>
    </g>
  );
}

function TrayTotal({ cents, countUp }: { cents: number; countUp: boolean }) {
  const shown = useMotionValue(cents);
  const text = useTransform(shown, (value) => formatBRL(Math.round(value)));
  const wrapRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!countUp || wrap === null || shown.get() === cents) {
      shown.set(cents);
      return;
    }
    const pulse = bump(wrap);
    const count = animate(shown, cents, { duration: TOTAL_COUNT_MS / 1000, ease: EASE_OUT });
    return () => {
      pulse.complete();
      count.stop();
    };
  }, [cents, countUp, shown]);

  return (
    <g ref={wrapRef} className="intro-fx">
      <motion.text
        x="53"
        y="80"
        textAnchor="middle"
        fontSize="14.5"
        fontWeight="700"
        fill="var(--obj-ink)"
        className="font-mono tabular-nums"
      >
        {text}
      </motion.text>
    </g>
  );
}
