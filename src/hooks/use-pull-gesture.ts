"use client";

import type * as React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { haptics } from "@/hooks/use-haptics";

/** Damped pull distance at which a release fires the gesture. */
export const PULL_THRESHOLD = 96;

/**
 * Fields where a vertical drag is text entry or a value change, never a pull.
 * Radios and checkboxes are taps, so a pull may start on them.
 */
export const PULL_IGNORE_FIELDS =
  'input:not([type="radio"]):not([type="checkbox"]), textarea, select, [contenteditable="true"], [role="slider"], [data-no-pull]';

/** Fields plus the controls that own their own drag or press. */
export const PULL_IGNORE_CONTROLS = `${PULL_IGNORE_FIELDS}, button, a, label`;

/** The damped distance approaches but never passes this. */
const PULL_MAX = 140;

/** Finger travel over which resistance builds; ~210px reaches the threshold. */
const PULL_RESISTANCE = 180;

/**
 * A scroller must have been resting at the top this long before the touch:
 * a fling that just reached the top is still the user scrolling, not pulling.
 */
const PULL_REST_MS = 300;

export interface PullGestureHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
}

function isVerticalScroller(node: HTMLElement): boolean {
  const overflowY = window.getComputedStyle(node).overflowY;
  return overflowY === "auto" || overflowY === "scroll";
}

/**
 * The element whose scrollTop decides whether the surface is at its top: the
 * bound element itself when it scrolls vertically, otherwise its nearest such
 * ancestor, otherwise the document.
 */
function resolveScroller(bound: HTMLElement): HTMLElement {
  if (isVerticalScroller(bound)) return bound;
  let node = bound.parentElement;
  while (node) {
    if (isVerticalScroller(node)) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

/**
 * Nearest ancestor that actually scrolls vertically, stopping at `scroller`.
 * A pull that starts inside one belongs to that element, not to the gesture.
 */
function nearestScrollable(from: HTMLElement, scroller: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = from;
  while (node && node !== scroller) {
    if (isVerticalScroller(node) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return scroller;
}

/**
 * Pull-down recognizer shared by the shell's pull-to-refresh and the group
 * screen's pull-to-open-profile; `onPull` runs synchronously on release.
 *
 * A pull is only a pull when the user clearly meant one: a single finger,
 * starting on an element outside `ignore`, on a surface that has been resting
 * at its very top, moving down far enough against growing resistance and
 * released there. Everything else (sliders, horizontal swipes, a second
 * finger, a nested scroller, an open overlay, scrolling back up to the top)
 * is ordinary interaction and must not fire.
 */
export function usePullGesture(options: {
  enabled: boolean;
  /** CSS selector; a pull never starts on a matching element or its descendants. */
  ignore: string;
  onPull: () => void;
}): { distance: number; handlers: PullGestureHandlers } {
  const { enabled, ignore, onPull } = options;
  const [distance, setDistance] = useState(0);
  const start = useRef({ x: 0, y: 0 });
  const touchId = useRef<number | null>(null);
  const damped = useRef(0);
  const lastScrollAt = useRef(Number.NEGATIVE_INFINITY);
  const detach = useRef<(() => void) | null>(null);
  const latest = useRef({ enabled, onPull });

  useLayoutEffect(() => {
    latest.current = { enabled, onPull };
  });

  const cancel = useCallback(() => {
    detach.current?.();
    detach.current = null;
    touchId.current = null;
    damped.current = 0;
    setDistance(0);
  }, []);

  useEffect(() => cancel, [cancel]);

  // Any scroll anywhere — the capture phase catches nested scrollers too —
  // disarms the gesture until the surface has rested again, so the handlers
  // never need an onScroll of their own.
  useEffect(() => {
    const mark = () => {
      lastScrollAt.current = performance.now();
    };
    document.addEventListener("scroll", mark, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", mark, { capture: true });
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      cancel();
      if (!enabled) return;
      if (e.touches.length !== 1) return;

      const source = e.target as HTMLElement;
      if (source.closest(ignore)) return;

      const scroller = resolveScroller(e.currentTarget as HTMLElement);
      if (scroller.scrollTop >= 1) return;
      if (performance.now() - lastScrollAt.current < PULL_REST_MS) return;
      // A gesture that starts inside a nested scroller belongs to that
      // scroller, even when the bound element happens to be at the top.
      if (nearestScrollable(source, scroller) !== scroller) return;

      const touch = e.touches[0];
      start.current = { x: touch.clientX, y: touch.clientY };
      touchId.current = touch.identifier;

      // Touch events keep going to the element the finger landed on, even
      // after a re-render removes it from the page; listening there means a
      // drag always ends instead of freezing half-pulled.
      const onMove = (event: TouchEvent) => {
        // Losing eligibility mid-gesture (navigation, keyboard, an overlay
        // opening) abandons the pull rather than completing it on release.
        const moved = event.touches[0];
        if (!latest.current.enabled || event.touches.length !== 1 || moved.identifier !== touchId.current) {
          cancel();
          return;
        }
        const deltaY = moved.clientY - start.current.y;
        const deltaX = moved.clientX - start.current.x;
        if (deltaY <= 0 || Math.abs(deltaX) > Math.abs(deltaY)) {
          cancel();
          return;
        }

        const next = PULL_MAX * (1 - Math.exp(-deltaY / PULL_RESISTANCE));
        if ((damped.current < PULL_THRESHOLD) !== (next < PULL_THRESHOLD)) haptics.selectionChanged();
        damped.current = next;
        setDistance(next);
      };
      const onEnd = () => {
        const travelled = damped.current;
        cancel();
        if (travelled < PULL_THRESHOLD || !latest.current.enabled) return;

        haptics.impact();
        latest.current.onPull();
      };

      source.addEventListener("touchmove", onMove, { passive: true });
      source.addEventListener("touchend", onEnd);
      source.addEventListener("touchcancel", cancel);
      detach.current = () => {
        source.removeEventListener("touchmove", onMove);
        source.removeEventListener("touchend", onEnd);
        source.removeEventListener("touchcancel", cancel);
      };
    },
    [cancel, enabled, ignore],
  );

  return {
    distance: enabled ? distance : 0,
    handlers: { onTouchStart },
  };
}
