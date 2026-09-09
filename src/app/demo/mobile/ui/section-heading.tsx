import type { ReactNode } from "react";

export function SectionHeading({
  title,
  trailing,
}: {
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between px-1 pb-2">
      <h2 className="text-sm font-bold">{title}</h2>
      {trailing && <div className="text-xs text-muted-foreground">{trailing}</div>}
    </div>
  );
}
