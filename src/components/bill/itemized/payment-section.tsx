"use client";

import { PayerSplit, type PayerSplitProps } from "@/components/bill/split/payer-split";
import { SplitSummary, type SplitSummaryRow } from "@/components/bill/split/split-summary";

export interface PaymentSectionProps extends PayerSplitProps {
  summary: readonly SplitSummaryRow[];
}

export function PaymentSection({ summary, ...payer }: PaymentSectionProps) {
  return (
    <div className="space-y-4 px-4 py-3">
      <PayerSplit {...payer} />
      <SplitSummary rows={summary} />
    </div>
  );
}
