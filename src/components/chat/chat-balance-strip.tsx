import type { ReactNode } from "react";
import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";

interface ChatBalanceStripProps {
  netCents: number;
  owedLabel: string;
  action?: ReactNode;
}

export function ChatBalanceStrip({ netCents, owedLabel, action }: ChatBalanceStripProps) {
  if (netCents === 0) return null;
  const owed = netCents > 0;
  return (
    <div className="flex min-h-8 shrink-0 items-center justify-center gap-2 border-y border-border bg-muted/40 px-4 py-0.5">
      <p
        className={cn(
          "flex min-w-0 items-baseline gap-1 text-xs font-semibold",
          owed ? "text-success-text" : "text-destructive-text",
        )}
      >
        <span className="truncate">{owed ? owedLabel : "Você deve"}</span>
        <Money cents={Math.abs(netCents)} size="sm" className="text-xs" />
      </p>
      {action}
    </div>
  );
}
