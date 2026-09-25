"use client";

import { useRef, type ChangeEvent, type CSSProperties } from "react";
import { haptics } from "@/hooks/use-haptics";

/** Quarters pull the thumb in from one percent away while dragging. */
const MAGNETS = [25, 50, 75] as const;
const MAGNET_REACH = 1;
/** Every tenth is a detent: a tick on the ruler and a haptic click. */
const DETENT = 10;

export interface ShareSliderProps {
  /** The person's share in basis points (0..10_000). */
  basisPoints: number;
  /** Receives whole percents as basis points. */
  onChange: (basisPoints: number) => void;
  label: string;
  valueText: string;
}

/**
 * Whole-percent slider for one person's share. Dragging clicks at every
 * tick and sticks to the quarters; arrow keys still reach every percent.
 * The track fill and the tick ruler live in globals.css (`[data-ticks]`).
 */
export function ShareSlider({ basisPoints, onChange, label, valueText }: ShareSliderProps) {
  const dragging = useRef(false);
  const percent = Math.round(basisPoints / 100);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = Number(event.target.value);
    const magnet = dragging.current ? MAGNETS.find((point) => Math.abs(raw - point) <= MAGNET_REACH) : undefined;
    const next = magnet ?? raw;
    if (next === percent) return;
    if (dragging.current && (next % DETENT === 0 || magnet !== undefined)) haptics.selectionChanged();
    onChange(next * 100);
  };

  const release = () => {
    dragging.current = false;
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
      aria-valuetext={valueText}
      onChange={handleChange}
      onPointerDown={() => {
        dragging.current = true;
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      style={{ "--range-value": basisPoints / 10_000 } as CSSProperties}
      className="block w-full min-w-0 touch-pan-y"
    />
  );
}
