"use client";

import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";

export interface FixedAmountHelpersProps {
  totalCents: number;
  remainingCents: number;
  onAdd: (deltaCents: number) => void;
  disabled?: boolean;
}

const ladderReais = [1, 2, 5, 10, 20, 50, 100, 200, 500];

function deriveChipCents(totalCents: number): number[] {
  const halfTotalReais = Math.floor(totalCents / 200);
  return ladderReais
    .filter((reais) => reais <= halfTotalReais)
    .slice(-3)
    .map((reais) => reais * 100);
}

export function FixedAmountHelpers({
  totalCents,
  remainingCents,
  onAdd,
  disabled = false,
}: FixedAmountHelpersProps): React.JSX.Element {
  const chipCents = deriveChipCents(totalCents);
  const showFill =
    remainingCents > 0 && !chipCents.includes(remainingCents);

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid="fixed-amount-helpers"
    >
      {chipCents.map((cents) => (
        <Button
          key={cents}
          type="button"
          variant="outline"
          size="sm"
          className="h-11 px-3 text-xs tabular-nums"
          onClick={() => onAdd(cents)}
          disabled={disabled || cents > remainingCents}
          aria-label={`Adicionar ${formatBRL(cents)}`}
        >
          +{formatBRL(cents)}
        </Button>
      ))}
      {showFill && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-11 px-3 text-xs tabular-nums"
          onClick={() => onAdd(remainingCents)}
          disabled={disabled}
          aria-label={`Completar ${formatBRL(remainingCents)}`}
          data-testid="fixed-amount-fill"
        >
          +{formatBRL(remainingCents)}
        </Button>
      )}
    </div>
  );
}
