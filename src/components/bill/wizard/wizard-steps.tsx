"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WizardStepsProps {
  /** Step labels in journey order. */
  steps: readonly string[];
  /** Zero-based index of the step on screen. */
  current: number;
}

export function WizardSteps({ steps, current }: WizardStepsProps) {
  return (
    <ol aria-label="Etapas da conta" className="flex items-center gap-1.5 px-4 pb-1 keyboard:hidden">
      {steps.map((label, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        const last = index === steps.length - 1;
        return (
          <li
            key={label}
            aria-current={state === "current" ? "step" : undefined}
            className={cn("flex items-center gap-1.5", !last && "flex-1")}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] leading-none font-bold",
                state === "done" && "bg-primary/15 text-primary-text",
                state === "current" && "bg-primary text-primary-foreground",
                state === "upcoming" && "bg-muted text-muted-foreground",
              )}
            >
              {state === "done" ? <Check className="size-3" /> : index + 1}
            </span>
            <span
              className={
                state === "current"
                  ? "shrink-0 text-xs font-semibold whitespace-nowrap text-foreground"
                  : "sr-only"
              }
            >
              {label}
            </span>
            {!last && (
              <span
                aria-hidden="true"
                className={cn("h-px min-w-3 flex-1", state === "done" ? "bg-primary/40" : "bg-border")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
