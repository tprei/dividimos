"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ListRowContentProps {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  trailing?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export type ListRowProps = ListRowContentProps & (
  | { href: string; onClick?: never; disabled?: never }
  | { href?: never; onClick: () => void; disabled?: boolean }
  | { href?: never; onClick?: never; disabled?: never }
);

export function ListRow({ leading, title, subtitle, meta, trailing, footer, className, href, onClick, disabled }: ListRowProps) {
  const classes = cn("flex min-h-11 w-full flex-col justify-center px-3 py-2.5 text-left", (href !== undefined || onClick) && "outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50", className);
  const content = <>
    <span className="flex w-full items-center gap-3">
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span title={title} className="block truncate text-base leading-5 font-semibold">{title}</span>
        {subtitle && <span title={subtitle} className="block truncate text-xs leading-4 text-muted-foreground">{subtitle}</span>}
      </span>
      {meta != null && <span className="shrink-0 self-start text-xs leading-5 tabular-nums text-muted-foreground">{meta}</span>}
      {trailing != null && <span className="flex min-h-5 shrink-0 items-center gap-2 self-start">{trailing}</span>}
    </span>
    {footer != null && <span className="block w-full pt-1">{footer}</span>}
  </>;
  if (href !== undefined) return <Link href={href} data-slot="list-row" className={classes}>{content}</Link>;
  if (onClick) return <button type="button" disabled={disabled} onClick={onClick} data-slot="list-row" className={classes}>{content}</button>;
  return <div data-slot="list-row" className={classes}>{content}</div>;
}
