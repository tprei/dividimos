"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import type { MotionValue } from "framer-motion";
import { createContext, useContext, useLayoutEffect, type ReactNode, type Ref } from "react";
import { PULL_IGNORE_FIELDS, PULL_THRESHOLD, usePullGesture } from "@/hooks/use-pull-gesture";
import { springs } from "@/lib/animations";
import { cn } from "@/lib/utils";

const PullProgressContext = createContext<MotionValue<number> | null>(null);

/** Pull progress (0 resting, 1 armed) for visuals that track the finger. */
export function usePullProgress() {
  return useContext(PullProgressContext);
}

export interface GroupPullRevealProps {
  enabled: boolean;
  onPull: () => void;
  hint: { idle: string; armed: string };
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/**
 * The group screen's pull affordance. It is the only holder of the gesture
 * recognizer, so a touchmove re-renders just this wrapper: the view subtrees
 * arrive as stable `children`, and progress-driven visuals elsewhere read
 * `usePullProgress` instead of React state.
 */
export function GroupPullReveal({ enabled, onPull, hint, children, ref }: GroupPullRevealProps) {
  const reduced = useReducedMotion() ?? false;
  const progress = useMotionValue(0);
  const { distance, handlers } = usePullGesture({ enabled, ignore: PULL_IGNORE_FIELDS, onPull });

  // While dragging, progress tracks the finger exactly; only the release
  // springs back, so a short pull bounces instead of snapping.
  useLayoutEffect(() => {
    if (distance === 0) animate(progress, 0, springs.snappy);
    else progress.jump(distance / PULL_THRESHOLD);
  }, [distance, progress]);

  const armed = distance >= PULL_THRESHOLD;
  const contentY = reduced ? 0 : distance * 0.55;
  const labelOpacity = reduced ? (distance > 0 ? 1 : 0) : Math.min(distance / 34, 1);

  return (
    <div
      ref={ref}
      className="relative"
      onTouchStart={(event) => {
        // Portaled overlays (dialogs, popovers) bubble React touches here even
        // though they sit outside this subtree; a pull never starts on them.
        if (event.currentTarget.contains(event.target as Node)) handlers.onTouchStart(event);
      }}
    >
      <PullProgressContext.Provider value={progress}>
        <motion.div
          animate={{ y: contentY }}
          transition={distance > 0 ? { duration: 0 } : springs.snappy}
          className="relative"
        >
          {children}
        </motion.div>
        <motion.div
          aria-hidden="true"
          animate={{ opacity: labelOpacity }}
          transition={{ duration: 0.12 }}
          className="pointer-events-none absolute inset-x-0 top-1.5 z-30 flex justify-center"
        >
          <span
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium shadow-sm",
              armed ? "bg-foreground text-background" : "bg-muted/90 text-muted-foreground backdrop-blur-sm",
            )}
          >
            {armed ? hint.armed : hint.idle}
          </span>
        </motion.div>
      </PullProgressContext.Provider>
    </div>
  );
}

/** Scales its child with pull progress — the header avatar "about to open". */
export function PullScale({ to = 1.5, children }: { to?: number; children: ReactNode }) {
  const reduced = useReducedMotion() ?? false;
  const progress = usePullProgress();
  const resting = useMotionValue(0);
  const scale = useTransform(progress ?? resting, [0, 1], [1, to]);
  if (reduced || progress === null) return <>{children}</>;
  return <motion.span style={{ scale }} className="block">{children}</motion.span>;
}
