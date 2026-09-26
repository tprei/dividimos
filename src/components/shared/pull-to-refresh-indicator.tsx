"use client";

import { ArrowDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Pill height plus the breathing room it keeps above the content. */
const PILL_CLEARANCE = 44;

export interface PullToRefreshIndicatorProps {
  /** Damped pull distance in px; 0 when no pull is in progress. */
  distance: number;
  /** Distance at which releasing fires the refresh. */
  threshold: number;
  /** How far the content has moved down; the pill rides in that gap. */
  contentOffset: number;
  refreshing: boolean;
}

/**
 * Top-centre pill that follows a pull: an arrow that turns as the pull arms,
 * a label that says what releasing will do, then a spinner while it runs.
 */
export function PullToRefreshIndicator({
  distance,
  threshold,
  contentOffset,
  refreshing,
}: PullToRefreshIndicatorProps) {
  const visible = refreshing || distance > 0;
  const armed = distance >= threshold;
  const progress = Math.min(distance / threshold, 1);
  let label = "Puxe para atualizar";
  if (refreshing) label = "Atualizando…";
  else if (armed) label = "Solte para atualizar";

  // With content that doesn't move (reduced motion), the pill simply sits at
  // the top edge; otherwise it slides down just above the content.
  const top = contentOffset > 0 ? contentOffset - PILL_CLEARANCE : 8;

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center",
        !visible && "invisible",
      )}
    >
      <span
        role="status"
        aria-live="polite"
        style={{
          transform: `translateY(${top}px)`,
          opacity: refreshing ? 1 : 0.4 + progress * 0.6,
        }}
        className={cn(
          "flex h-9 items-center gap-2 rounded-full border border-border bg-card pr-3.5 pl-1.5 text-xs font-semibold text-foreground shadow-md",
          distance === 0 && "transition-[transform,opacity] duration-200 motion-reduce:transition-none",
        )}
      >
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full transition-colors duration-150",
            armed || refreshing ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {refreshing ? (
            <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <ArrowDown
              className="size-3.5 transition-transform duration-200 motion-reduce:transition-none"
              style={{ transform: `rotate(${armed ? 180 : 0}deg)` }}
              aria-hidden="true"
            />
          )}
        </span>
        {label}
      </span>
    </div>
  );
}
