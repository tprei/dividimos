"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useReducedMotion,
  type Transition,
} from "framer-motion";
import { CheckCheck, Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DebtEdge } from "@/lib/simplify";
import { formatBRL } from "@/lib/currency";

export interface DebtGraphNode {
  id: string;
  name: string;
}

interface DebtGraphProps {
  participants: DebtGraphNode[];
  edges: DebtEdge[];
  rawEdges?: DebtEdge[];
  replayKey?: number;
  selected?: { from: string; to: string } | null;
  onSelectEdge?: (edge: { from: string; to: string } | null) => void;
  highlightEdge?: { from: string; to: string };
  fadingEdges?: { from: string; to: string }[];
  dimOthers?: boolean;
}

type EdgeAnimationMode = "crossfade" | "instant" | "legacy";

const VIEWBOX = 320;
const CENTER = VIEWBOX / 2;
const ORBIT_RADIUS = 108;
const NODE_RADIUS = 22;
const RAW_PHASE_MS = 800;
const CROSSFADE_SECONDS = 1.2;
const PATH_DRAW_SECONDS = 0.8;

function getNodePosition(index: number, total: number): { x: number; y: number } {
  const angle = (2 * Math.PI * index) / total - Math.PI / 2;
  return {
    x: CENTER + ORBIT_RADIUS * Math.cos(angle),
    y: CENTER + ORBIT_RADIUS * Math.sin(angle),
  };
}

function getCurvedPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  const nx = -dy / len;
  const ny = dx / len;

  const curvature = len * 0.25;
  const cpx = (from.x + to.x) / 2 + nx * curvature;
  const cpy = (from.y + to.y) / 2 + ny * curvature;

  const startOffX = (dx / len) * NODE_RADIUS;
  const startOffY = (dy / len) * NODE_RADIUS;
  const endOffX = (dx / len) * NODE_RADIUS;
  const endOffY = (dy / len) * NODE_RADIUS;

  const sx = from.x + startOffX;
  const sy = from.y + startOffY;
  const ex = to.x - endOffX;
  const ey = to.y - endOffY;

  return `M ${sx} ${sy} Q ${cpx} ${cpy} ${ex} ${ey}`;
}

function getLabelPosition(
  from: { x: number; y: number },
  to: { x: number; y: number },
  hasReverse: boolean,
): { x: number; y: number } {
  const t = hasReverse ? 0.3 : 0.5;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = -dy / len;
  const ny = dx / len;
  const curvature = len * 0.25;
  const cpx = (from.x + to.x) / 2 + nx * curvature;
  const cpy = (from.y + to.y) / 2 + ny * curvature;
  const mt = 1 - t;
  return {
    x: mt * mt * from.x + 2 * mt * t * cpx + t * t * to.x,
    y: mt * mt * from.y + 2 * mt * t * cpy + t * t * to.y,
  };
}

function selectable(label: string, onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    className: "cursor-pointer outline-none focus-visible:opacity-60",
    onClick: onActivate,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onActivate();
      }
    },
  };
}

interface GraphEdgeProps {
  edge: DebtEdge;
  fromPos: { x: number; y: number };
  toPos: { x: number; y: number };
  hasReverse: boolean;
  highlighted: boolean;
  fading: boolean;
  dimmed: boolean;
  mode: EdgeAnimationMode;
  label: string;
  onActivate?: () => void;
}

