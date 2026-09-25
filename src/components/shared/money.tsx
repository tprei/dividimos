import { formatBRL } from "@/lib/currency";
import { cn } from "@/lib/utils";

function signedTone(cents: number): string {
  if (cents < 0) return "text-destructive-text";
  if (cents > 0) return "text-success-text";
  return "text-muted-foreground";
}

function signPrefix(cents: number): string {
  if (cents < 0) return "−";
  if (cents > 0) return "+";
  return "";
}

const sizes = { sm: "text-sm", md: "text-base", lg: "text-2xl font-bold", hero: "text-4xl font-bold" };

export interface MoneyProps {
  cents: number;
  tone?: "auto" | "neutral" | "positive" | "negative";
  signed?: boolean;
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
  label?: string;
}

export function Money({
  cents,
  signed = false,
  tone = signed ? "auto" : "neutral",
  size = "md",
  className,
  label,
}: MoneyProps) {
  return (
    <span aria-label={label} className={cn("font-sans font-semibold whitespace-nowrap tabular-nums tracking-tight", sizes[size], tone === "auto" ? signedTone(cents) : tone === "positive" ? "text-success-text" : tone === "negative" ? "text-destructive-text" : "text-inherit", className)}>
      {signed && signPrefix(cents)}
      {formatBRL(Math.abs(cents))}
    </span>
  );
}
