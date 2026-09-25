import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export interface ChoiceChipProps extends Omit<ComponentProps<"button">, "type"> {
  selected: boolean;
  /** "sm" packs four in a dialog row; its hit area still reaches 44px. */
  size?: "sm" | "md";
}

/** A one-tap answer pill: amber when it holds the current value. */
export function ChoiceChip({ selected, size = "md", className, ...props }: ChoiceChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-slot="choice-chip"
      className={cn(
        "relative inline-flex items-center justify-center gap-1.5 rounded-full border font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:active:scale-100",
        size === "sm" ? "h-9 px-2.5 text-xs after:absolute after:inset-x-0 after:-inset-y-1" : "h-11 px-4 text-sm",
        selected
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-primary/25 bg-card text-foreground hover:border-primary/50",
        className,
      )}
      {...props}
    />
  );
}
