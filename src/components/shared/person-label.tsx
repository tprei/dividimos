"use client";

import { cn } from "@/lib/utils";

interface PersonLabelProps {
  name: string;
  /** Omitted or null for guests, who have no handle. */
  handle?: string | null;
  /** Shown in place of the name, e.g. "Eu". The handle still renders. */
  overrideName?: string;
  className?: string;
  nameClassName?: string;
}

export function PersonLabel({
  name,
  handle,
  overrideName,
  className,
  nameClassName,
}: PersonLabelProps) {
  return (
    <span className={cn("flex min-w-0 flex-col items-start leading-tight", className)}>
      <span className={cn("font-semibold break-words", nameClassName)}>
        {overrideName ?? name}
      </span>
      {handle && (
        <span className="text-[11px] font-normal break-all text-muted-foreground">
          @{handle}
        </span>
      )}
    </span>
  );
}
