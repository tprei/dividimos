"use client";

import { Info } from "lucide-react";
import { useId } from "react";
import { GUEST_PAYER_NOTICE } from "@/components/bill/payer-copy";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { cn } from "@/lib/utils";
import { SplitEditor, type SplitEditorProps, type SplitPerson } from "./split-editor";

export interface PayerSplitProps
  extends Omit<SplitEditorProps, "label" | "people" | "emptyText" | "shareVerb"> {
  /** Account holders who could have paid; guests never can. */
  payers: readonly SplitPerson[];
  totalCents: number;
  /** What the total carries beyond the items, e.g. "com serviço"; null for a plain total. */
  totalNote: string | null;
  hasGuests: boolean;
}

/**
 * "Quem pagou": the split editor when there is a choice to make, a plain
 * statement when only one person could have paid.
 */
export function PayerSplit({ payers, totalCents, totalNote, hasGuests, ...editor }: PayerSplitProps) {
  const titleId = useId();
  const sole = payers.length === 1 ? payers[0] : null;
  const totalLabel = totalNote ? `Total ${totalNote}` : "Total";

  return (
    <section aria-labelledby={titleId} className="space-y-1.5">
      <div className={cn("flex items-baseline justify-between gap-3 px-1", sole && "sr-only")}>
        <h2 id={titleId} className="text-xs font-semibold text-muted-foreground">
          Quem pagou
        </h2>
        {!sole && (
          <p className="flex items-baseline gap-1.5 text-xs text-muted-foreground split-typing:hidden">
            {totalLabel}
            <Money cents={totalCents} className="text-sm text-foreground" />
          </p>
        )}
      </div>
      {sole ? (
        <div className="flex min-h-14 items-center gap-3 rounded-[0.75rem] bg-muted px-3 py-2">
          <UserAvatar id={sole.id} name={sole.name} avatarUrl={sole.avatarUrl} size="sm" />
          <p className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold" title={sole.name}>
              {sole.label} pagou
            </span>
            {totalNote && <span className="block text-xs text-muted-foreground">{totalLabel}</span>}
          </p>
          <Money cents={totalCents} className="shrink-0 text-base" />
        </div>
      ) : (
        <SplitEditor
          {...editor}
          label="Quem pagou"
          people={payers}
          emptyText="Escolha quem pagou."
          shareVerb="pagou"
        />
      )}
      {hasGuests && (
        <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground split-typing:hidden">
          <Info aria-hidden="true" className="size-3.5 shrink-0" />
          {GUEST_PAYER_NOTICE}
        </p>
      )}
    </section>
  );
}