function GraphEdge({
  edge,
  fromPos,
  toPos,
  hasReverse,
  highlighted,
  fading,
  dimmed,
  mode,
  label,
  onActivate,
}: GraphEdgeProps) {
  const [renderedCents, setRenderedCents] = useState(edge.amountCents);
  const tweenedCents = useRef(edge.amountCents);

  useEffect(() => {
    const from = tweenedCents.current;
    if (from === edge.amountCents) return;
    const settle = (latest: number) => {
      const rounded = Math.round(latest);
      tweenedCents.current = rounded;
      setRenderedCents(rounded);
    };
    const controls = animate(from, edge.amountCents, {
      duration: mode === "crossfade" ? CROSSFADE_SECONDS : 0,
      ease: "easeInOut",
      onUpdate: settle,
      onComplete: () => settle(edge.amountCents),
    });
    return () => controls.stop();
  }, [edge.amountCents, mode]);

  const pathD = getCurvedPath(fromPos, toPos);
  const labelPos = getLabelPosition(fromPos, toPos, hasReverse);
  const strokeColor = highlighted
    ? "var(--color-success)"
    : fading
      ? "var(--color-destructive)"
      : "var(--color-primary)";
  const markerId = highlighted
    ? "arrow-success"
    : fading
      ? "arrow-destructive"
      : dimmed
        ? "arrow-muted"
        : "arrow-primary";
  const targetOpacity = fading ? 0.4 : dimmed ? 0.15 : 1;
  const labelColor = highlighted
    ? "var(--color-success)"
    : fading
      ? "var(--color-muted-foreground)"
      : "var(--color-primary)";
  const transition: Transition =
    mode === "crossfade"
      ? { duration: CROSSFADE_SECONDS, ease: "easeInOut" }
      : mode === "instant"
        ? { duration: 0 }
        : { type: "spring", stiffness: 300, damping: 25 };

  return (
    <motion.g
      initial={mode === "instant" ? false : { opacity: 0 }}
      animate={{ opacity: targetOpacity }}
      exit={mode === "crossfade" ? { opacity: 0, scale: 0.55 } : { opacity: 0 }}
      transition={transition}
      {...(onActivate ? selectable(label, onActivate) : {})}
    >
      <motion.path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={highlighted ? 2.5 : fading ? 2 : 1.75}
        strokeLinecap="round"
        strokeDasharray={fading ? "6 4" : undefined}
        markerEnd={`url(#${markerId})`}
        initial={mode === "instant" ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        exit={mode === "legacy" ? { pathLength: 0 } : undefined}
        transition={
          mode === "crossfade"
            ? { duration: PATH_DRAW_SECONDS, ease: "easeInOut" }
            : mode === "instant"
              ? { duration: 0 }
              : { duration: 0.4, ease: "easeOut" }
        }
      />
      {!dimmed && (
        <motion.foreignObject
          initial={false}
          animate={{ x: labelPos.x - 28, y: labelPos.y - 10 }}
          width={56}
          height={20}
          transition={transition}
          style={{ overflow: "visible" }}
        >
          <motion.div
            className="flex items-center justify-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold tabular-nums bg-card border border-border shadow-sm"
            style={{ color: labelColor, whiteSpace: "nowrap" }}
            initial={mode === "crossfade" ? { opacity: 0, scale: 0.6 } : false}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.4 }}
            transition={transition}
          >
            {formatBRL(renderedCents)}
          </motion.div>
        </motion.foreignObject>
      )}
    </motion.g>
  );
}

