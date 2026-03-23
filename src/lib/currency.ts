const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBRL(cents: number): string {
  return BRL.format(cents / 100);
}

export function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function decimalToCents(value: number): number {
  return Math.round(value * 100);
}

export function parseBRLInput(input: string): number {
  const cleaned = input.replace(/[^\d,.-]/g, "").replace(",", ".");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : decimalToCents(parsed);
}

export function sanitizeDecimalInput(value: string): string {
  return value.replace(/[^\d,]/g, "");
}
