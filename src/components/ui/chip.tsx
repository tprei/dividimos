import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "border-border bg-muted text-foreground",
  primary: "border-primary/25 bg-primary/10 text-primary-text",
  success: "border-success/25 bg-success/10 text-success-text",
  danger: "border-destructive/25 bg-destructive/10 text-destructive-text",
  warning: "border-warning/30 bg-warning/10 text-warning-text",
  guest: "border-dashed border-border bg-muted text-muted-foreground",
};

export interface ChipProps extends ComponentProps<"span"> {
  tone?: keyof typeof tones;
  size?: "sm" | "md";
  icon?: ReactNode;
}

export function Chip({ tone = "neutral", size = "sm", icon, className, children, ...props }: ChipProps) {
  return (
    <span {...props} data-slot="chip" className={cn("inline-flex w-fit shrink-0 items-center gap-1 rounded-[0.5rem] border text-xs font-semibold whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0", tones[tone], size === "sm" ? "h-6 px-2" : "h-7 px-2.5", className)}>
      {icon && <span aria-hidden="true" className="flex [&>svg]:size-3">{icon}</span>}
      {children}
    </span>
  );
}
