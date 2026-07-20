/**
 * Domain-neutral safe-integer minor-unit currency brands and formatter.
 *
 * This module knows no expense, settlement, or balance maximum. It owns only
 * the structural guarantee that a cent value is a safe integer in minor units
 * (centavos). Expense, settlement, and cumulative-balance domains refine these
 * base brands with their own runtime bounds; callers never assert a base brand.
 *
 * Per issue #477: `formatBRL` converts an already-safe integer to `bigint` and
 * never divides by 100 in floating point, so a value near `Number.MAX_SAFE_INTEGER`
 * loses no cents. The TypeScript target is ES2017, so every `bigint` constant is
 * constructed with `BigInt(...)` rather than a literal (`100n` is ES2020 syntax).
 */

declare const safeMinorUnitCentsBrand: unique symbol;
declare const signedSafeMinorUnitCentsBrand: unique symbol;

/** Nonnegative safe integer in minor units (centavos), `[0, Number.MAX_SAFE_INTEGER]`. */
export type SafeMinorUnitCents = number & {
  readonly [safeMinorUnitCentsBrand]: true;
};

/** Signed safe integer in minor units, `[-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]`. */
export type SignedSafeMinorUnitCents = number & {
  readonly [signedSafeMinorUnitCentsBrand]: true;
};

export type CurrencyResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      issue: "not_number" | "nonfinite" | "fractional" | "unsafe" | "negative";
    }>;

/**
 * Accepts a safe integer in `[0, Number.MAX_SAFE_INTEGER]`.
 *
 * Rejects strings, booleans, objects, `NaN`, infinities, fractions, unsafe
 * integers, and negative values. Provider/parser boundaries never call
 * `Math.round`, `parseFloat`, or unary coercion before this.
 */
export function parseSafeMinorUnitCents(
  value: unknown,
): CurrencyResult<SafeMinorUnitCents> {
  if (typeof value !== "number" || Array.isArray(value) || value === null) {
    return { ok: false, issue: "not_number" };
  }
  if (!Number.isFinite(value)) {
    return { ok: false, issue: "nonfinite" };
  }
  if (!Number.isInteger(value)) {
    return { ok: false, issue: "fractional" };
  }
  if (!Number.isSafeInteger(value)) {
    return { ok: false, issue: "unsafe" };
  }
  if (value < 0) {
    return { ok: false, issue: "negative" };
  }
  return { ok: true, value: value as SafeMinorUnitCents };
}

/**
 * Accepts a safe integer in `[-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]`.
 *
 * Rejects the same structural defects as the unsigned parser except that
 * negative values are valid.
 */
export function parseSignedSafeMinorUnitCents(
  value: unknown,
): CurrencyResult<SignedSafeMinorUnitCents> {
  if (typeof value !== "number" || Array.isArray(value) || value === null) {
    return { ok: false, issue: "not_number" };
  }
  if (!Number.isFinite(value)) {
    return { ok: false, issue: "nonfinite" };
  }
  if (!Number.isInteger(value)) {
    return { ok: false, issue: "fractional" };
  }
  if (!Number.isSafeInteger(value)) {
    return { ok: false, issue: "unsafe" };
  }
  return { ok: true, value: value as SignedSafeMinorUnitCents };
}

const minorUnitsPerReal = BigInt(100);

const integralReaisFormatter = new Intl.NumberFormat("pt-BR", {
  useGrouping: true,
  maximumFractionDigits: 0,
});

/**
 * Format a safe-integer minor-unit value as a BRL string.
 *
 * Accepts a branded `SafeMinorUnitCents`/`SignedSafeMinorUnitCents` (the
 * compile-time proof used once issue #468's snapshot loader brands the storage
 * type surface) or, as an interim read/display boundary, a raw `number` whose
 * value is already a safe integer in minor units. The value is converted to
 * `bigint` before any arithmetic, so values near `Number.MAX_SAFE_INTEGER` lose
 * no cents. Does not apply any expense cap and never clamps. Negative output
 * uses the existing `-R$ <reais>,<cents>` convention; nonnegative output uses
 * `R$ <reais>,<cents>` with a non-breaking space separator.
 *
 * This replaces the previous lossy `BRL.format(cents / 100)` float path.
 */
export function formatBRL(
  cents: SafeMinorUnitCents | SignedSafeMinorUnitCents | number,
): string {
  const signed = cents as number;
  const isNegative = signed < 0;
  const absolute = BigInt(isNegative ? -signed : signed);
  const reais = absolute / minorUnitsPerReal;
  const remainder = absolute % minorUnitsPerReal;
  const reaisText = integralReaisFormatter.format(reais);
  const centsText = remainder.toString().padStart(2, "0");
  const prefix = isNegative ? "-R$\u00a0" : "R$\u00a0";
  return `${prefix}${reaisText},${centsText}`;
}
