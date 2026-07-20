/**
 * Expense item quantity model — the one persisted quantity representation
 * shared by scan, AI, manual review, the store, and SQL (issue #578).
 *
 * Quantity is an exact positive integer in **milliunits** (thousandths): `1500`
 * represents `1,5` items. Three fractional digits are the maximum precision;
 * the line total is `round_half_up(quantity_milliunits * unit_price_cents /
 * 1000)` in `bigint`, so `0,5 x R$ 1,01` = 51 centavos exactly and never a
 * float. This is the representation #477 imports; no second decimal/milliunit
 * convention is introduced.
 *
 * The TypeScript target is ES2017, so `bigint` constants use `BigInt(...)`.
 */

import {
  MAX_EXPENSE_CENTS,
  brandExpenseCents,
  type ExpenseCents,
} from "./expense-money";

/** Maximum representable quantity: `999.999` items (`999_999_999` milliunits). */
export const MAX_EXPENSE_QUANTITY_MILLIUNITS = 999_999_999 as const;

/** Quantity precision: three fractional digits (thousandths). */
export const EXPENSE_QUANTITY_DECIMAL_PLACES = 3 as const;
const MILLIUNITS_PER_UNIT = BigInt(1000);
const HALF_UP_BIAS = BigInt(500);
const MAX_EXPENSE_CENTS_BIG = BigInt(MAX_EXPENSE_CENTS as number);

declare const expenseQuantityBrand: unique symbol;

/** Positive integer milliunits in `[1, MAX_EXPENSE_QUANTITY_MILLIUNITS]`. */
export type ExpenseQuantity = number & {
  readonly [expenseQuantityBrand]: true;
};

export type QuantityValidationIssue =
  | Readonly<{ code: "required" }>
  | Readonly<{ code: "not_number" }>
  | Readonly<{ code: "nonfinite" }>
  | Readonly<{ code: "invalid_format" }>
  | Readonly<{ code: "nonpositive" }>
  | Readonly<{ code: "excess_precision" }>
  | Readonly<{ code: "out_of_range" }>
  | Readonly<{ code: "line_total_out_of_range" }>;

export type QuantityResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; issue: QuantityValidationIssue }>;

function brandQuantity(milliunits: number): ExpenseQuantity {
  return milliunits as ExpenseQuantity;
}

/**
 * Parse a quantity from its source/wire form.
 *
 * Accepts a string (`"1"`, `"0,5"`, `"0.5"`, `"1,500"`) or a number, normalizing
 * comma and dot decimal separators identically. Rejects empty, nonfinite,
 * zero/negative, over-precision (more than three fractional digits), and
 * out-of-range values. Never rounds: `"0,0001"` is `excess_precision`, not `0`.
 */
export function parseExpenseQuantity(
  value: unknown,
): QuantityResult<ExpenseQuantity> {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { ok: false, issue: { code: "nonfinite" } };
    }
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
    if (text.length === 0) {
      return { ok: false, issue: { code: "required" } };
    }
  } else {
    return { ok: false, issue: { code: "not_number" } };
  }

  // Normalize: optional sign, integer digits, optional comma/dot fractional.
  // Comma and dot are both decimal separators; no thousands separators.
  const match = /^(\d+)(?:[,.](\d+))?$/.exec(text);
  if (!match) {
    return { ok: false, issue: { code: "invalid_format" } };
  }
  const integerPart = match[1];
  const fractionalRaw = match[2] ?? "";
  if (fractionalRaw.length > EXPENSE_QUANTITY_DECIMAL_PLACES) {
    return { ok: false, issue: { code: "excess_precision" } };
  }
  const fractional = fractionalRaw.padEnd(EXPENSE_QUANTITY_DECIMAL_PLACES, "0");
  const milliunits = Number(integerPart) * 1000 + Number(fractional);
  if (!Number.isSafeInteger(milliunits) || milliunits <= 0) {
    return { ok: false, issue: { code: "nonpositive" } };
  }
  if (milliunits > MAX_EXPENSE_QUANTITY_MILLIUNITS) {
    return { ok: false, issue: { code: "out_of_range" } };
  }
  return { ok: true, value: brandQuantity(milliunits) };
}

/**
 * Format a quantity for display using a comma decimal separator, trimming
 * trailing fractional zeros (`1500` -> `"1,5"`, `1000` -> `"1"`, `1501` ->
 * `"1,501"`).
 */
export function formatExpenseQuantity(quantity: ExpenseQuantity): string {
  const milliunits = quantity as number;
  const integerPart = Math.floor(milliunits / 1000);
  const fractional = milliunits - integerPart * 1000;
  if (fractional === 0) {
    return `${integerPart}`;
  }
  let fractionalText = fractional.toString().padStart(3, "0");
  fractionalText = fractionalText.replace(/0+$/, "");
  return `${integerPart},${fractionalText}`;
}

/**
 * Exact line total: `floor((quantity_milliunits * unit_price_cents + 500) /
 * 1000)` in `bigint` (documented round-half-up, matching PostgreSQL positive
 * half-away). Rejects a derived total above `MAX_EXPENSE_CENTS`.
 */
export function computeExpenseLineTotalCents(
  quantity: ExpenseQuantity,
  unitPriceCents: ExpenseCents,
): QuantityResult<ExpenseCents> {
  const quantityBig = BigInt(quantity as number);
  const unitBig = BigInt(unitPriceCents as number);
  const total = (quantityBig * unitBig + HALF_UP_BIAS) / MILLIUNITS_PER_UNIT;
  if (total > MAX_EXPENSE_CENTS_BIG) {
    return { ok: false, issue: { code: "line_total_out_of_range" } };
  }
  return { ok: true, value: brandExpenseCents(Number(total)) };
}
