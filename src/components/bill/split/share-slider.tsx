"use client";

import { useRef, type ChangeEvent, type CSSProperties, type PointerEvent } from "react";
import { haptics } from "@/hooks/use-haptics";

/** Quarters pull the thumb in from one percent away while dragging. */
const MAGNETS = [25, 50, 75] as const;
const MAGNET_REACH = 1;
/** Every tenth is a detent: a tick on the ruler and a haptic click. */
const DETENT = 10;
/** A press only counts as a drag once the finger travels this far. */
const DRAG_SLOP_PX = 4;

/**
 * `drag` values all derive from the shares as they were when the finger went
 * down, so dragging back returns what the drag borrowed; `end` closes that
 * gesture; `set` is a one-off change (keyboard, typed value).
 */
export type ShareGesture = "set" | "drag" | "end";

export interface ShareSliderProps {
  /** The person's share in basis points (0..10_000). */
  basisPoints: number;
  /** Receives whole percents as basis points. */
  onChange: (basisPoints: number, gesture: ShareGesture) => void;
  label: string;
  valueText: string;
}

interface PointerGesture {
  startX: number;
  moved: boolean;
}

/**
 * Whole-percent slider for one person's share. Dragging clicks at every
 * tick and sticks to the quarters; taps and arrow keys reach every percent.
 * The track fill and the tick ruler live in globals.css (`[data-ticks]`).
 */
export function ShareSlider({ basisPoints, onChange, label, valueText }: ShareSliderProps) {
  const pointer = useRef<PointerGesture | null>(null);
  const percent = Math.round(basisPoints / 100);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = Number(event.target.value);
    const gesture = pointer.current;
    const magnet = gesture?.moved ? MAGNETS.find((point) => Math.abs(raw - point) <= MAGNET_REACH) : undefined;
    const next = (magnet ?? raw) * 100;
    if (next === basisPoints) return;
    if (gesture?.moved && (next % (DETENT * 100) === 0 || magnet !== undefined)) haptics.selectionChanged();
    onChange(next, gesture ? "drag" : "set");
  };

  const release = () => {
    if (!pointer.current) return;
    pointer.current = null;
    onChange(basisPoints, "end");
  };

  return (
    <input
      type="range"
      data-ticks=""
      min={0}
      max={100}
      step={1}
      value={percent}
      aria-label={label}
      aria-valuenow={basisPoints / 100}
      aria-valuetext={valueText}
      onChange={handleChange}
      onPointerDown={(event: PointerEvent<HTMLInputElement>) => {
        pointer.current = { startX: event.clientX, moved: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event: PointerEvent<HTMLInputElement>) => {
        const gesture = pointer.current;
        if (gesture && !gesture.moved && Math.abs(event.clientX - gesture.startX) > DRAG_SLOP_PX) {
          gesture.moved = true;
        }
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={release}
      style={{ "--range-value": basisPoints / 10_000 } as CSSProperties}
      className="block w-full min-w-0 touch-pan-y"
    />
  );
}
