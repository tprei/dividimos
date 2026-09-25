"use client";

import type { MotionValue } from "framer-motion";
import { useEffect, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";
import {
  CLICK_GUARD_MS,
  classifyPress,
  clickGuardAfterRelease,
  dragTrackX,
  pushSample,
  releaseTarget,
  releaseVelocity,
  type ClickGuard,
  type PointerSample,
  type PressIntent,
} from "@/lib/intro-swipe";

interface Gesture {
  pointerId: number;
  originX: number;
  originY: number;
  startX: number;
  lastX: number;
  lastY: number;
  startedAt: number;
  baseX: number;
  width: number;
  intent: PressIntent;
  samples: PointerSample[];
}

interface PendingGuard {
  guard: ClickGuard;
  until: number;
}

interface IntroSwipeOptions {
  stageRef: RefObject<HTMLDivElement | null>;
  progress: MotionValue<number>;
  index: number;
  lastIndex: number;
  onDragStart: () => void;
  onRelease: (target: number) => void;
}

export interface IntroSwipeHandlers {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLDivElement>) => void;
}

/**
 * One gesture model for the whole stage: every press is tentative. It becomes a carousel drag after
 * 8px of mostly horizontal travel, and only a short, still press may reach a scene object as a click.
 */
export function useIntroSwipe({
  stageRef,
  progress,
  index,
  lastIndex,
  onDragStart,
  onRelease,
}: IntroSwipeOptions): IntroSwipeHandlers {
  const gesture = useRef<Gesture | null>(null);
  const guard = useRef<PendingGuard | null>(null);
  const frame = useRef(0);

  const applyDrag = (current: Gesture) => {
    const x = dragTrackX({
      baseX: current.baseX,
      deltaPx: current.lastX - current.startX,
      widthPx: current.width,
      lastIndex,
    });
    progress.set(x / current.width);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (gesture.current !== null) return;
    const width = stageRef.current?.clientWidth || 1;
    guard.current = null;
    gesture.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startX: event.clientX,
      lastX: event.clientX,
      lastY: event.clientY,
      startedAt: event.timeStamp,
      baseX: progress.get() * width,
      width,
      intent: "pending",
      samples: [],
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    current.lastY = event.clientY;
    if (current.intent === "pending") {
      current.intent = classifyPress(event.clientX - current.originX, event.clientY - current.originY);
      if (current.intent !== "drag") return;
      onDragStart();
      current.startX = event.clientX;
      current.baseX = progress.get() * current.width;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (current.intent !== "drag") return;
    current.lastX = event.clientX;
    current.samples = pushSample(current.samples, { t: event.timeStamp, x: event.clientX });
    if (frame.current !== 0) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (gesture.current === current) applyDrag(current);
    });
  };

  const end = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const releasedX = event.type === "pointercancel" ? current.lastX : event.clientX;
    const releasedY = event.type === "pointercancel" ? current.lastY : event.clientY;
    const distancePx = Math.hypot(releasedX - current.originX, releasedY - current.originY);
    const pending = clickGuardAfterRelease({
      intent: current.intent,
      distancePx,
      durationMs: event.timeStamp - current.startedAt,
    });
    guard.current = pending === "none" ? null : { guard: pending, until: performance.now() + CLICK_GUARD_MS };
    if (current.intent !== "drag") return;
    current.lastX = releasedX;
    applyDrag(current);
    const offsetPx = progress.get() * current.width - index * current.width;
    const velocity = releaseVelocity(current.samples, event.timeStamp);
    onRelease(releaseTarget({ index, offsetPx, velocity, widthPx: current.width, lastIndex }));
  };

  useEffect(() => {
    const forget = (event: globalThis.PointerEvent) => {
      const current = gesture.current;
      if (current !== null && current.pointerId === event.pointerId && current.intent !== "drag") {
        gesture.current = null;
      }
    };
    window.addEventListener("pointerup", forget);
    window.addEventListener("pointercancel", forget);
    return () => {
      window.removeEventListener("pointerup", forget);
      window.removeEventListener("pointercancel", forget);
    };
  }, []);

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const pending = guard.current;
    if (pending === null || performance.now() > pending.until) return;
    const inScene = event.target instanceof Element && event.target.closest("[data-intro-scene]") !== null;
    if (pending.guard === "scene" && !inScene) return;
    guard.current = null;
    event.preventDefault();
    event.stopPropagation();
  };

  return { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onClickCapture };
}
