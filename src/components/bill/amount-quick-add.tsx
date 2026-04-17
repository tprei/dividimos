"use client";

import { useCallback, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AmountQuickAddCentsProps {
  increments?: number[];
  valueCents: number;
  onChangeCents: (cents: number) => void;
  currentValue?: never;
  onChange?: never;
}

interface AmountQuickAddStringProps {
  increments?: number[];
  currentValue: string;
  onChange: (newValue: string) => void;
  valueCents?: never;
  onChangeCents?: never;
}

type AmountQuickAddProps = AmountQuickAddCentsProps | AmountQuickAddStringProps;

function parseCurrentValue(value: string): number {
  return parseFloat(value.replace(",", ".")) || 0;
}

function formatBrazilian(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

export function AmountQuickAdd(props: AmountQuickAddProps) {
  const { increments = [1, 5, 10, 50, 100] } = props;
  const isCentsMode = "valueCents" in props && props.valueCents != null;

  const centsHistoryRef = useRef<number[]>([]);
  const stringHistoryRef = useRef<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const handleAdd = useCallback(
    (increment: number) => {
      if (isCentsMode) {
        const p = props as AmountQuickAddCentsProps;
        centsHistoryRef.current.push(p.valueCents);
        setCanUndo(true);
        p.onChangeCents(p.valueCents + increment * 100);
      } else {
        const p = props as AmountQuickAddStringProps;
        stringHistoryRef.current.push(p.currentValue);
        setCanUndo(true);
        const current = parseCurrentValue(p.currentValue);
        p.onChange(formatBrazilian(current + increment));
      }
    },
    [props, isCentsMode],
  );

  const handleUndo = useCallback(() => {
    if (isCentsMode) {
      const prev = centsHistoryRef.current.pop();
      if (prev !== undefined) {
        (props as AmountQuickAddCentsProps).onChangeCents(prev);
      }
      setCanUndo(centsHistoryRef.current.length > 0);
    } else {
      const prev = stringHistoryRef.current.pop();
      if (prev !== undefined) {
        (props as AmountQuickAddStringProps).onChange(prev);
      }
      setCanUndo(stringHistoryRef.current.length > 0);
    }
  }, [props, isCentsMode]);

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
