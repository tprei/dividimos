"use client";

import type { ChangeEvent, CSSProperties, PointerEvent } from "react";
import { cn } from "@/lib/utils";

export interface DivisionSliderProps {
  ariaLabel: string;
  className?: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}

const SNAP_POINT_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;
const SNAP_THRESHOLD_FRACTION = 0.02;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function DivisionSlider({
  ariaLabel,
  className,
  max,
  min,
  onChange,
  value,
}: DivisionSliderProps) {
  const span = max - min;
  const fill = span > 0 ? clamp(((value - min) / span) * 100, 0, 100) : 0;
  const fillStyle = {
    "--division-slider-fill": `${fill}%`,
  } as CSSProperties;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(clamp(Math.round(Number(event.target.value)), min, max));
  };

  const handleRelease = (event: PointerEvent<HTMLInputElement>) => {
    const current = clamp(Math.round(Number(event.currentTarget.value)), min, max);
    const threshold = span * SNAP_THRESHOLD_FRACTION;
    let snapped = current;
    let best = threshold;
    for (const fraction of SNAP_POINT_FRACTIONS) {
      const point = Math.round(min + fraction * span);
      const distance = Math.abs(current - point);
      if (distance < best) {
        best = distance;
        snapped = point;
      }
    }
    if (snapped !== current) onChange(snapped);
  };

  return (
    <input
      type="range"
      min={min}
      max={max}
      step="any"
      value={value}
      onChange={handleChange}
      onPointerUp={handleRelease}
      aria-label={ariaLabel}
      style={fillStyle}
      className={cn(
        "min-h-11 w-full touch-none",
        "[&::-moz-range-track]:bg-[linear-gradient(to_right,var(--primary)_var(--division-slider-fill),var(--muted)_var(--division-slider-fill))]!",
        "[&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--primary)_var(--division-slider-fill),var(--muted)_var(--division-slider-fill))]!",
        className,
      )}
    />
  );
}
