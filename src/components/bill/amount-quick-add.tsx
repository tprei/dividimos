"use client";

import { useCallback, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AmountQuickAddCentsProps {
  increments?: number[];
  valueCents: number;
  onChangeCents: (cents: number) => void;
  maxCents?: number;
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

function parseCurrentValueToCents(value: string): number {
  const normalized = value.replace(",", ".");
  const dotIndex = normalized.indexOf(".");
  if (dotIndex === -1) {
    const n = parseInt(normalized, 10);
    return Number.isSafeInteger(n) ? n * 100 : 0;
  }
  const intPart = normalized.slice(0, dotIndex);
  const frac = normalized.slice(dotIndex + 1, dotIndex + 3).padEnd(2, "0");
  const intN = intPart === "" ? 0 : parseInt(intPart, 10);
  const fracN = parseInt(frac, 10);
  if (!Number.isSafeInteger(intN) || !Number.isSafeInteger(fracN)) return 0;
  return intN * 100 + fracN;
}

const minorUnitsPerReal = BigInt(100);

function formatCentsToBrazilian(cents: number): string {
  const big = BigInt(cents);
  const reais = big / minorUnitsPerReal;
  const rem = big % minorUnitsPerReal;
  return `${reais.toString()},${rem.toString().padStart(2, "0")}`;
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
        const next = Math.min(p.valueCents + increment * 100, p.maxCents ?? Number.MAX_SAFE_INTEGER);
        p.onChangeCents(next);
      } else {
        const p = props as AmountQuickAddStringProps;
        stringHistoryRef.current.push(p.currentValue);
        setCanUndo(true);
        const currentCents = parseCurrentValueToCents(p.currentValue);
        p.onChange(formatCentsToBrazilian(currentCents + increment * 100));
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
