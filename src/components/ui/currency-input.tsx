"use client";

import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

interface CurrencyInputProps {
  valueCents: number;
  onChangeCents: (cents: number) => void;
  maxCents?: number;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
  "data-testid"?: string;
}

const MAX_SAFE_CENTS = 999_999_99;

function formatCentsDisplay(cents: number): string {
  const clamped = Math.min(Math.max(0, Math.round(cents)), MAX_SAFE_CENTS);
  return (clamped / 100).toFixed(2).replace(".", ",");
}

function parseBrazilianToCents(value: string): number | null {
  const cleaned = value.replace(/[^\d,.\-]/g, "").replace(",", ".");
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function CurrencyInput({
  valueCents,
  onChangeCents,
  maxCents,
  disabled = false,
  className,
  autoFocus,
  ...rest
}: CurrencyInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const clamp = useCallback(
    (cents: number) => {
      const upper = maxCents != null ? Math.min(maxCents, MAX_SAFE_CENTS) : MAX_SAFE_CENTS;
      return Math.min(Math.max(0, cents), upper);
    },
    [maxCents],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;

      if (e.key === "Backspace") {
        e.preventDefault();
        onChangeCents(clamp(Math.floor(valueCents / 10)));
        return;
      }

      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        const digit = parseInt(e.key, 10);
        const next = valueCents * 10 + digit;
        onChangeCents(clamp(next));
        return;
      }
    },
    [valueCents, onChangeCents, clamp, disabled],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const cents = parseBrazilianToCents(raw);
      if (cents !== null) {
        onChangeCents(clamp(cents));
      }
    },
    [onChangeCents, clamp],
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
        onChangeCents(clamp(cents));
      }
    },
    [onChangeCents, clamp],
  );

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
      className={cn(
        "bg-transparent text-center tabular-nums outline-none placeholder:text-muted-foreground/40 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...rest}
    />
  );
}
