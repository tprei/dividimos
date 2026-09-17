"use client";

import { useCallback, useEffect, useState } from "react";
import { MAX_EXPENSE_CENTS } from "@/lib/expense-money";
import { cn } from "@/lib/utils";

interface CurrencyInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange"> {
  valueCents: number;
  onChangeCents: (cents: number) => void;
  maxCents?: number;
  onValidityChange?: (valid: boolean) => void;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
}

const minorUnitsPerReal = BigInt(100);

/** Exact cents → "reais,cents" display (no float, no clamp, no cent loss). */
function formatCentsDisplay(cents: number): string {
  const big = BigInt(cents);
  const reais = big / minorUnitsPerReal;
  const remainder = big % minorUnitsPerReal;
  return `${reais.toString()},${remainder.toString().padStart(2, "0")}`;
}

/**
 * Strict decimal-text parse to integer cents without float arithmetic.
 * Trims whitespace and an optional leading R$. Accepts a pt-BR comma decimal
 * (10,50 / 10,5 / ,50), a single ungrouped dot decimal with 1-2 trailing
 * digits (10.50 / 10.5 / .50), and dot thousands grouping (1.234 / 1.234,56).
 * Rejects malformed grouping (1.23.456), excess decimals (10,505), repeated
 * separators (10,,50), and negative signs. Returns null for unparseable text;
 * empty text is the caller's 0, not a parse result.
 */
function parseBrazilianToCents(value: string): number | null {
  let text = value.trim();
  if (text === "") return null;
  if (text.startsWith("R$")) {
    text = text.slice(2).trim();
    if (text === "") return null;
  }
  if (text.startsWith("-") || text.startsWith("+")) return null;

  const commaCount = (text.match(/,/g) ?? []).length;
  const dotCount = (text.match(/\./g) ?? []).length;
  if (commaCount > 1) return null;
  if (commaCount === 1 && dotCount > 0) {
    const [intRaw, fracRaw] = text.split(",");
    if (!/^\d{1,3}(\.\d{3})*$/.test(intRaw) || intRaw === "") return null;
    if (!/^\d{1,2}$/.test(fracRaw)) return null;
    const intPart = parseInt(intRaw.replace(/\./g, ""), 10);
    if (!Number.isSafeInteger(intPart)) return null;
    const intCents = intPart * 100;
    if (!Number.isSafeInteger(intCents)) return null;
    const frac = parseInt(fracRaw.padEnd(2, "0"), 10);
    if (!Number.isSafeInteger(frac)) return null;
    return intCents + frac;
  }
  if (commaCount === 1) {
    const [intRaw, fracRaw] = text.split(",");
    if (intRaw !== "" && !/^\d+$/.test(intRaw)) return null;
    if (!/^\d{1,2}$/.test(fracRaw)) return null;
    const intPart = intRaw === "" ? 0 : parseInt(intRaw, 10);
    if (!Number.isSafeInteger(intPart)) return null;
    const intCents = intPart * 100;
    if (!Number.isSafeInteger(intCents)) return null;
    const frac = parseInt(fracRaw.padEnd(2, "0"), 10);
    if (!Number.isSafeInteger(frac)) return null;
    return intCents + frac;
  }
  if (dotCount === 0) {
    if (!/^\d+$/.test(text)) return null;
    const intPart = parseInt(text, 10);
    if (!Number.isSafeInteger(intPart)) return null;
    const cents = intPart * 100;
    return Number.isSafeInteger(cents) ? cents : null;
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    const intPart = parseInt(text.replace(/\./g, ""), 10);
    if (!Number.isSafeInteger(intPart)) return null;
    const cents = intPart * 100;
    return Number.isSafeInteger(cents) ? cents : null;
  }
  const dotIndex = text.indexOf(".");
  if (text.indexOf(".", dotIndex + 1) !== -1) return null;
  const intRaw = text.slice(0, dotIndex);
  const fracRaw = text.slice(dotIndex + 1);
  if (intRaw !== "" && !/^\d+$/.test(intRaw)) return null;
  if (!/^\d{1,2}$/.test(fracRaw)) return null;
  const intPart = intRaw === "" ? 0 : parseInt(intRaw, 10);
  if (!Number.isSafeInteger(intPart)) return null;
  const intCents = intPart * 100;
  if (!Number.isSafeInteger(intCents)) return null;
  const frac = parseInt(fracRaw.padEnd(2, "0"), 10);
  if (!Number.isSafeInteger(frac)) return null;
  return intCents + frac;
}

export function CurrencyInput({
  valueCents,
  onChangeCents,
  maxCents,
  onValidityChange,
  disabled = false,
  className,
  autoFocus,
  onFocus,
  onBlur,
  placeholder = "0,00",
  ...rest
}: CurrencyInputProps) {
  const upper = maxCents != null ? Math.min(maxCents, MAX_EXPENSE_CENTS) : MAX_EXPENSE_CENTS;

  const [editingText, setEditingText] = useState<string | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [committedCents, setCommittedCents] = useState(valueCents);

  const [prevValueCents, setPrevValueCents] = useState(valueCents);
  if (valueCents !== prevValueCents) {
    setPrevValueCents(valueCents);
    if (valueCents !== committedCents) {
      setEditingText(null);
      setOverride(null);
    }
  }

  const isInvalid = override !== null;

  useEffect(() => {
    onValidityChange?.(!isInvalid);
  }, [isInvalid, onValidityChange]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setEditingText(raw);
      if (raw === "") {
        setOverride(null);
        setCommittedCents(0);
        onChangeCents(0);
        return;
      }
      const cents = parseBrazilianToCents(raw);
      if (cents !== null && cents >= 0 && cents <= upper) {
        setOverride(null);
        setCommittedCents(cents);
        onChangeCents(cents);
      } else {
        setOverride(raw);
      }
    },
    [upper, onChangeCents],
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const current = editingText ?? (valueCents === 0 ? "" : formatCentsDisplay(valueCents));
      if (current === "") {
        setEditingText(null);
        setOverride(null);
      } else {
        const parsed = parseBrazilianToCents(current);
        if (parsed !== null && parsed >= 0 && parsed <= upper) {
          setEditingText(null);
          setOverride(null);
        } else {
          setEditingText(current);
          setOverride(current);
        }
      }
      onBlur?.(e);
    },
    [editingText, valueCents, upper, onBlur],
  );

  const handleFocus = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      e.currentTarget.select();
      onFocus?.(e);
    },
    [onFocus],
  );

  const displayValue =
    editingText !== null
      ? editingText
      : valueCents === 0
        ? ""
        : formatCentsDisplay(valueCents);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={displayValue}
      placeholder={placeholder}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-invalid={isInvalid || undefined}
      className={cn(
        "bg-transparent text-center tabular-nums outline-none placeholder:text-muted-foreground/40 disabled:pointer-events-none disabled:opacity-50",
        isInvalid && "text-destructive",
        className,
      )}
      {...rest}
    />
  );
}
