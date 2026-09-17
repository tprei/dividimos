import { formatBRL } from "@/lib/currency";
import { cn } from "@/lib/utils";

function signedTone(cents: number): string {
  if (cents < 0) return "text-destructive";
  if (cents > 0) return "text-success-text";
  return "";
}

function signPrefix(cents: number): string {
  if (cents < 0) return "−";
  if (cents > 0) return "+";
  return "";
}

export function Money({
  cents,
  signed = false,
  className,
  label,
}: {
  cents: number;
  signed?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <span aria-label={label} className={cn("font-sans font-semibold tabular-nums tracking-tight", signed && signedTone(cents), className)}>
      {signed && signPrefix(cents)}
      {formatBRL(Math.abs(cents))}
    </span>
  );
}
