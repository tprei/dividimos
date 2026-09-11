"use client";

import { Coins, Equal, Percent, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type DivisionModeKey = "equal" | "percent" | "fixed";

const MODE_OPTIONS: { key: DivisionModeKey; name: string; icon: LucideIcon }[] = [
  { key: "equal", name: "Igual", icon: Equal },
  { key: "percent", name: "Percentual", icon: Percent },
  { key: "fixed", name: "Fixo", icon: Coins },
];

export interface DivisionModePillsProps {
  value: DivisionModeKey;
  onChange: (mode: DivisionModeKey) => void;
  groupLabel: string;
  idPrefix: string;
  disabled?: boolean;
}

export function DivisionModePills({
  value,
  onChange,
  groupLabel,
  idPrefix,
  disabled = false,
}: DivisionModePillsProps): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      id={idPrefix}
      aria-label={groupLabel}
      className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
    >
      {MODE_OPTIONS.map((option) => {
        const active = value === option.key;
        return (
          <button
            key={option.key}
            id={`${idPrefix}-${option.key}`}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.name}
            disabled={disabled}
            onClick={() => onChange(option.key)}
            className={cn(
              "flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-colors",
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            <option.icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
