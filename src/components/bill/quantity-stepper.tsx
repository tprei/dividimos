"use client";

import { Minus, Plus } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { haptics } from "@/hooks/use-haptics";

interface QuantityStepperProps {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  step?: number;
  allowDecimal?: boolean;
}

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  step = 1,
  allowDecimal = false,
}: QuantityStepperProps) {
  const numericValue = parseFloat(value.replace(",", ".")) || 0;

  const decrement = useCallback(() => {
    const next = numericValue - step;
    if (next < min) return;
    haptics.selectionChanged();
    onChange(formatValue(next, allowDecimal));
  }, [numericValue, step, min, onChange, allowDecimal]);

  const increment = useCallback(() => {
    const next = numericValue + step;
    haptics.selectionChanged();
    onChange(formatValue(next, allowDecimal));
  }, [numericValue, step, onChange, allowDecimal]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (allowDecimal) {
        if (/^[0-9]*[,.]?[0-9]*$/.test(raw)) {
          onChange(raw);
        }
      } else {
        if (/^[0-9]*$/.test(raw)) {
          onChange(raw);
        }
      }
    },
    [allowDecimal, onChange],
  );

  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        onClick={decrement}
        disabled={numericValue <= min}
        aria-label="Diminuir quantidade"
      >
        <Minus className="h-4 w-4" />
      </Button>
      <Input
        type="text"
        inputMode={allowDecimal ? "decimal" : "numeric"}
        value={value}
        onChange={handleInputChange}
        className="h-9 w-14 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        onClick={increment}
        aria-label="Aumentar quantidade"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

function formatValue(n: number, decimal: boolean): string {
  if (decimal) {
    return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "");
  }
  return String(Math.round(n));
}
