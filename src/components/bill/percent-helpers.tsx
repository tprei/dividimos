"use client";

import { Button } from "@/components/ui/button";

export interface PercentHelpersProps {
  remainingBasisPoints: number;
  onAdd: (deltaBasisPoints: number) => void;
  disabled?: boolean;
}

const CHIP_BASIS_POINTS = [500, 1000, 2500];

function percentLabelText(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
}

export function PercentHelpers({
  remainingBasisPoints,
  onAdd,
  disabled = false,
}: PercentHelpersProps): React.JSX.Element {
  const showFill =
    remainingBasisPoints > 0 && !CHIP_BASIS_POINTS.includes(remainingBasisPoints);

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid="percent-helpers"
    >
      {CHIP_BASIS_POINTS.map((bp) => (
        <Button
          key={bp}
          type="button"
          variant="outline"
          size="sm"
          className="h-11 px-3 text-xs tabular-nums"
          onClick={() => onAdd(bp)}
          disabled={disabled || bp > remainingBasisPoints}
          aria-label={`Adicionar ${percentLabelText(bp)}%`}
        >
          +{percentLabelText(bp)}%
        </Button>
      ))}
      {showFill && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-11 px-3 text-xs tabular-nums"
          onClick={() => onAdd(remainingBasisPoints)}
          disabled={disabled}
          aria-label={`Completar ${percentLabelText(remainingBasisPoints)}%`}
          data-testid="percent-helpers-fill"
        >
          +{percentLabelText(remainingBasisPoints)}%
        </Button>
      )}
    </div>
  );
}
