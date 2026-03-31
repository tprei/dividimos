"use client";

import { useCallback, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
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
  const historyRef = useRef<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const handleAdd = useCallback(
    (increment: number) => {
      historyRef.current.push(currentValue);
      setCanUndo(true);
      const current = parseCurrentValue(currentValue);
      const next = current + increment;
      onChange(formatBrazilian(next));
    },
    [currentValue, onChange],
  );

  const handleUndo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (prev !== undefined) {
      onChange(prev);
    }
    setCanUndo(historyRef.current.length > 0);
  }, [onChange]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
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
      {canUndo && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-1.5 text-xs text-muted-foreground"
          onClick={handleUndo}
          aria-label="Desfazer"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
