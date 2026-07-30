"use client";

import { useCallback, useEffect, useRef } from "react";
import { MAX_EXPENSE_CENTS } from "@/lib/expense-money";
import { cn } from "@/lib/utils";

interface CurrencyInputProps {
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
 * Lenient as-you-type parse to integer cents without float arithmetic.
 * Accepts optional thousands dots and a comma decimal separator; returns null
 * for empty or non-numeric input. Final validation against the product cap and
 * grammar happens through the shared `parseExpenseCentsText` parser at the
 * owning form boundary.
 */
function parseBrazilianToCents(value: string): number | null {
  const stripped = value.replace(/[^\d,]/g, "");
  if (stripped === "" || stripped === ",") return null;
  const commaIndex = stripped.indexOf(",");
  if (commaIndex === -1) {
    const intPart = parseInt(stripped, 10);
    if (!Number.isSafeInteger(intPart)) return null;
    const cents = intPart * 100;
    return Number.isSafeInteger(cents) ? cents : null;
  }
  const intRaw = stripped.slice(0, commaIndex).replace(/\./g, "");
  const fracRaw = stripped.slice(commaIndex + 1);
  const intPart = intRaw === "" ? 0 : parseInt(intRaw, 10);
  if (!Number.isSafeInteger(intPart)) return null;
  const intCents = intPart * 100;
  if (!Number.isSafeInteger(intCents)) return null;
  const frac = parseInt(fracRaw.slice(0, 2).padEnd(2, "0"), 10);
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
  ...rest
}: CurrencyInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const upper = maxCents != null ? Math.min(maxCents, MAX_EXPENSE_CENTS) : MAX_EXPENSE_CENTS;
    onValidityChange?.(valueCents >= 0 && valueCents <= upper);
  }, [valueCents, maxCents, onValidityChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;

      if (e.key === "Backspace") {
        e.preventDefault();
        onChangeCents(Math.max(0, Math.floor(valueCents / 10)));
        return;
      }

      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        const digit = parseInt(e.key, 10);
        onChangeCents(valueCents * 10 + digit);
        return;
      }
    },
    [valueCents, onChangeCents, disabled],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const cents = parseBrazilianToCents(raw);
      if (cents !== null) {
        onChangeCents(cents);
      }
    },
    [onChangeCents],
  );

  const handleFocus = useCallback(() => {
    const el = inputRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.setSelectionRange(el.value.length, el.value.length);
      });
    }
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text");
      const cents = parseBrazilianToCents(text);
      if (cents !== null) {
        onChangeCents(cents);
      }
    },
    [onChangeCents],
  );

  const upper = maxCents != null ? Math.min(maxCents, MAX_EXPENSE_CENTS) : MAX_EXPENSE_CENTS;
  const isInvalid = valueCents < 0 || valueCents > upper;

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={formatCentsDisplay(valueCents)}
      onKeyDown={handleKeyDown}
      onChange={handleChange}
      onFocus={handleFocus}
      onPaste={handlePaste}
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
