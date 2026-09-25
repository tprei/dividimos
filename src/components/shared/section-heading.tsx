import type { ReactNode } from "react";

export function SectionHeading({
  title,
  count,
  trailing,
}: {
  title: string;
  count?: number;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 pb-1">
      <h2 className="min-w-0 text-base font-bold">{title}{count !== undefined && <span className="ml-2 text-sm font-semibold tabular-nums text-muted-foreground">{count}</span>}</h2>
      {trailing && <div className="shrink-0 text-sm text-muted-foreground">{trailing}</div>}
    </div>
  );
}
