"use client";

import { CurrencyInput } from "@/components/ui/currency-input";

export interface AmountFieldProps {
  valueCents: number;
  onChangeCents: (cents: number) => void;
  onValidityChange: (valid: boolean) => void;
  autoFocus: boolean;
}

/** The bill total: "R$" and the number share one baseline, no box around them. */
export function AmountField({ valueCents, onChangeCents, onValidityChange, autoFocus }: AmountFieldProps) {
  return (
    <label className="flex items-baseline gap-2 border-b-2 border-border pb-1 transition-colors focus-within:border-primary has-aria-invalid:border-destructive">
      <span aria-hidden="true" className="text-2xl leading-10 font-semibold text-muted-foreground">
        R$
      </span>
      <CurrencyInput
        valueCents={valueCents}
        onChangeCents={onChangeCents}
        onValidityChange={onValidityChange}
        autoFocus={autoFocus}
        aria-label="Valor total"
        className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-left text-4xl leading-10 font-bold tracking-tight focus-visible:ring-0 md:text-4xl"
      />
    </label>
  );
}
