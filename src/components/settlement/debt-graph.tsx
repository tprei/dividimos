"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { DebtEdge } from "@/lib/simplify";
import { formatBRL } from "@/lib/currency";
import type { User } from "@/types";

interface DebtGraphProps {
  participants: User[];
  edges: DebtEdge[];
  highlightEdge?: { from: string; to: string };
  fadingEdges?: { from: string; to: string }[];
}

const VIEWBOX = 320;
const CENTER = VIEWBOX / 2;
const ORBIT_RADIUS = 108;
const NODE_RADIUS = 22;

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
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = -dy / len;
  const ny = dx / len;
  const curvature = len * 0.25;
  return {
    x: (from.x + to.x) / 2 + nx * curvature * 0.6,
    y: (from.y + to.y) / 2 + ny * curvature * 0.6,
  };
}

function getArrowTransform(
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

  const endOffX = (dx / len) * NODE_RADIUS;
  const endOffY = (dy / len) * NODE_RADIUS;
  const ex = to.x - endOffX;
  const ey = to.y - endOffY;

  const tx = ex - cpx;
  const ty = ey - cpy;
  const tLen = Math.sqrt(tx * tx + ty * ty);
  const angle = Math.atan2(ty / tLen, tx / tLen) * (180 / Math.PI);

  return `translate(${ex}, ${ey}) rotate(${angle})`;
}

export function DebtGraph({
  participants,
  edges,
  highlightEdge,
  fadingEdges = [],
}: DebtGraphProps) {
  const positions = participants.map((_, i) =>
    getNodePosition(i, participants.length),
  );

  const positionMap = new Map(
    participants.map((p, i) => [p.id, positions[i]]),
  );

  const isHighlighted = (fromId: string, toId: string) =>
    highlightEdge?.from === fromId && highlightEdge?.to === toId;

  const isFading = (fromId: string, toId: string) =>
    fadingEdges.some((e) => e.from === fromId && e.to === toId);

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className="w-full max-w-xs mx-auto"
      aria-label="Grafo de dividas"
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
      </defs>

      <AnimatePresence>
        {edges.map((edge) => {
          const fromPos = positionMap.get(edge.fromUserId);
          const toPos = positionMap.get(edge.toUserId);
          if (!fromPos || !toPos) return null;

          const highlighted = isHighlighted(edge.fromUserId, edge.toUserId);
          const fading = isFading(edge.fromUserId, edge.toUserId);
          const edgeKey = `${edge.fromUserId}-${edge.toUserId}`;

          const pathD = getCurvedPath(fromPos, toPos);
          const labelPos = getLabelPosition(fromPos, toPos);
          const arrowTransform = getArrowTransform(fromPos, toPos);

          const strokeColor = highlighted
            ? "var(--color-success)"
            : "var(--color-primary)";
          const markerId = highlighted
            ? "arrow-success"
            : fading
              ? "arrow-muted"
              : "arrow-primary";

          return (
            <motion.g
              key={edgeKey}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: fading ? 0.3 : 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
              <motion.path
                d={pathD}
                fill="none"
                stroke={fading ? "var(--color-muted-foreground)" : strokeColor}
                strokeWidth={highlighted ? 2.5 : 1.75}
                strokeLinecap="round"
                markerEnd={`url(#${markerId})`}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                exit={{ pathLength: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />

              <foreignObject
                x={labelPos.x - 28}
                y={labelPos.y - 10}
                width={56}
                height={20}
                style={{ overflow: "visible" }}
              >
                <div
                  className="flex items-center justify-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold tabular-nums bg-card border border-border shadow-sm"
                  style={{
                    color: highlighted
                      ? "var(--color-success)"
                      : fading
                        ? "var(--color-muted-foreground)"
                        : "var(--color-primary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatBRL(edge.amountCents)}
                </div>
              </foreignObject>
            </motion.g>
          );
        })}
      </AnimatePresence>

      {participants.map((participant, i) => {
        const pos = positions[i];
        const initial = participant.name.charAt(0).toUpperCase();
        const firstName = participant.name.split(" ")[0];

        return (
          <g key={participant.id}>
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
              className="fill-foreground text-sm font-semibold"
              style={{ fontSize: 14, fontWeight: 600 }}
            >
              {initial}
            </text>
            <text
              x={pos.x}
              y={pos.y + NODE_RADIUS + 13}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: 10 }}
            >
              {firstName}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
