"use client";

import { Button } from "@/components/ui/button";

interface AmountQuickAddProps {
  increments?: number[];
  currentValue: string;
  onChange: (newValue: string) => void;
}

function parseCurrentValue(value: string): number {
  return parseFloat(value.replace(",", ".")) || 0;
}

function formatBrazilian(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

export function AmountQuickAdd({
  increments = [1, 5, 10, 50, 100],
  currentValue,
  onChange,
}: AmountQuickAddProps) {
  const handleAdd = (increment: number) => {
    const current = parseCurrentValue(currentValue);
    const next = current + increment;
    onChange(formatBrazilian(next));
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {increments.map((inc) => (
        <Button
          key={inc}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs tabular-nums"
          onClick={() => handleAdd(inc)}
          aria-label={`Adicionar R$${inc}`}
        >
          +R${inc}
        </Button>
      ))}
    </div>
  );
}
