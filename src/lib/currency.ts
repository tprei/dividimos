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

export function formatBillAmount(
  status: string,
  totalAmountCents: number,
): string {
  if (status === "draft") return "Em criação...";
  return formatBRL(totalAmountCents);
}

/**
 * Distribute a total proportionally among participants using the largest remainder method.
 * Guarantees that the sum of returned values equals the original total exactly.
 *
 * @param total - The total amount to distribute (in cents)
 * @param weights - Array of weights for each participant (e.g., item totals)
 * @returns Array of distributed amounts, one per weight
 */
export function distributeProportionally(
  total: number,
  weights: number[],
): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0 || total === 0) {
    return weights.map(() => 0);
  }

  const exact = weights.map((w) => (w / weightSum) * total);
  const floored = exact.map(Math.floor);
  let remainder = total - floored.reduce((a, b) => a + b, 0);

  // Sort indices by largest fractional part, give 1 centavo to each
  const indices = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  for (const { i } of indices) {
    if (remainder <= 0) break;
    floored[i]++;
    remainder--;
  }

  return floored;
}

/**
 * Distribute a total evenly among n participants using the largest remainder method.
 * Guarantees that the sum of returned values equals the original total exactly.
 *
 * @param total - The total amount to distribute (in cents)
 * @param count - Number of participants
 * @returns Array of distributed amounts
 */
export function distributeEvenly(total: number, count: number): number[] {
  if (count === 0 || total === 0) {
    return [];
  }
  return distributeProportionally(total, new Array(count).fill(1));
}
