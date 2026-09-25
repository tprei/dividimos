"use client";

import { useId } from "react";
import { haptics } from "@/hooks/use-haptics";
import { cn } from "@/lib/utils";

export interface SegmentOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  value: string;
  options: readonly SegmentOption[];
  onChange: (value: string) => void;
  "aria-label": string;
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl({ value, options, onChange, disabled, className, "aria-label": label }: SegmentedControlProps) {
  const name = useId();
  return <div role="radiogroup" aria-label={label} className={cn("flex rounded-[0.75rem] border border-border bg-muted p-0.5", className)}>
    {options.map((option) => <label key={option.value} className={cn("relative flex min-h-7.5 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-[0.5rem] px-2 text-center text-sm font-semibold transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50", value === option.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground", (disabled || option.disabled) && "pointer-events-none opacity-50")}>
      <input className="absolute left-0 top-1/2 h-full w-full -translate-y-1/2 cursor-pointer opacity-0 [@media(pointer:coarse)]:min-h-11" type="radio" name={name} value={option.value} checked={value === option.value} disabled={disabled || option.disabled} onChange={() => { haptics.selectionChanged(); onChange(option.value); }} />
      {option.label}
    </label>)}
  </div>;
}
