"use client";

import { GUEST_PAYER_NOTICE } from "@/components/bill/payer-copy";
import { SplitEditor, type SplitPerson } from "@/components/bill/split/split-editor";
import { SplitSummary, type SplitSummaryRow } from "@/components/bill/split/split-summary";
import type { SplitMode } from "@/components/bill/split/use-split-draft";
import { Money } from "@/components/shared/money";
import { formatBRL } from "@/lib/currency";

export interface PaymentSectionProps {
  payers: readonly SplitPerson[];
  mode: SplitMode;
  onModeChange: (mode: SplitMode) => void;
  included: readonly string[];
  onToggle: (id: string) => void;
  basisPointsById: Readonly<Record<string, number>>;
  centsById: Readonly<Record<string, number>>;
  onShareChange: (id: string, value: number) => void;
  onSplitEvenly: (() => void) | null;
  remainderCents: number;
  summary: readonly SplitSummaryRow[];
  itemsCents: number;
  serviceFeeCents: number;
  fixedFeesCents: number;
  grandTotal: number;
  hasGuests: boolean;
}

export function PaymentSection({
  payers,
  mode,
  onModeChange,
  included,
  onToggle,
  basisPointsById,
  centsById,
  onShareChange,
  onSplitEvenly,
  remainderCents,
  summary,
  itemsCents,
  serviceFeeCents,
  fixedFeesCents,
  grandTotal,
  hasGuests,
}: PaymentSectionProps) {
  return (
    <div className="space-y-4 px-4 py-3">
      <div className="px-1">
        <p className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Total</span>
          <Money cents={grandTotal} className="text-base" />
        </p>
        {(serviceFeeCents > 0 || fixedFeesCents > 0) && (
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            Itens {formatBRL(itemsCents)}
            {serviceFeeCents > 0 && ` + serviço ${formatBRL(serviceFeeCents)}`}
            {fixedFeesCents > 0 && ` + taxas ${formatBRL(fixedFeesCents)}`}
          </p>
        )}
      </div>
      <section aria-labelledby="itemized-payers" className="space-y-1.5">
        <h2 id="itemized-payers" className="px-1 text-xs font-semibold text-muted-foreground">
          Quem pagou
        </h2>
        {hasGuests && <p className="px-1 text-xs text-muted-foreground">{GUEST_PAYER_NOTICE}</p>}
        <SplitEditor
          label="Quem pagou"
          people={payers}
          mode={mode}
          onModeChange={onModeChange}
          included={included}
          onToggle={onToggle}
          basisPointsById={basisPointsById}
          centsById={centsById}
          onShareChange={onShareChange}
          onSplitEvenly={onSplitEvenly}
          emptyText="Escolha quem pagou."
          shareVerb="pagou"
          remainderCents={remainderCents}
        />
      </section>
      <SplitSummary rows={summary} />
    </div>
  );
}
