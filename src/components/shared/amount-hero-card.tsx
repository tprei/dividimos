import type { ComponentProps, ReactNode } from "react";
import { Money, type MoneyProps } from "@/components/shared/money";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";

export interface AmountHeroDetail {
  label: string;
  value: ReactNode;
}

export interface AmountHeroCardProps extends Omit<ComponentProps<"div">, "children"> {
  /** Muted line above the amount ("Sua parte", "A receber no total"). */
  label: ReactNode;
  cents: number;
  tone?: MoneyProps["tone"];
  /** Context above the label, e.g. the bill it belongs to. */
  eyebrow?: ReactNode;
  /** Compact facts under a divider; two or three read best on a phone. */
  details?: AmountHeroDetail[];
}

const DETAIL_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
};

/**
 * The one "how much is mine" card: soft mesh surface, muted label, big
 * tabular amount in its semantic tone, then an optional row of small facts.
 * Pass `role="region"` and an `aria-label` when the card is a landmark.
 */
export function AmountHeroCard({ label, cents, tone = "neutral", eyebrow, details = [], className, ...props }: AmountHeroCardProps) {
  return (
    <SectionCard {...props} className={cn("gradient-mesh p-5", className)}>
      {eyebrow && <div className="mb-3 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">{eyebrow}</div>}
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <Money cents={cents} size="hero" tone={tone} className="mt-2 block leading-tight" />
      {details.length > 0 && (
        <dl className={cn("mt-4 grid gap-3 border-t border-border pt-3", DETAIL_COLUMNS[Math.min(details.length, 3)])}>
          {details.map((detail) => (
            <div key={detail.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{detail.label}</dt>
              <dd className="truncate text-sm font-semibold tabular-nums">{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </SectionCard>
  );
}