export function DebtGraph({
  participants,
  edges,
  rawEdges,
  replayKey = 0,
  selected = null,
  onSelectEdge,
  highlightEdge,
  fadingEdges = [],
  dimOthers = false,
}: DebtGraphProps) {
  const reducedMotion = useReducedMotion();
  const hasRawPhase = rawEdges !== undefined;
  const animateRaw = hasRawPhase && !reducedMotion;
  const mode: EdgeAnimationMode = !hasRawPhase
    ? "legacy"
    : animateRaw
      ? "crossfade"
      : "instant";
  const [phase, setPhase] = useState<{ key: number; raw: boolean }>({
    key: replayKey,
    raw: animateRaw,
  });
  const [pinnedRaw, setPinnedRaw] = useState(false);
  if (phase.key !== replayKey) {
    setPhase({ key: replayKey, raw: animateRaw });
    setPinnedRaw(false);
  }

  useEffect(() => {
    if (!phase.raw) return;
    const timer = setTimeout(
      () =>
        setPhase((current) =>
          current.key === phase.key ? { key: current.key, raw: false } : current,
        ),
      RAW_PHASE_MS,
    );
    return () => clearTimeout(timer);
  }, [phase]);

  const showingRaw = pinnedRaw || (phase.raw && animateRaw);
  const displayedEdges = showingRaw && rawEdges ? rawEdges : edges;

  function toggleRawView() {
    if (pinnedRaw) {
      setPinnedRaw(false);
      setPhase((current) => ({ key: current.key, raw: false }));
      return;
    }
    setPinnedRaw(true);
  }

  const positions = participants.map((_, i) =>
    getNodePosition(i, participants.length),
  );

  const positionMap = new Map(
    participants.map((p, i) => [p.id, positions[i]]),
  );

  const isHighlighted = (fromId: string, toId: string) =>
    (highlightEdge?.from === fromId && highlightEdge?.to === toId) ||
    (selected !== null && selected.from === fromId && selected.to === toId);

  const isFading = (fromId: string, toId: string) =>
    fadingEdges.some((e) => e.from === fromId && e.to === toId);

  function handleSelectEdge(fromId: string, toId: string) {
    if (!onSelectEdge) return;
    if (selected && selected.from === fromId && selected.to === toId) {
      onSelectEdge(null);
      return;
    }
    onSelectEdge({ from: fromId, to: toId });
  }

  function handleSelectNode(nodeId: string) {
    if (!onSelectEdge) return;
    const edge = displayedEdges.find(
      (e) => e.fromUserId === nodeId || e.toUserId === nodeId,
    );
    if (!edge) {
      onSelectEdge(null);
      return;
    }
    handleSelectEdge(edge.fromUserId, edge.toUserId);
  }

  return (
    <>
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        className="w-full max-w-xs mx-auto"
        role="group"
        aria-label="Grafo de dívidas"
      >
        <defs>
          <marker
            id="arrow-primary"
            markerWidth="8"
            markerHeight="8"
            refX="4"
            refY="2"
            orient="auto"
          >
            <path d="M 0 0 L 4 2 L 0 4 Z" className="fill-primary" />
          </marker>
          <marker
            id="arrow-success"
            markerWidth="8"
            markerHeight="8"
            refX="4"
            refY="2"
            orient="auto"
          >
            <path d="M 0 0 L 4 2 L 0 4 Z" className="fill-success" />
          </marker>
          <marker
            id="arrow-muted"
            markerWidth="8"
            markerHeight="8"
            refX="4"
            refY="2"
            orient="auto"
          >
            <path d="M 0 0 L 4 2 L 0 4 Z" className="fill-muted-foreground" />
          </marker>
          <marker
            id="arrow-destructive"
            markerWidth="8"
            markerHeight="8"
            refX="4"
            refY="2"
            orient="auto"
          >
            <path d="M 0 0 L 4 2 L 0 4 Z" className="fill-destructive" />
          </marker>
        </defs>

        <AnimatePresence>
          {displayedEdges.map((edge) => {
            const fromPos = positionMap.get(edge.fromUserId);
            const toPos = positionMap.get(edge.toUserId);
            if (!fromPos || !toPos) return null;

            const highlighted = isHighlighted(edge.fromUserId, edge.toUserId);
            const fading = isFading(edge.fromUserId, edge.toUserId);
            const dimmed = dimOthers && !(highlighted || fading);
            const hasReverse = displayedEdges.some(
              (e) => e.fromUserId === edge.toUserId && e.toUserId === edge.fromUserId,
            );
            const fromName =
              participants.find((p) => p.id === edge.fromUserId)?.name ??
              edge.fromUserId;
            const toName =
              participants.find((p) => p.id === edge.toUserId)?.name ??
              edge.toUserId;

            return (
              <GraphEdge
                key={`${edge.fromUserId}->${edge.toUserId}`}
                edge={edge}
                fromPos={fromPos}
                toPos={toPos}
                hasReverse={hasReverse}
                highlighted={highlighted}
                fading={fading}
                dimmed={dimmed}
                mode={mode}
                label={`${fromName} paga ${formatBRL(edge.amountCents)} para ${toName}`}
                onActivate={
                  onSelectEdge
                    ? () => handleSelectEdge(edge.fromUserId, edge.toUserId)
                    : undefined
                }
              />
            );
          })}
        </AnimatePresence>

        {participants.map((participant, i) => {
          const pos = positions[i];
          const initial = participant.name.charAt(0).toUpperCase();
          const firstName = participant.name.split(" ")[0];

          return (
            <g
              key={participant.id}
              {...(onSelectEdge
                ? selectable(participant.name, () => handleSelectNode(participant.id))
                : {})}
            >
              <circle
                cx={pos.x}
                cy={pos.y}
                r={NODE_RADIUS}
                className="fill-muted stroke-border"
                strokeWidth={1.5}
              />
              <text
                x={pos.x}
                y={pos.y + 5}
                textAnchor="middle"
                className="fill-foreground text-sm font-semibold pointer-events-none"
                style={{ fontSize: 14, fontWeight: 600 }}
              >
                {initial}
              </text>
              <text
                x={pos.x}
                y={pos.y + NODE_RADIUS + 13}
                textAnchor="middle"
                className="fill-muted-foreground pointer-events-none"
                style={{ fontSize: 10 }}
              >
                {firstName}
              </text>
            </g>
          );
        })}
      </svg>
      {hasRawPhase && (
        <div className="flex justify-center pt-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={toggleRawView}
          >
            {showingRaw ? (
              <CheckCheck data-icon="inline-start" />
            ) : (
              <Eye data-icon="inline-start" />
            )}
            {showingRaw ? "Ver plano simplificado" : "Ver dívidas originais"}
          </Button>
        </div>
      )}
    </>
  );
}
