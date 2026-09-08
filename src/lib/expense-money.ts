/**
 * Expense money domain: branded integer cents, basis points, graph revisions,
 * exact bigint arithmetic, deterministic allocators, and allocation bounds.
 *
 * This is the dependency-free core of issue #477. It knows the one product cap
 * (`MAX_EXPENSE_CENTS = 99_999_999`) and the one service-fee formula. It does
 * not know item quantity (issue #578 owns that) nor the persisted participant
 * map / allocation plan (issue #468 owns those).
 *
 * Rules (issue #477 part 2):
 * - Every cent value is a safe integer in minor units, refined from the
 *   domain-neutral `SafeMinorUnitCents` brands in `./currency`.
 * - No `Math.round`, `parseFloat`, unary coercion, or float division on money.
 *   Sums, fee products, and allocations use `bigint` and are range-checked
 *   before conversion back to `number`.
 * - The TypeScript target is ES2017, so `bigint` constants use `BigInt(...)`.
 */

import {
  parseSafeMinorUnitCents,
  parseSignedSafeMinorUnitCents,
  type SafeMinorUnitCents,
  type SignedSafeMinorUnitCents,
} from "./currency";
import {
  computeExpenseLineTotalCents,
  parseExpenseQuantity,
  type ExpenseQuantity,
  type QuantityValidationIssue,
} from "./expense-quantity";

// ---------------------------------------------------------------------------
// Structural limits shared by every raw/canonical source decoder.
// ---------------------------------------------------------------------------

export const MAX_EXPENSE_ITEMS = 100 as const;
export const MAX_EXPENSE_SOURCE_TITLE_CODE_POINTS = 160 as const;
export const MAX_EXPENSE_SOURCE_MERCHANT_NAME_CODE_POINTS = 160 as const;
export const MAX_EXPENSE_SOURCE_ITEM_DESCRIPTION_CODE_POINTS = 240 as const;

// ---------------------------------------------------------------------------
// Brands. The private brand functions are the only assertions in this module;
// parsers call them only after the domain-neutral currency parser and the
// product-specific runtime checks below.
// ---------------------------------------------------------------------------

declare const expenseCentsBrand: unique symbol;
declare const signedExpenseCentsBrand: unique symbol;
declare const serviceFeeBasisPointsBrand: unique symbol;
declare const allocationBasisPointsBrand: unique symbol;

/** Nonnegative integer centavos in `[0, MAX_EXPENSE_CENTS]`. */
export type ExpenseCents = SafeMinorUnitCents & {
  readonly [expenseCentsBrand]: true;
};
export type ParticipantOrderEntry = Readonly<
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestLocalId: string }
>;

export type CanonicalShareRow = Readonly<{
  userId: string;
  shareAmountCents: ExpenseCents;
}>;

export type CanonicalGuestShareRow = Readonly<{
  guestLocalId: string;
  shareAmountCents: ExpenseCents;
}>;

export type CanonicalPayerRow = Readonly<{
  userId: string;
  amountCents: ExpenseCents;
}>;


/** Signed integer centavos in `[-MAX_EXPENSE_CENTS, MAX_EXPENSE_CENTS]`. */
export type SignedExpenseCents = SignedSafeMinorUnitCents & {
  readonly [signedExpenseCentsBrand]: true;
};

/** Integer service-fee rate in `[0, 10_000]` basis points (0.00%–100.00%). */
export type ServiceFeeBasisPoints = number & {
  readonly [serviceFeeBasisPointsBrand]: true;
};

/** Integer allocation percent in `[0, 10_000]` basis points (0.00%–100.00%). */
export type AllocationBasisPoints = number & {
  readonly [allocationBasisPointsBrand]: true;
};


export function brandExpenseCents(value: number): ExpenseCents {
  return value as ExpenseCents;
}
function brandSignedExpenseCents(value: number): SignedExpenseCents {
  return value as SignedExpenseCents;
}
function brandServiceFeeBasisPoints(value: number): ServiceFeeBasisPoints {
  return value as ServiceFeeBasisPoints;
}
function brandAllocationBasisPoints(value: number): AllocationBasisPoints {
  return value as AllocationBasisPoints;
}

// ---------------------------------------------------------------------------
// Bounded constants. `ZERO_*` wrap literal zero; `MAX_EXPENSE_CENTS` wraps
// exactly `99_999_999`; both basis-point maxima wrap exactly `10_000`.
// ---------------------------------------------------------------------------

export const ZERO_EXPENSE_CENTS = brandExpenseCents(0);
export const ZERO_SERVICE_FEE_BASIS_POINTS = brandServiceFeeBasisPoints(0);
export const ZERO_ALLOCATION_BASIS_POINTS = brandAllocationBasisPoints(0);

export const MAX_EXPENSE_CENTS = brandExpenseCents(99_999_999);
export const MAX_SERVICE_FEE_BASIS_POINTS = brandServiceFeeBasisPoints(10_000);
export const MAX_ALLOCATION_BASIS_POINTS = brandAllocationBasisPoints(10_000);


export type ZeroExpenseCents = typeof ZERO_EXPENSE_CENTS;
export type ZeroServiceFeeBasisPoints = typeof ZERO_SERVICE_FEE_BASIS_POINTS;
export type ZeroAllocationBasisPoints = typeof ZERO_ALLOCATION_BASIS_POINTS;

// ---------------------------------------------------------------------------
// Validation results and issues.
// ---------------------------------------------------------------------------

export type ValidationResult<T, E = ExpenseMoneyIssue> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; issue: E }>;

export type ExpenseMoneyIssue =
  | { code: "invalid_cents"; path: readonly (string | number)[] }
  | { code: "amount_out_of_range"; path: readonly (string | number)[] }
  | { code: "invalid_service_fee"; path: readonly (string | number)[] }
  | { code: "invalid_signed_cents"; path: readonly (string | number)[] }
  | {
      code: "derived_amount_out_of_range";
      field:
        | "line_total"
        | "subtotal"
        | "grand_total"
        | "service_fee"
        | "user_share_total"
        | "guest_share_total"
        | "payer_total";
      itemIndex?: number;
    }
  | {
      code: "allocation_exceeds_total";
      kind: "user_shares" | "guest_shares" | "combined_shares" | "payers";
    }
  | {
      code: "invalid_allocation_weights";
      reason: "no_entities" | "zero_weight" | "percentage_total";
    }
  | { code: "share_total_mismatch" }
  | { code: "payer_total_mismatch" }
  | {
      code: "invalid_expense_shape";
      reason: "expense_type" | "single_amount_items";
    }
  | { code: "invalid_item_collection"; reason: "not_array" | "count" }
  | {
      code: "invalid_item_structure";
      itemIndex: number;
      path: readonly (string | number)[];
      reason:
        | "not_object"
        | "missing_key"
        | "unknown_key"
        | "wrong_type"
        | "blank_description"
        | "description_bound";
    }
  | { code: "invalid_quantity"; itemIndex: number; issue: QuantityValidationIssue }
  | {
      code: "invalid_item_cents";
      itemIndex: number;
      field: "unitPriceCents" | "totalPriceCents";
    }
  | { code: "line_total_mismatch"; itemIndex: number }
  | {
      code: "invalid_fee_configuration";
      reason: "single_amount_fee" | "fixed_fee_without_items";
    }
  | {
      code: "itemized_shape_mismatch";
      reason: "nonempty_items_zero_total" | "empty_items_positive_total";
    }
  | { code: "itemized_total_mismatch" }
  | { code: "incomplete_expense" };

export type ZeroPolicy = "allow" | "positive";

export type ExpenseCentsTextFormat =
  | "minor_unit_digits"
  | "brl_decimal"
  | "plain_decimal";

export type ExpenseTextIssue =
  | Readonly<{ code: "required" }>
  | Readonly<{ code: "invalid_format" }>
  | Readonly<{ code: "negative" }>
  | Readonly<{ code: "excess_precision" }>
  | Readonly<{ code: "out_of_range" }>;

export type ExpenseCentsTextOptions = Readonly<{
  format: ExpenseCentsTextFormat;
  zeroPolicy: ZeroPolicy;
  maxCents?: ExpenseCents;
}>;

// ---------------------------------------------------------------------------
// Primitive parsers. Each starts from the domain-neutral currency parser and
// then enforces the product-specific bound.
// ---------------------------------------------------------------------------

/**
 * Parse an unknown value as `ExpenseCents`.
 *
 * `zeroPolicy: "allow"` accepts `[0, MAX_EXPENSE_CENTS]`; `"positive"` accepts
 * `[1, MAX_EXPENSE_CENTS]`. Strings, booleans, objects, `NaN`, infinities,
 * fractions, unsafe integers, negatives, and values above the cap fail.
 */
export function parseExpenseCents(
  value: unknown,
  zeroPolicy: ZeroPolicy,
): ValidationResult<ExpenseCents> {
  const parsed = parseSafeMinorUnitCents(value);
  if (!parsed.ok) {
    return { ok: false, issue: { code: "invalid_cents", path: [] } };
  }
  if (value as number > MAX_EXPENSE_CENTS) {
    return { ok: false, issue: { code: "amount_out_of_range", path: [] } };
  }
  if (zeroPolicy === "positive" && (value as number) === 0) {
    return { ok: false, issue: { code: "amount_out_of_range", path: [] } };
  }
  return { ok: true, value: brandExpenseCents(value as number) };
}

/** Parse an unknown value as `SignedExpenseCents` in `[-MAX, MAX]`. */
export function parseSignedExpenseCents(
  value: unknown,
): ValidationResult<SignedExpenseCents> {
  const parsed = parseSignedSafeMinorUnitCents(value);
  if (!parsed.ok) {
    return { ok: false, issue: { code: "invalid_signed_cents", path: [] } };
  }
  if (Math.abs(value as number) > MAX_EXPENSE_CENTS) {
    return { ok: false, issue: { code: "amount_out_of_range", path: [] } };
  }
  return { ok: true, value: brandSignedExpenseCents(value as number) };
}

/** Parse an unknown value as `ServiceFeeBasisPoints` in `[0, 10_000]`. */
export function parseServiceFeeBasisPoints(
  value: unknown,
): ValidationResult<ServiceFeeBasisPoints> {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_SERVICE_FEE_BASIS_POINTS
  ) {
    return { ok: false, issue: { code: "invalid_service_fee", path: [] } };
  }
  return { ok: true, value: brandServiceFeeBasisPoints(value) };
}

// ---------------------------------------------------------------------------
// Exact text grammars. One exported grammar per format; no `replace(/[^0-9]/g)`,
// `parseFloat`, or rounding.
// ---------------------------------------------------------------------------

const MINOR_UNIT_DIGITS_RE = /^[0-9]+$/;
const BRL_DECIMAL_RE =
  /^(?:R\$ )?(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:\.[0-9]{3})+),[0-9]{2}$/;
// Lenient decimal shape so too-many fractional digits classify as
// `excess_precision` rather than a generic `invalid_format`.
const PLAIN_DECIMAL_RE = /^(?:0|[1-9][0-9]*)(?:[.,][0-9]+)?$/;

function fail<T>(issue: ExpenseTextIssue): ValidationResult<T, ExpenseTextIssue> {
  return { ok: false, issue };
}

/**
 * Parse canonical money text into `ExpenseCents` under the chosen grammar.
 *
 * - `minor_unit_digits`: `^[0-9]+$` interpreted directly as cents.
 * - `brl_decimal`: grouped/ungrouped BRL with exactly two fractional digits.
 * - `plain_decimal`: ungrouped decimal with at most two fractional digits.
 *
 * Empty input is `required` (or zero under `emptyBehavior`-equivalent
 * `zeroPolicy: "allow"` only when the grammar yields zero). Signs, exponent
 * notation, excess fractional digits, mixed separators outside the BRL
 * grammar, surrounding whitespace, and over-max values fail without
 * normalization.
 */
export function parseExpenseCentsText(
  text: string,
  options: ExpenseCentsTextOptions,
): ValidationResult<ExpenseCents, ExpenseTextIssue> {
  if (typeof text !== "string" || text.length === 0) {
    return fail({ code: "required" });
  }
  const max = options.maxCents ?? MAX_EXPENSE_CENTS;
  let cents: number;
  if (options.format === "minor_unit_digits") {
    if (!MINOR_UNIT_DIGITS_RE.test(text)) {
      return fail({ code: "invalid_format" });
    }
    cents = Number(text);
    if (!Number.isSafeInteger(cents)) {
      return fail({ code: "out_of_range" });
    }
  } else if (options.format === "brl_decimal") {
    if (!BRL_DECIMAL_RE.test(text)) {
      return fail({ code: "invalid_format" });
    }
    const [reaisPart, centsPart] = text.replace(/^R\$ /, "").split(",");
    cents = Number(reaisPart.replace(/\./g, "")) * 100 + Number(centsPart);
  } else {
    if (!PLAIN_DECIMAL_RE.test(text)) {
      return fail({ code: "invalid_format" });
    }
    const normalized = text.replace(",", ".");
    const dotIndex = normalized.indexOf(".");
    if (dotIndex === -1) {
      cents = Number(normalized) * 100;
    } else {
      const decimals = normalized.length - dotIndex - 1;
      if (decimals > 2) {
        return fail({ code: "excess_precision" });
      }
      const scaled = decimals === 1 ? `${normalized}0` : normalized;
      cents = Number(scaled.replace(".", ""));
    }
  }
  if (!Number.isSafeInteger(cents) || cents < 0) {
    return fail({ code: "out_of_range" });
  }
  if (cents > max) {
    return fail({ code: "out_of_range" });
  }
  if (options.zeroPolicy === "positive" && cents === 0) {
    return fail({ code: "out_of_range" });
  }
  return { ok: true, value: brandExpenseCents(cents) };
}

/**
 * Parse service-fee percent text into `ServiceFeeBasisPoints`.
 *
 * Uses the ungrouped decimal grammar with at most two fractional digits and
 * the comma/dot separators of the locale contract; converts exactly to basis
 * points (e.g. `10,55` -> 1055) and enforces 0.00%–100.00%.
 */
export function parseServiceFeeBasisPointsText(
  text: string,
): ValidationResult<ServiceFeeBasisPoints, ExpenseTextIssue> {
  if (typeof text !== "string" || text.length === 0) {
    return fail({ code: "required" });
  }
  if (!PLAIN_DECIMAL_RE.test(text)) {
    return fail({ code: "invalid_format" });
  }
  const normalized = text.replace(",", ".");
  const dotIndex = normalized.indexOf(".");
  let basisPoints: number;
  if (dotIndex === -1) {
    basisPoints = Number(normalized) * 100;
  } else {
    const decimals = normalized.length - dotIndex - 1;
    if (decimals > 2) {
      return fail({ code: "excess_precision" });
    }
    const scaled = decimals === 1 ? `${normalized}0` : normalized;
    basisPoints = Number(scaled.replace(".", ""));
  }
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    return fail({ code: "out_of_range" });
  }
  if (basisPoints > MAX_SERVICE_FEE_BASIS_POINTS) {
    return fail({ code: "out_of_range" });
  }
  return { ok: true, value: brandServiceFeeBasisPoints(basisPoints) };
}

/**
 * Parse allocation percent text into `AllocationBasisPoints` in `[0, 10_000]`.
 * Same grammar as the service-fee parser; never uses `parseFloat` or rounding.
 */
export function parseAllocationPercentText(
  text: string,
): ValidationResult<AllocationBasisPoints, ExpenseTextIssue> {
  const parsed = parseServiceFeeBasisPointsText(text);
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, value: brandAllocationBasisPoints(parsed.value as number) };
}

/**
 * Format basis points as a percent string using integer quotient/remainder.
 * `1_055 -> "10,55%"`, `1_000 -> "10%"`, `1 -> "0,01%"`.
 */
export function formatServiceFeeBasisPoints(
  rate: ServiceFeeBasisPoints | number,
): string {
  const rateNum = rate as number;
  const wholePercent = Math.floor(rateNum / 100);
  const remainderBps = rateNum - wholePercent * 100;
  if (remainderBps === 0) {
    return `${wholePercent}%`;
  }
  return `${wholePercent},${remainderBps.toString().padStart(2, "0")}%`;
}

// ---------------------------------------------------------------------------
// Exact bigint arithmetic. Derived results are range-checked before being
// converted back to `number`.
// ---------------------------------------------------------------------------

const MAX_EXPENSE_CENTS_BIG = BigInt(MAX_EXPENSE_CENTS as number);
const BASIS_POINTS_DIVISOR = BigInt(10_000);
const HALF_UP_BIAS = BigInt(5_000);

/**
 * Overflow-checked sum of `ExpenseCents`. Rejects a derived result above
 * `MAX_EXPENSE_CENTS`; never divides or rounds.
 */
export function sumExpenseCents(
  values: readonly ExpenseCents[],
): ValidationResult<ExpenseCents> {
  let acc = BigInt(0);
  for (const v of values) {
    acc += BigInt(v as number);
  }
  if (acc > MAX_EXPENSE_CENTS_BIG) {
    return {
      ok: false,
      issue: { code: "derived_amount_out_of_range", field: "payer_total" },
    };
  }
  return { ok: true, value: brandExpenseCents(Number(acc)) };
}

/**
 * Half-up service fee: `floor((subtotal * bps + 5_000) / 10_000)` in `bigint`.
 * All operands are nonnegative, so this is documented round-half-up and equals
 * PostgreSQL's positive half-away result. Rejects a non-integer, negative,
 * NaN, Infinity, or above-cap subtotal or rate before any arithmetic, and a
 * derived fee above the cap.
 */
export function computeServiceFeeCents(
  subtotal: ExpenseCents | number,
  rate: ServiceFeeBasisPoints | number,
): ValidationResult<ExpenseCents> {
  const subtotalResult = parseExpenseCents(subtotal, "allow");
  if (!subtotalResult.ok) {
    return subtotalResult;
  }
  const rateResult = parseServiceFeeBasisPoints(rate);
  if (!rateResult.ok) {
    return rateResult;
  }
  const fee =
    (BigInt(subtotalResult.value) * BigInt(rateResult.value) + HALF_UP_BIAS) /
    BASIS_POINTS_DIVISOR;
  if (fee > MAX_EXPENSE_CENTS_BIG) {
    return {
      ok: false,
      issue: { code: "derived_amount_out_of_range", field: "service_fee" },
    };
  }
  return { ok: true, value: brandExpenseCents(Number(fee)) };
}

// ---------------------------------------------------------------------------
// Deterministic allocators. Each returns a vector whose exact sum equals the
// input total, computed in `bigint` with largest-remainder distribution and
// participant-order (ascending index) tie-break. No division into cents, no
// per-row rounding, no float.
// ---------------------------------------------------------------------------

function err<T>(issue: ExpenseMoneyIssue): ValidationResult<T> {
  return { ok: false, issue };
}

/**
 * Distribute `total` across `weights` proportionally.
 *
 * `base_i = floor(total * weight_i / sumWeights)` in `bigint`; remaining cents
 * are assigned one each by descending exact remainder, ties broken by ascending
 * index (participant order). Rejects zero entities, zero total weight for a
 * nonzero total, any non-integer, negative, NaN, Infinity, or above-cap total
 * or weight (`invalid_cents`/`amount_out_of_range`), and any derived value
 * above the cap. Total zero returns an explicit zero vector for existing
 * consumer identities.
 */
export function allocateByWeights(
  total: ExpenseCents | number,
  weights: readonly (ExpenseCents | number)[],
): ValidationResult<readonly ExpenseCents[]> {
  const entityCount = weights.length;
  if (entityCount === 0) {
    return err({ code: "invalid_allocation_weights", reason: "no_entities" });
  }
  const totalResult = parseExpenseCents(total, "allow");
  if (!totalResult.ok) {
    return totalResult;
  }
  for (let i = 0; i < weights.length; i++) {
    const weightResult = parseExpenseCents(weights[i], "allow");
    if (!weightResult.ok) {
      return err(
        weightResult.issue.code === "amount_out_of_range"
          ? { code: "amount_out_of_range", path: ["weights", i] }
          : { code: "invalid_cents", path: ["weights", i] },
      );
    }
  }
  const zeroVector = Object.freeze(
    weights.map(() => ZERO_EXPENSE_CENTS),
  ) as readonly ExpenseCents[];
  if (totalResult.value === 0) {
    return { ok: true, value: zeroVector };
  }
  let weightSum = BigInt(0);
  for (const w of weights) {
    weightSum += BigInt(w as number);
  }
  if (weightSum === BigInt(0)) {
    return err({ code: "invalid_allocation_weights", reason: "zero_weight" });
  }
  const totalBig = BigInt(totalResult.value);
  const bases: bigint[] = [];
  const remainders: bigint[] = [];
  let baseSum = BigInt(0);
  for (const w of weights) {
    const product = totalBig * BigInt(w as number);
    const base = product / weightSum;
    bases.push(base);
    remainders.push(product - base * weightSum);
    baseSum += base;
  }
  const toDistribute = Number(totalBig - baseSum);
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  const result: number[] = bases.map((b) => Number(b));
  for (let k = 0; k < toDistribute; k++) {
    result[order[k].index] += 1;
  }
  const branded = result.map((c) => {
    if (c > (MAX_EXPENSE_CENTS as number)) {
      return null;
    }
    return brandExpenseCents(c);
  });
  if (branded.some((c) => c === null)) {
    return err({ code: "amount_out_of_range", path: [] });
  }
  return { ok: true, value: Object.freeze(branded as readonly ExpenseCents[]) };
}

/**
 * Distribute `total` evenly across `count` entities using quotient/remainder
 * in participant order. Equivalent to `allocateByWeights` with equal weights.
 * Rejects a non-integer, negative, NaN, Infinity, or above-cap total, so a
 * truncated negative remainder can never silently drop the exact-sum contract.
 */
export function allocateEvenly(
  total: ExpenseCents | number,
  count: number,
): ValidationResult<readonly ExpenseCents[]> {
  if (!Number.isInteger(count) || count < 0) {
    return err({ code: "invalid_allocation_weights", reason: "no_entities" });
  }
  if (count === 0) {
    if ((total as number) === 0) {
      return { ok: true, value: Object.freeze([] as readonly ExpenseCents[]) };
    }
    return err({ code: "invalid_allocation_weights", reason: "no_entities" });
  }
  const totalResult = parseExpenseCents(total, "allow");
  if (!totalResult.ok) {
    return totalResult;
  }
  const totalBig = BigInt(totalResult.value);
  const base = totalBig / BigInt(count);
  const remainder = Number(totalBig - base * BigInt(count));
  const result: ExpenseCents[] = [];
  for (let i = 0; i < count; i++) {
    result.push(brandExpenseCents(Number(base) + (i < remainder ? 1 : 0)));
  }
  return { ok: true, value: Object.freeze(result) };
}

/**
 * Distribute `total` across basis-point weights (percentage mode). Requires
 * the weights to sum exactly `MAX_ALLOCATION_BASIS_POINTS` (100.00%); under or
 * over is `invalid_allocation_weights/percentage_total` and is never normalized.
 */
export function allocateByBasisPoints(
  total: ExpenseCents | number,
  weights: readonly (AllocationBasisPoints | number)[],
): ValidationResult<readonly ExpenseCents[]> {
  if (weights.length === 0) {
    return err({ code: "invalid_allocation_weights", reason: "no_entities" });
  }
  let sum = 0;
  for (const w of weights) {
    sum += w as number;
  }
  if (sum !== (MAX_ALLOCATION_BASIS_POINTS as number)) {
    return err({
      code: "invalid_allocation_weights",
      reason: "percentage_total",
    });
  }
  const asCents = weights.map((w) => brandExpenseCents(w as number));
  return allocateByWeights(total, asCents);
}

// ---------------------------------------------------------------------------
// Allocation bounds. Drafts may be incomplete but never overallocated;
// activation requires exact share and payer sums.
// ---------------------------------------------------------------------------

export type AllocationBoundsInput = Readonly<{
  totalAmountCents: ExpenseCents;
  userShareCents: readonly ExpenseCents[];
  guestShareCents: readonly ExpenseCents[];
  payerCents: readonly ExpenseCents[];
}>;

function bigSum(values: readonly ExpenseCents[]): bigint {
  let acc = BigInt(0);
  for (const v of values) {
    acc += BigInt(v as number);
  }
  return acc;
}

/**
 * Draft allocation bounds. Shares and payers may be incomplete, but every
 * supplied cent is individually valid and neither partial sum may exceed the
 * canonical expense total: `0 <= sum(user + guest shares) <= total` and
 * `0 <= sum(payers) <= total`. Reports user/guest shares over total before
 * combined overallocation before payer overallocation.
 */
export function validateDraftAllocationBounds(
  input: AllocationBoundsInput,
): ValidationResult<true> {
  const totalBig = BigInt(input.totalAmountCents as number);
  const userBig = bigSum(input.userShareCents);
  const guestBig = bigSum(input.guestShareCents);
  const payerBig = bigSum(input.payerCents);
  if (userBig > totalBig) {
    return err({ code: "allocation_exceeds_total", kind: "user_shares" });
  }
  if (guestBig > totalBig) {
    return err({ code: "allocation_exceeds_total", kind: "guest_shares" });
  }
  if (userBig + guestBig > totalBig) {
    return err({ code: "allocation_exceeds_total", kind: "combined_shares" });
  }
  if (payerBig > totalBig) {
    return err({ code: "allocation_exceeds_total", kind: "payers" });
  }
  return { ok: true, value: true };
}

/**
 * Activation allocation totals. User shares plus guest shares must equal the
 * total exactly, and the registered-user payer sum must equal the total
 * exactly. Equality is cent-exact; no one-cent tolerance.
 */
export function validateActivationAllocationTotals(
  input: AllocationBoundsInput,
): ValidationResult<true> {
  const totalBig = BigInt(input.totalAmountCents as number);
  const userBig = bigSum(input.userShareCents);
  const guestBig = bigSum(input.guestShareCents);
  const payerBig = bigSum(input.payerCents);
  if (userBig + guestBig !== totalBig) {
    return err({ code: "share_total_mismatch" });
  }
  if (payerBig !== totalBig) {
    return err({ code: "payer_total_mismatch" });
  }
  return { ok: true, value: true };
}

// ---------------------------------------------------------------------------
// Issue #477 part 3: canonical expense-money value types and the
// mode-narrowed `validateExpenseMoney` validator. Structural decode happens
// before any arithmetic; every line total is delegated to
// `computeExpenseLineTotalCents`, every fee to `computeServiceFeeCents`, and
// every sum to `sumExpenseCents`. No `Math.round`/`parseFloat`/float division;
// equality is cent-exact with no tolerance.
// ---------------------------------------------------------------------------

/** One reconciled itemized line. All cent fields are positive. */
export type NormalizedExpenseItem = Readonly<{
  description: string;
  quantity: ExpenseQuantity;
  unitPriceCents: ExpenseCents;
  totalPriceCents: ExpenseCents;
}>;

/** Reconciled money summary. `totalAmountCents` is the exact grand total. */
export type ExpenseMoneySummary = Readonly<{
  itemsSubtotalCents: ExpenseCents;
  serviceFeeCents: ExpenseCents;
  fixedFeesCents: ExpenseCents;
  totalAmountCents: ExpenseCents;
}>;

/** Structural fields shared by every parsed expense. */
export type ExpenseMoneyBase = Readonly<{
  expenseType: "single_amount" | "itemized";
  serviceFeeBasisPoints: ServiceFeeBasisPoints;
  fixedFeesCents: ExpenseCents;
  items: readonly NormalizedExpenseItem[];
}>;

/** A fully reconciled expense with a positive grand total and summary. */
export type CompleteExpenseMoney = ExpenseMoneyBase &
  Readonly<{
    outcome: "complete";
    totalAmountCents: ExpenseCents;
    summary: ExpenseMoneySummary;
  }>;

/** Shared "no amount, no items, no fixed fee" branch for the empty outcomes. */
type ExpenseMoneyEmptyBranch =
  | Readonly<{
      expenseType: "single_amount";
      serviceFeeBasisPoints: ZeroServiceFeeBasisPoints;
    }>
  | Readonly<{
      expenseType: "itemized";
      serviceFeeBasisPoints: ServiceFeeBasisPoints;
    }>;

/**
 * Source parse where no amount was mentioned: zero total, no items, no fixed
 * fee. Only `source_parse` may yield this; an itemized edit-only value may
 * retain a nonzero service-fee rate (it has no monetary effect until items
 * exist).
 */
export type EditOnlyParsedExpenseMoney = Readonly<{
  outcome: "edit_only_amount_incomplete";
  sourceTotalAmountCents: ZeroExpenseCents;
  fixedFeesCents: ZeroExpenseCents;
  items: readonly [];
}> &
  ExpenseMoneyEmptyBranch;

/**
 * Persistable empty draft: zero total, no items, no fixed fee. A valid
 * service-fee rate may be retained on an itemized draft (no monetary effect).
 */
export type EmptyPersistableDraftMoney = Readonly<{
  outcome: "empty_draft";
  totalAmountCents: ZeroExpenseCents;
  fixedFeesCents: ZeroExpenseCents;
  items: readonly [];
}> &
  ExpenseMoneyEmptyBranch;

/** What `source_parse` may return: a complete expense or an edit-only stub. */
export type UntrustedParsedExpenseMoney =
  | CompleteExpenseMoney
  | EditOnlyParsedExpenseMoney;

/** What `draft` may return: a complete expense or an empty draft. */
export type PersistableDraftExpenseMoney =
  | CompleteExpenseMoney
  | EmptyPersistableDraftMoney;

/** Untrusted input envelope; every field is `unknown` until decoded. */
export type ExpenseMoneyInput = Readonly<{
  expenseType: unknown;
  totalAmountCents: unknown;
  serviceFeeBasisPoints: unknown;
  fixedFeesCents: unknown;
  items: unknown;
}>;

/** Validation mode; controls which outcomes are acceptable. */
export type ExpenseMoneyMode =
  | "source_parse"
  | "scan_review"
  | "draft";

const REQUIRED_ITEM_KEYS = [
  "description",
  "quantity",
  "unitPriceCents",
  "totalPriceCents",
] as const;

/**
 * Count Unicode code points without allocating a spread. A high surrogate
 * paired with a following code unit is one code point; a lone surrogate is one.
 */
function countCodePoints(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; ) {
    const unit = text.charCodeAt(i);
    const paired = unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length;
    i += paired ? 2 : 1;
    count += 1;
  }
  return count;
}

/** Recursively freeze a parsed value (root, summary, items array, each item). */
function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  Object.freeze(value);
  if (Array.isArray(value)) {
    const arr = value as readonly unknown[];
    for (let i = 0; i < arr.length; i += 1) {
      deepFreeze(arr[i]);
    }
  } else {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      deepFreeze(obj[key]);
    }
  }
}

/**
 * Decode one itemized line: exact key set, nonblank bounded description, valid
 * quantity, positive unit/total cents, and an exact line total delegated to
 * `computeExpenseLineTotalCents`. Returns the first structural or arithmetic
 * defect as an `ExpenseMoneyIssue`.
 */
function decodeItem(
  raw: unknown,
  itemIndex: number,
): ValidationResult<NormalizedExpenseItem> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return err({
      code: "invalid_item_structure",
      itemIndex,
      path: [],
      reason: "not_object",
    });
  }
  const obj = raw as Record<string, unknown>;
  for (const key of REQUIRED_ITEM_KEYS) {
    if (!(key in obj)) {
      return err({
        code: "invalid_item_structure",
        itemIndex,
        path: [key],
        reason: "missing_key",
      });
    }
  }
  for (const key of Object.keys(obj)) {
    if (!(REQUIRED_ITEM_KEYS as readonly string[]).includes(key)) {
      return err({
        code: "invalid_item_structure",
        itemIndex,
        path: [key],
        reason: "unknown_key",
      });
    }
  }

  const description = obj.description;
  if (typeof description !== "string") {
    return err({
      code: "invalid_item_structure",
      itemIndex,
      path: ["description"],
      reason: "wrong_type",
    });
  }
  if (description.trim().length === 0) {
    return err({
      code: "invalid_item_structure",
      itemIndex,
      path: ["description"],
      reason: "blank_description",
    });
  }
  if (countCodePoints(description) > MAX_EXPENSE_SOURCE_ITEM_DESCRIPTION_CODE_POINTS) {
    return err({
      code: "invalid_item_structure",
      itemIndex,
      path: ["description"],
      reason: "description_bound",
    });
  }

  const quantityResult = parseExpenseQuantity(obj.quantity);
  if (!quantityResult.ok) {
    return err({ code: "invalid_quantity", itemIndex, issue: quantityResult.issue });
  }

  const unitResult = parseExpenseCents(obj.unitPriceCents, "positive");
  if (!unitResult.ok) {
    return err({ code: "invalid_item_cents", itemIndex, field: "unitPriceCents" });
  }

  const totalResult = parseExpenseCents(obj.totalPriceCents, "positive");
  if (!totalResult.ok) {
    return err({ code: "invalid_item_cents", itemIndex, field: "totalPriceCents" });
  }

  const lineTotal = computeExpenseLineTotalCents(
    quantityResult.value,
    unitResult.value,
  );
  if (!lineTotal.ok) {
    return err({
      code: "derived_amount_out_of_range",
      field: "line_total",
      itemIndex,
    });
  }
  if (lineTotal.value !== totalResult.value) {
    return err({ code: "line_total_mismatch", itemIndex });
  }

  return {
    ok: true,
    value: {
      description,
      quantity: quantityResult.value,
      unitPriceCents: unitResult.value,
      totalPriceCents: totalResult.value,
    },
  };
}

/** Internal decoded shape: a reconciled complete expense or an empty stub. */
type DecodedExpenseMoney =
  | Readonly<{ kind: "complete"; value: CompleteExpenseMoney }>
  | Readonly<{ kind: "empty"; empty: ExpenseMoneyEmptyBranch }>;

/**
 * Decode `input` independent of mode: structural fields first, then per-variant
 * arithmetic. Returns a complete expense, an empty stub (total 0, no items, no
 * fixed fee), or the first defect. The caller (`validateExpenseMoney`) maps the
 * empty stub to the mode-specific outcome.
 */
function decodeExpenseMoney(
  input: ExpenseMoneyInput,
): ValidationResult<DecodedExpenseMoney> {
  if (input.expenseType !== "single_amount" && input.expenseType !== "itemized") {
    return err({ code: "invalid_expense_shape", reason: "expense_type" });
  }
  const expenseType = input.expenseType;

  const bpsResult = parseServiceFeeBasisPoints(input.serviceFeeBasisPoints);
  if (!bpsResult.ok) {
    return err({ code: "invalid_service_fee", path: ["serviceFeeBasisPoints"] });
  }

  const fixedResult = parseExpenseCents(input.fixedFeesCents, "allow");
  if (!fixedResult.ok) {
    return err({ code: "invalid_cents", path: ["fixedFeesCents"] });
  }
  const fixedFeesCents = fixedResult.value;

  const totalResult = parseExpenseCents(input.totalAmountCents, "allow");
  if (!totalResult.ok) {
    return err({ code: "invalid_cents", path: ["totalAmountCents"] });
  }
  const totalAmountCents = totalResult.value;

  if (!Array.isArray(input.items)) {
    return err({ code: "invalid_item_collection", reason: "not_array" });
  }
  if (input.items.length > MAX_EXPENSE_ITEMS) {
    return err({ code: "invalid_item_collection", reason: "count" });
  }
  const rawItems = input.items;

  if (expenseType === "single_amount") {
    // A single amount carries no items and no fees; the total is the whole
    // expense. Items win as the dominant shape defect, then any fee configured.
    if (rawItems.length !== 0) {
      return err({ code: "invalid_expense_shape", reason: "single_amount_items" });
    }
    if (bpsResult.value !== ZERO_SERVICE_FEE_BASIS_POINTS || fixedFeesCents !== ZERO_EXPENSE_CENTS) {
      return err({ code: "invalid_fee_configuration", reason: "single_amount_fee" });
    }
    if (totalAmountCents === ZERO_EXPENSE_CENTS) {
      return {
        ok: true,
        value: {
          kind: "empty",
          empty: {
            expenseType: "single_amount",
            serviceFeeBasisPoints: ZERO_SERVICE_FEE_BASIS_POINTS,
          },
        },
      };
    }
    const value: CompleteExpenseMoney = {
      outcome: "complete",
      expenseType: "single_amount",
      serviceFeeBasisPoints: bpsResult.value,
      fixedFeesCents: ZERO_EXPENSE_CENTS,
      items: [],
      totalAmountCents,
      summary: {
        itemsSubtotalCents: totalAmountCents,
        serviceFeeCents: ZERO_EXPENSE_CENTS,
        fixedFeesCents: ZERO_EXPENSE_CENTS,
        totalAmountCents,
      },
    };
    deepFreeze(value);
    return { ok: true, value: { kind: "complete", value } };
  }

  // itemized
  if (rawItems.length === 0) {
    if (totalAmountCents !== ZERO_EXPENSE_CENTS) {
      return err({
        code: "itemized_shape_mismatch",
        reason: "empty_items_positive_total",
      });
    }
    if (fixedFeesCents !== ZERO_EXPENSE_CENTS) {
      return err({
        code: "invalid_fee_configuration",
        reason: "fixed_fee_without_items",
      });
    }
    return {
      ok: true,
      value: {
        kind: "empty",
        empty: { expenseType: "itemized", serviceFeeBasisPoints: bpsResult.value },
      },
    };
  }

  const decodedItems: NormalizedExpenseItem[] = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const itemResult = decodeItem(rawItems[i], i);
    if (!itemResult.ok) {
      return itemResult;
    }
    decodedItems.push(itemResult.value);
  }

  // Nonempty itemized lines require a positive supplied total.
  if (totalAmountCents === ZERO_EXPENSE_CENTS) {
    return err({
      code: "itemized_shape_mismatch",
      reason: "nonempty_items_zero_total",
    });
  }

  const subtotalResult = sumExpenseCents(
    decodedItems.map((it) => it.totalPriceCents),
  );
  if (!subtotalResult.ok) {
    return err({ code: "derived_amount_out_of_range", field: "subtotal" });
  }
  const subtotal = subtotalResult.value;

  const feeResult = computeServiceFeeCents(subtotal, bpsResult.value);
  if (!feeResult.ok) {
    return feeResult;
  }
  const serviceFee = feeResult.value;

  const grandResult = sumExpenseCents([subtotal, serviceFee, fixedFeesCents]);
  if (!grandResult.ok) {
    return err({ code: "derived_amount_out_of_range", field: "grand_total" });
  }
  const grandTotal = grandResult.value;

  if (totalAmountCents !== grandTotal) {
    return err({ code: "itemized_total_mismatch" });
  }

  const value: CompleteExpenseMoney = {
    outcome: "complete",
    expenseType: "itemized",
    serviceFeeBasisPoints: bpsResult.value,
    fixedFeesCents,
    items: decodedItems,
    totalAmountCents: grandTotal,
    summary: {
      itemsSubtotalCents: subtotal,
      serviceFeeCents: serviceFee,
      fixedFeesCents,
      totalAmountCents: grandTotal,
    },
  };
  deepFreeze(value);
  return { ok: true, value: { kind: "complete", value } };
}

/**
 * Validate untrusted expense money for a given mode. Structural decode first,
 * then cent-exact arithmetic; success yields a new recursively frozen value.
 *
 * Mode exit contracts:
 * - `source_parse` → complete expense or the edit-only "amount not mentioned" stub.
 * - `scan_review` → complete expense only (empty/zero/missing total is a hard error).
 * - `draft` → complete expense or an empty draft.
 * - `activation` / `chat_confirmation` → complete positive expense only.
 */
export function validateExpenseMoney(
  input: ExpenseMoneyInput,
  mode: "source_parse",
): ValidationResult<UntrustedParsedExpenseMoney>;
export function validateExpenseMoney(
  input: ExpenseMoneyInput,
  mode: "scan_review",
): ValidationResult<CompleteExpenseMoney>;
export function validateExpenseMoney(
  input: ExpenseMoneyInput,
  mode: "draft",
): ValidationResult<PersistableDraftExpenseMoney>;
// Catch-all overload: a union-typed mode yields the broad union so callers
// iterating modes typecheck. Literal modes still hit the narrower overloads.
export function validateExpenseMoney(
  input: ExpenseMoneyInput,
  mode: ExpenseMoneyMode,
): ValidationResult<
  CompleteExpenseMoney | EditOnlyParsedExpenseMoney | EmptyPersistableDraftMoney
>;
export function validateExpenseMoney(
  input: ExpenseMoneyInput,
  mode: ExpenseMoneyMode,
): ValidationResult<
  CompleteExpenseMoney | EditOnlyParsedExpenseMoney | EmptyPersistableDraftMoney
> {
  const decoded = decodeExpenseMoney(input);
  if (!decoded.ok) {
    return decoded;
  }
  const result = decoded.value;
  if (result.kind === "complete") {
    return { ok: true, value: result.value };
  }

  const empty = result.empty;
  if (mode === "source_parse") {
    const value: EditOnlyParsedExpenseMoney = {
      ...empty,
      outcome: "edit_only_amount_incomplete",
      sourceTotalAmountCents: ZERO_EXPENSE_CENTS,
      fixedFeesCents: ZERO_EXPENSE_CENTS,
      items: [],
    };
    deepFreeze(value);
    return { ok: true, value };
  }
  if (mode === "draft") {
    const value: EmptyPersistableDraftMoney = {
      ...empty,
      outcome: "empty_draft",
      totalAmountCents: ZERO_EXPENSE_CENTS,
      fixedFeesCents: ZERO_EXPENSE_CENTS,
      items: [],
    };
    deepFreeze(value);
    return { ok: true, value };
  }
  // scan_review rejects an empty/zero expense.
  return err({ code: "incomplete_expense" });
}

// ---------------------------------------------------------------------------
// Issue #477 part 4: canonical allocation summary. Validates participant
// identity/order against the share, guest-share, and payer rows; computes
// overflow-proof cent-exact share/payer totals, signed deltas, exact/
// underallocated/overallocated states, completeness, and the aggregate_only /
// detailed item-assignment breakdown. Every sum is bigint; no float, no
// tolerance, equality is cent-exact.
// ---------------------------------------------------------------------------

/**
 * One item-level assignment of an expense item to a consumer participant.
 * `amountCents` is the portion of that item's `totalPriceCents` consumed.
 */
export type CanonicalItemAssignment = Readonly<{
  itemId: string;
  participant: ParticipantOrderEntry;
  amountCents: ExpenseCents;
}>;

/** Per-person breakdown of item subtotal, fees, and grand total. */
export type PerPersonExpenseBreakdown = Readonly<{
  participant: ParticipantOrderEntry;
  itemSubtotalCents: ExpenseCents;
  serviceFeeCents: ExpenseCents;
  fixedFeesCents: ExpenseCents;
  totalAmountCents: ExpenseCents;
}>;

/**
 * Item-assignment envelope. `aggregate_only` defers to the authoritative share
 * rows (a rehydrated graph); `detailed` supplies per-item consumer assignments
 * that must reconcile to each identity's share row.
 */
export type ExpenseItemAssignmentInput =
  | Readonly<{ kind: "aggregate_only" }>
  | Readonly<{
      kind: "detailed";
      itemIds: readonly string[];
      rows: readonly CanonicalItemAssignment[];
    }>;

/**
 * Allocation-summary issue. Extends the money issue set with allocation
 * identity/order defects, detailed item-assignment defects, the per-person
 * share reconciliation failure, and the #495 payer-reachability failure.
 */
export type ExpenseAllocationIssue =
  | ExpenseMoneyIssue
  | Readonly<{
      code: "invalid_allocation_identity";
      path: readonly (string | number)[];
      reason: "participant_order" | "share" | "guest_share" | "payer";
    }>
  | Readonly<{
      code: "invalid_item_assignment";
      path: readonly (string | number)[];
      reason:
        | "item_ids"
        | "unknown_item"
        | "participant_identity"
        | "duplicate_pair"
        | "nonpositive_amount"
        | "item_overallocated";
    }>
  | Readonly<{ code: "item_assignment_share_mismatch"; participantIndex: number }>
  | Readonly<{ code: "ineligible_payer"; payerIndex: number }>
  | Readonly<{ code: "duplicate_payer"; payerIndex: number }>;

/** Recursively immutable canonical allocation summary. */
export type ExpenseAllocationSummary = Readonly<{
  participantOrder: readonly ParticipantOrderEntry[];
  shareRows: readonly CanonicalShareRow[];
  guestShareRows: readonly CanonicalGuestShareRow[];
  payerRows: readonly CanonicalPayerRow[];
  userShareTotalCents: ExpenseCents;
  guestShareTotalCents: ExpenseCents;
  shareTotalCents: ExpenseCents;
  payerTotalCents: ExpenseCents;
  shareDeltaCents: SignedExpenseCents;
  payerDeltaCents: SignedExpenseCents;
  shareState: "exact" | "underallocated" | "overallocated";
  payerState: "exact" | "underallocated" | "overallocated";
  completeness: "complete" | "incomplete" | "invalid";
  itemAssignmentState:
    | Readonly<{ kind: "aggregate_only" }>
    | Readonly<{
        kind: "detailed";
        rows: readonly PerPersonExpenseBreakdown[];
        unassignedItemCents: ExpenseCents;
      }>;
}>;

const MAX_SAFE_CENTS_BIG = BigInt(Number.MAX_SAFE_INTEGER);

/** Fail with an allocation issue, narrowed to the summary result type. */
function allocationIssue(
  issue: ExpenseAllocationIssue,
): ValidationResult<ExpenseAllocationSummary, ExpenseAllocationIssue> {
  return { ok: false, issue };
}

/**
 * Validate and clean one participant-order entry: exact key set, nonempty id,
 * known kind. Returns the cleaned entry or `null` for any structural defect
 * (unknown kind/keys, empty id, non-object).
 */
function validateParticipantOrderEntry(
  entry: unknown,
): ParticipantOrderEntry | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const obj = entry as Record<string, unknown>;
  const kind = obj.kind;
  if (kind === "user") {
    const keys = Object.keys(obj);
 const userId = obj.userId;
    if (keys.length !== 2 || typeof userId !== "string" || userId.length === 0) {
      return null;
    }
    return { kind: "user", userId };
  }
  if (kind === "guest") {
    const keys = Object.keys(obj);
 const guestLocalId = obj.guestLocalId;
    if (
      keys.length !== 2 ||
      typeof guestLocalId !== "string" ||
      guestLocalId.length === 0
    ) {
      return null;
    }
    return { kind: "guest", guestLocalId };
  }
  return null;
}

/** Stable identity key for a participant, or `null` if the shape is malformed. */
function participantKeyOf(entry: unknown): string | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const obj = entry as Record<string, unknown>;
  const kind = obj.kind;
  if (kind === "user") {
    const userId = obj.userId;
    if (typeof userId !== "string" || userId.length === 0) return null;
    return "user:" + userId;
  }
  if (kind === "guest") {
    const guestLocalId = obj.guestLocalId;
    if (typeof guestLocalId !== "string" || guestLocalId.length === 0) return null;
    return "guest:" + guestLocalId;
  }
  return null;
}

/** Structural copy of a participant entry so freezing never touches input. */
function copyParticipant(entry: ParticipantOrderEntry): ParticipantOrderEntry {
  return entry.kind === "user"
    ? { kind: "user", userId: entry.userId }
    : { kind: "guest", guestLocalId: entry.guestLocalId };
}

/**
 * Summarize a canonical expense allocation. Pure, overflow-proof, cent-exact.
 *
 * Phase 1 validates the participant order and the share/guest-share/payer
 * bijection (each user participant has exactly one share row and vice versa;
 * each entity-backed guest has exactly one guest share; each payer is one
 * distinct registered user with a share row). Phase 2 computes the share/payer
 * totals,
 * signed deltas, and exact/under/over states in `bigint`. Phase 3 builds the
 * item-assignment state — `aggregate_only` echoes the authoritative shares;
 * `detailed` reconciles per-item consumer assignments, distributes the single
 * service fee by consumption weights and the fixed fee evenly across reviewed
 * consumer identities, and requires each per-person total to equal that
 * identity's authoritative share row.
 */
export function summarizeExpenseAllocations(
  input: Readonly<{
    money: PersistableDraftExpenseMoney;
    participantOrder: readonly ParticipantOrderEntry[];
    shares: readonly CanonicalShareRow[];
    guestShares: readonly CanonicalGuestShareRow[];
    payers: readonly CanonicalPayerRow[];
    itemAssignments: ExpenseItemAssignmentInput;
  }>,
): ValidationResult<ExpenseAllocationSummary, ExpenseAllocationIssue> {
  // -- Phase 1: participant order identity & determinism --------------------
  const participantIndexByKey = new Map<string, number>();
  const userParticipantIds: string[] = [];
  const guestParticipantIds: string[] = [];
  const userParticipantIndex = new Map<string, number>();
  const guestParticipantIndex = new Map<string, number>();

  for (let i = 0; i < input.participantOrder.length; i += 1) {
    const entry = validateParticipantOrderEntry(input.participantOrder[i]);
    if (entry === null) {
      return allocationIssue({
        code: "invalid_allocation_identity",
        path: ["participantOrder", i],
        reason: "participant_order",
      });
    }
    const key =
      entry.kind === "user" ? "user:" + entry.userId : "guest:" + entry.guestLocalId;
    if (participantIndexByKey.has(key)) {
      return allocationIssue({
        code: "invalid_allocation_identity",
        path: ["participantOrder", i],
        reason: "participant_order",
      });
    }
    participantIndexByKey.set(key, i);
    if (entry.kind === "user") {
      userParticipantIds.push(entry.userId);
      userParticipantIndex.set(entry.userId, i);
    } else {
      guestParticipantIds.push(entry.guestLocalId);
      guestParticipantIndex.set(entry.guestLocalId, i);
    }
  }

  // -- Phase 1b: user share bijection (zero rows are identity-bearing) ------
  const userShareAmounts: ExpenseCents[] = new Array(userParticipantIds.length);
  {
    const seen = new Map<string, CanonicalShareRow>();
    for (let i = 0; i < input.shares.length; i += 1) {
      const userId = input.shares[i].userId;
      if (!userParticipantIndex.has(userId) || seen.has(userId)) {
        return allocationIssue({
          code: "invalid_allocation_identity",
          path: ["shares", i],
          reason: "share",
        });
      }
      seen.set(userId, input.shares[i]);
    }
    for (let p = 0; p < userParticipantIds.length; p += 1) {
      const userId = userParticipantIds[p];
      const row = seen.get(userId);
      if (row === undefined) {
        return allocationIssue({
          code: "invalid_allocation_identity",
          path: ["participantOrder", userParticipantIndex.get(userId) as number],
          reason: "share",
        });
      }
      userShareAmounts[p] = row.shareAmountCents;
    }
  }

  // -- Phase 1c: guest share bijection -------------------------------------
  const guestShareAmounts: ExpenseCents[] = new Array(
    guestParticipantIds.length,
  );
  {
    const seen = new Map<string, CanonicalGuestShareRow>();
    for (let i = 0; i < input.guestShares.length; i += 1) {
      const guestLocalId = input.guestShares[i].guestLocalId;
      if (!guestParticipantIndex.has(guestLocalId) || seen.has(guestLocalId)) {
        return allocationIssue({
          code: "invalid_allocation_identity",
          path: ["guestShares", i],
          reason: "guest_share",
        });
      }
      seen.set(guestLocalId, input.guestShares[i]);
    }
    for (let p = 0; p < guestParticipantIds.length; p += 1) {
      const guestLocalId = guestParticipantIds[p];
      const row = seen.get(guestLocalId);
      if (row === undefined) {
        return allocationIssue({
          code: "invalid_allocation_identity",
          path: [
            "participantOrder",
            guestParticipantIndex.get(guestLocalId) as number,
          ],
          reason: "guest_share",
        });
      }
      guestShareAmounts[p] = row.shareAmountCents;
    }
  }

  // -- Phase 1d: payer reachability and uniqueness (#495) ------------------
  const seenPayerUserIds = new Set<string>();
  for (let i = 0; i < input.payers.length; i += 1) {
    const userId = input.payers[i].userId;
    if (typeof userId !== "string" || userId.length === 0) {
      return allocationIssue({
        code: "invalid_allocation_identity",
        path: ["payers", i],
        reason: "payer",
      });
    }
    if (!userParticipantIndex.has(userId)) {
      return allocationIssue({ code: "ineligible_payer", payerIndex: i });
    }
    if (seenPayerUserIds.has(userId)) {
      return allocationIssue({ code: "duplicate_payer", payerIndex: i });
    }
    seenPayerUserIds.add(userId);
  }

  // -- Phase 2: overflow-checked bigint totals & states --------------------
  const userShareBig = bigSum(userShareAmounts);
  const guestShareBig = bigSum(guestShareAmounts);
  const payerBig = bigSum(input.payers.map((row) => row.amountCents));

  if (userShareBig > MAX_SAFE_CENTS_BIG) {
    return allocationIssue({
      code: "derived_amount_out_of_range",
      field: "user_share_total",
    });
  }
  if (guestShareBig > MAX_SAFE_CENTS_BIG) {
    return allocationIssue({
      code: "derived_amount_out_of_range",
      field: "guest_share_total",
    });
  }
  const shareBig = userShareBig + guestShareBig;
  if (shareBig > MAX_SAFE_CENTS_BIG) {
    return allocationIssue({
      code: "derived_amount_out_of_range",
      field: "user_share_total",
    });
  }
  if (payerBig > MAX_SAFE_CENTS_BIG) {
    return allocationIssue({
      code: "derived_amount_out_of_range",
      field: "payer_total",
    });
  }

  const totalBig = BigInt(input.money.totalAmountCents as number);
  const shareDeltaBig = shareBig - totalBig;
  const payerDeltaBig = payerBig - totalBig;

  const shareState: ExpenseAllocationSummary["shareState"] =
    shareBig === totalBig
      ? "exact"
      : shareBig < totalBig
        ? "underallocated"
        : "overallocated";
  const payerState: ExpenseAllocationSummary["payerState"] =
    payerBig === totalBig
      ? "exact"
      : payerBig < totalBig
        ? "underallocated"
        : "overallocated";

  // -- Phase 3: item-assignment state & completeness -----------------------
  const money = input.money;
  const isCompleteMoney = money.outcome === "complete";
  const moneyItems: readonly NormalizedExpenseItem[] = money.items;
  const serviceFeeCents: ExpenseCents = isCompleteMoney
    ? money.summary.serviceFeeCents
    : ZERO_EXPENSE_CENTS;
  const fixedFeesCents: ExpenseCents = money.fixedFeesCents;

  // Authoritative share per participant-order slot (for detailed reconciliation).
  const authoritativeShareByOrder: ExpenseCents[] = new Array(
    input.participantOrder.length,
  );
  let nextUserSlot = 0;
  let nextGuestSlot = 0;
  for (let p = 0; p < input.participantOrder.length; p += 1) {
    if (input.participantOrder[p].kind === "user") {
      authoritativeShareByOrder[p] = userShareAmounts[nextUserSlot];
      nextUserSlot += 1;
    } else {
      authoritativeShareByOrder[p] = guestShareAmounts[nextGuestSlot];
      nextGuestSlot += 1;
    }
  }

  let itemAssignmentState: ExpenseAllocationSummary["itemAssignmentState"];
  // `true` for aggregate_only (no per-item residual to check); detailed sets it.
  let detailedUnassignedIsZero = true;

  if (input.itemAssignments.kind === "aggregate_only") {
    itemAssignmentState = { kind: "aggregate_only" };
  } else {
    const ia = input.itemAssignments;
    const itemIds = ia.itemIds;

    // itemIds: exactly one nonempty unique id per money.items entry, in order.
    // single_amount has items []; detailed itemIds must be empty there.
    if (itemIds.length !== moneyItems.length) {
      return allocationIssue({
        code: "invalid_item_assignment",
        path: ["itemAssignments", "itemIds"],
        reason: "item_ids",
      });
    }
    const itemIdSet = new Set<string>();
    const itemIdToItemIndex = new Map<string, number>();
    for (let idx = 0; idx < itemIds.length; idx += 1) {
      const id = itemIds[idx];
      if (typeof id !== "string" || id.length === 0 || itemIdSet.has(id)) {
        return allocationIssue({
          code: "invalid_item_assignment",
          path: ["itemAssignments", "itemIds", idx],
          reason: "item_ids",
        });
      }
      itemIdSet.add(id);
      itemIdToItemIndex.set(id, idx);
    }

    const pairSeen = new Set<string>();
    const perItemAssigned: bigint[] = itemIds.map(() => BigInt(0));
    const perParticipantSubtotal: bigint[] = input.participantOrder.map(
      () => BigInt(0),
    );

    for (let r = 0; r < ia.rows.length; r += 1) {
      const rowObj = ia.rows[r] as Record<string, unknown>;
      const itemId = rowObj.itemId;
      if (typeof itemId !== "string" || itemId.length === 0 || !itemIdSet.has(itemId)) {
        return allocationIssue({
          code: "invalid_item_assignment",
          path: ["itemAssignments", "rows", r],
          reason: "unknown_item",
        });
      }
      const pKey = participantKeyOf(ia.rows[r].participant);
      if (pKey === null || !participantIndexByKey.has(pKey)) {
        return allocationIssue({
          code: "invalid_item_assignment",
          path: ["itemAssignments", "rows", r],
          reason: "participant_identity",
        });
      }
      const pairKey = itemId + "|" + pKey;
      if (pairSeen.has(pairKey)) {
        return allocationIssue({
          code: "invalid_item_assignment",
          path: ["itemAssignments", "rows", r],
          reason: "duplicate_pair",
        });
      }
      pairSeen.add(pairKey);
      const amount = ia.rows[r].amountCents;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        return allocationIssue({
          code: "invalid_item_assignment",
          path: ["itemAssignments", "rows", r],
          reason: "nonpositive_amount",
        });
      }
      perItemAssigned[itemIdToItemIndex.get(itemId) as number] += BigInt(amount);
      perParticipantSubtotal[participantIndexByKey.get(pKey) as number] += BigInt(amount);
    }

    // Per-item overallocation (checked before any residual so a one-cent
    // per-item excess hidden by another line's slack is still caught).
    let unassignedBig = BigInt(0);
    for (let idx = 0; idx < moneyItems.length; idx += 1) {
      const itemTotal = BigInt(moneyItems[idx].totalPriceCents as number);
      const assigned = perItemAssigned[idx];
      if (assigned > itemTotal) {
        return allocationIssue({
          code: "invalid_item_assignment",
          path: ["items", idx],
          reason: "item_overallocated",
        });
      }
      unassignedBig += itemTotal - assigned;
    }
    if (unassignedBig > MAX_SAFE_CENTS_BIG) {
      return allocationIssue({
        code: "derived_amount_out_of_range",
        field: "subtotal",
      });
    }
    const unassignedItemCents = brandExpenseCents(Number(unassignedBig));
    detailedUnassignedIsZero = unassignedItemCents === ZERO_EXPENSE_CENTS;

    // Distribute the single service fee by item-consumption weights, and the
    // fixed fee evenly, across the reviewed consumer identities (the whole
    // participant order: user-share + guest-share identities, zero-share
    // consumers included; there are no payer-only identities since every payer
    // is a registered user with a share row).
    const consumerCount = input.participantOrder.length;
    const consumptionWeights = perParticipantSubtotal.map((b) =>
      brandExpenseCents(Number(b)),
    );

    let serviceFeePerConsumer: readonly ExpenseCents[];
    if (serviceFeeCents === ZERO_EXPENSE_CENTS) {
      serviceFeePerConsumer = input.participantOrder.map(() => ZERO_EXPENSE_CENTS);
    } else {
      let totalConsumption = BigInt(0);
      for (const c of perParticipantSubtotal) totalConsumption += c;
      if (totalConsumption === BigInt(0)) {
        serviceFeePerConsumer = input.participantOrder.map(
          () => ZERO_EXPENSE_CENTS,
        );
      } else {
        const alloc = allocateByWeights(serviceFeeCents, consumptionWeights);
        if (!alloc.ok) {
          return allocationIssue(alloc.issue);
        }
        serviceFeePerConsumer = alloc.value;
      }
    }

    let fixedFeePerConsumer: readonly ExpenseCents[];
    if (fixedFeesCents === ZERO_EXPENSE_CENTS) {
      fixedFeePerConsumer = input.participantOrder.map(() => ZERO_EXPENSE_CENTS);
    } else {
      const alloc = allocateEvenly(fixedFeesCents, consumerCount);
      if (!alloc.ok) {
        return allocationIssue(alloc.issue);
      }
      fixedFeePerConsumer = alloc.value;
    }

    const breakdowns: PerPersonExpenseBreakdown[] = [];
    for (let p = 0; p < input.participantOrder.length; p += 1) {
      const participant = input.participantOrder[p];
      const itemSubtotalCents = brandExpenseCents(
        Number(perParticipantSubtotal[p]),
      );
      const serviceFee = serviceFeePerConsumer[p];
      const fixedFee = fixedFeePerConsumer[p];
      const personTotalBig =
        BigInt(itemSubtotalCents as number) +
        BigInt(serviceFee as number) +
        BigInt(fixedFee as number);
      if (personTotalBig > MAX_SAFE_CENTS_BIG) {
        return allocationIssue({
          code: "derived_amount_out_of_range",
          field: "grand_total",
        });
      }
      const totalAmountCents = brandExpenseCents(Number(personTotalBig));
      if (totalAmountCents !== authoritativeShareByOrder[p]) {
        return allocationIssue({
          code: "item_assignment_share_mismatch",
          participantIndex: p,
        });
      }
      breakdowns.push({
        participant: copyParticipant(participant),
        itemSubtotalCents,
        serviceFeeCents: serviceFee,
        fixedFeesCents: fixedFee,
        totalAmountCents,
      });
    }

    itemAssignmentState = {
      kind: "detailed",
      rows: breakdowns,
      unassignedItemCents,
    };
  }

  let completeness: ExpenseAllocationSummary["completeness"];
  if (shareState === "overallocated" || payerState === "overallocated") {
    completeness = "invalid";
  } else if (
    isCompleteMoney &&
    shareState === "exact" &&
    payerState === "exact" &&
    detailedUnassignedIsZero
  ) {
    completeness = "complete";
  } else {
    completeness = "incomplete";
  }

  const summary: ExpenseAllocationSummary = {
    participantOrder: input.participantOrder.map(copyParticipant),
    shareRows: input.shares.map((s) => ({
      userId: s.userId,
      shareAmountCents: s.shareAmountCents,
    })),
    guestShareRows: input.guestShares.map((g) => ({
      guestLocalId: g.guestLocalId,
      shareAmountCents: g.shareAmountCents,
    })),
    payerRows: input.payers.map((py) => ({
      userId: py.userId,
      amountCents: py.amountCents,
    })),
    userShareTotalCents: brandExpenseCents(Number(userShareBig)),
    guestShareTotalCents: brandExpenseCents(Number(guestShareBig)),
    shareTotalCents: brandExpenseCents(Number(shareBig)),
    payerTotalCents: brandExpenseCents(Number(payerBig)),
    shareDeltaCents: brandSignedExpenseCents(Number(shareDeltaBig)),
    payerDeltaCents: brandSignedExpenseCents(Number(payerDeltaBig)),
    shareState,
    payerState,
    completeness,
    itemAssignmentState,
  };
  deepFreeze(summary);
  return { ok: true, value: summary };
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Issue #477 part 2 / #476: source decoders. `decodeExpenseResult` is the
// sole unknown-root entrypoint for a chat/voice/OCR/SEFAZ provider result.
// This slice implements the "chat" source; "voice"/"ocr"/"sefaz" are added
// in their own follow-up slices, so the exported signature is chat-only for
// now and TypeScript rejects any other source at the call site.
// ---------------------------------------------------------------------------

export type ExpenseSource = "chat" | "voice" | "ocr" | "sefaz";

export type ExpenseSourceMemberContext = Readonly<{
  handle: string;
  name: string;
}>;

/**
 * Known conversation members for a source parse. Reserved for this decoder's
 * signature parity with the full #477 contract; handle resolution against
 * real DM members is #476's adapter's job (`buildChatExpenseConfirmationRequest`),
 * not this structural decoder's — the decoder only proves the wire shape.
 */
export type ExpenseSourceDecodeContext = Readonly<{
  members: readonly ExpenseSourceMemberContext[];
}>;

export type ExpenseDecodeIssue =
  | ExpenseMoneyIssue
  | Readonly<{
      code: "invalid_structure";
      source: ExpenseSource;
      path: readonly (string | number)[];
      reason: "missing_key" | "unknown_key" | "wrong_type" | "null" | "array_bound";
    }>
  | Readonly<{
      code: "invalid_source_contract";
      source: ExpenseSource;
      reason:
        | "mode"
        | "metadata"
        | "expense_type"
        | "fee_fields"
        | "fee_evidence"
        | "participant"
        | "payer"
        | "allocations";
    }>;

export type SourceParticipantMatch = Readonly<{
  spokenName: string;
  matchedHandle: string | null;
  confidence: "high" | "medium" | "low";
}>;

/** One participant's exact custom-split share, keyed by handle ("SELF" for the sender). */
export type CanonicalChatAllocation = Readonly<{
  participantHandle: string;
  shareAmountCents: ExpenseCents;
}>;

export type DecodedChatExpense<M extends UntrustedParsedExpenseMoney> =
  Readonly<{
    source: "chat";
    title: string;
    merchantName: string | null;
    participants: readonly SourceParticipantMatch[];
    payerHandle: string | null;
    confidence: "high" | "medium" | "low";
    money: M;
  }> &
    (
      | Readonly<{ splitType: "equal"; allocations: readonly [] }>
      | Readonly<{
          splitType: "custom";
          allocations:
            | readonly []
            | readonly [CanonicalChatAllocation, CanonicalChatAllocation];
        }>
    );

export type ModelContractIssue = Readonly<{
  code: "MODEL_CONTRACT_INVALID";
  category: "structure" | "money" | "item" | "fee";
  path: readonly (string | number)[];
}>;

function structureIssue(
  source: ExpenseSource,
  path: readonly (string | number)[],
  reason: "missing_key" | "unknown_key" | "wrong_type" | "null" | "array_bound",
): ExpenseDecodeIssue {
  return { code: "invalid_structure", source, path, reason };
}

function contractIssue(
  source: ExpenseSource,
  reason:
    | "mode"
    | "metadata"
    | "expense_type"
    | "fee_fields"
    | "fee_evidence"
    | "participant"
    | "payer"
    | "allocations",
): ExpenseDecodeIssue {
  return { code: "invalid_source_contract", source, reason };
}

/**
 * Maps every closed `ExpenseDecodeIssue` code to one `ModelContractIssue`
 * category. Exhaustive: adding an issue code without extending this switch
 * fails TypeScript (`checkNever` below), by design (issue #477 part 2).
 */
export function toModelContractIssue(issue: ExpenseDecodeIssue): ModelContractIssue {
  const path = "path" in issue ? issue.path : [];
  switch (issue.code) {
    case "invalid_structure":
      return { code: "MODEL_CONTRACT_INVALID", category: "structure", path };
    case "invalid_source_contract":
      return {
        code: "MODEL_CONTRACT_INVALID",
        category: issue.reason === "fee_fields" || issue.reason === "fee_evidence" ? "fee" : "structure",
        path: [],
      };
    case "invalid_item_collection":
    case "invalid_item_structure":
    case "invalid_quantity":
    case "invalid_item_cents":
    case "line_total_mismatch":
    case "itemized_shape_mismatch":
    case "invalid_expense_shape":
      return { code: "MODEL_CONTRACT_INVALID", category: "item", path };
    case "invalid_service_fee":
    case "invalid_fee_configuration":
      return { code: "MODEL_CONTRACT_INVALID", category: "fee", path };
    case "derived_amount_out_of_range":
      return {
        code: "MODEL_CONTRACT_INVALID",
        category: issue.field === "service_fee" ? "fee" : issue.field === "line_total" ? "item" : "money",
        path,
      };
    case "invalid_cents":
    case "amount_out_of_range":
    case "invalid_signed_cents":
    case "allocation_exceeds_total":
    case "invalid_allocation_weights":
    case "share_total_mismatch":
    case "payer_total_mismatch":
    case "itemized_total_mismatch":
    case "incomplete_expense":
      return { code: "MODEL_CONTRACT_INVALID", category: "money", path };
    default: {
      const checkNever: never = issue;
      throw new Error(`unreachable expense decode issue: ${JSON.stringify(checkNever)}`);
    }
  }
}

const CHAT_ROOT_KEYS = [
  "title",
  "amountCents",
  "expenseType",
  "splitType",
  "items",
  "participants",
  "payerHandle",
  "merchantName",
  "confidence",
  "allocations",
] as const;
const SOURCE_ITEM_KEYS = ["description", "quantity", "unitPriceCents", "totalCents"] as const;
const PARTICIPANT_KEYS = ["spokenName", "matchedHandle", "confidence"] as const;
const ALLOCATION_KEYS = ["participantHandle", "shareAmountCents"] as const;

function decodeSourceConfidence(value: unknown): "high" | "medium" | "low" | null {
  return value === "high" || value === "medium" || value === "low" ? value : null;
}

function decodeSourceParticipants(
  raw: unknown,
  source: ExpenseSource,
): ValidationResult<SourceParticipantMatch[], ExpenseDecodeIssue> {
  if (!Array.isArray(raw)) {
    return { ok: false, issue: structureIssue(source, ["participants"], "wrong_type") };
  }
  const out: SourceParticipantMatch[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i];
    if (!isStringRecord(row)) {
      return { ok: false, issue: structureIssue(source, ["participants", i], "wrong_type") };
    }
    const keys = Object.keys(row);
    if (keys.length !== PARTICIPANT_KEYS.length || !PARTICIPANT_KEYS.every((k) => k in row)) {
      return {
        ok: false,
        issue: structureIssue(
          source,
          ["participants", i],
          keys.length > PARTICIPANT_KEYS.length ? "unknown_key" : "missing_key",
        ),
      };
    }
    const spokenName = row.spokenName;
    if (typeof spokenName !== "string" || spokenName.length === 0) {
      return { ok: false, issue: contractIssue(source, "participant") };
    }
    const matchedHandle = row.matchedHandle;
    if (matchedHandle !== null && (typeof matchedHandle !== "string" || matchedHandle.length === 0)) {
      return { ok: false, issue: contractIssue(source, "participant") };
    }
    const confidence = decodeSourceConfidence(row.confidence);
    if (confidence === null) {
      return { ok: false, issue: contractIssue(source, "participant") };
    }
    out.push({ spokenName, matchedHandle, confidence });
  }
  return { ok: true, value: out };
}

/**
 * Decode the raw `allocations` array. Per #476: `equal` requires a present
 * empty array (else `invalid_source_contract/allocations`). `custom` never
 * rejects — any missing/non-array/wrong-cardinality/malformed-row array
 * collapses to the edit-only empty sentinel `[]`, and only an exactly-two
 * structurally-valid-row array survives as branded allocations.
 */
function decodeChatAllocations(
  rawAllocations: unknown,
  splitType: "equal" | "custom",
): ValidationResult<
  readonly [] | readonly [CanonicalChatAllocation, CanonicalChatAllocation],
  ExpenseDecodeIssue
> {
  if (splitType === "equal") {
    if (!Array.isArray(rawAllocations) || rawAllocations.length !== 0) {
      return { ok: false, issue: contractIssue("chat", "allocations") };
    }
    return { ok: true, value: [] };
  }
  if (!Array.isArray(rawAllocations) || rawAllocations.length !== 2) {
    return { ok: true, value: [] };
  }
  const rows: CanonicalChatAllocation[] = [];
  for (const row of rawAllocations) {
    if (!isStringRecord(row)) return { ok: true, value: [] };
    const keys = Object.keys(row);
    if (keys.length !== ALLOCATION_KEYS.length || !ALLOCATION_KEYS.every((k) => k in row)) {
      return { ok: true, value: [] };
    }
    const handle = row.participantHandle;
    if (typeof handle !== "string" || handle.length === 0) return { ok: true, value: [] };
    const centsResult = parseExpenseCents(row.shareAmountCents, "allow");
    if (!centsResult.ok) return { ok: true, value: [] };
    rows.push({ participantHandle: handle, shareAmountCents: centsResult.value });
  }
  return { ok: true, value: [rows[0], rows[1]] as const };
}

/** Chat/voice source result types and the shared `decodeExpenseResult` entrypoint. */
export type DecodedVoiceExpense<M extends UntrustedParsedExpenseMoney> =
  Readonly<{
    source: "voice";
    title: string;
    merchantName: string | null;
    participants: readonly SourceParticipantMatch[];
    money: M;
  }>;

const VOICE_ROOT_KEYS = [
  "title",
  "amountCents",
  "expenseType",
  "items",
  "participants",
  "merchantName",
] as const;

function decodeChatExpenseResult(
  raw: unknown,
): ValidationResult<DecodedChatExpense<UntrustedParsedExpenseMoney>, ExpenseDecodeIssue> {
  if (!isStringRecord(raw)) {
    return { ok: false, issue: structureIssue("chat", [], "null") };
  }
  const rootKeys = Object.keys(raw);
  for (const key of CHAT_ROOT_KEYS) {
    if (!(key in raw)) {
      return { ok: false, issue: structureIssue("chat", [key], "missing_key") };
    }
  }
  if (rootKeys.length !== CHAT_ROOT_KEYS.length) {
    return { ok: false, issue: structureIssue("chat", [], "unknown_key") };
  }

  const titleRaw = raw.title;
  if (typeof titleRaw !== "string" || titleRaw.trim().length === 0) {
    return { ok: false, issue: contractIssue("chat", "metadata") };
  }
  const title = titleRaw.trim();
  if (countCodePoints(title) > MAX_EXPENSE_SOURCE_TITLE_CODE_POINTS) {
    return { ok: false, issue: contractIssue("chat", "metadata") };
  }

  const merchantNameRaw = raw.merchantName;
  if (merchantNameRaw !== null) {
    if (typeof merchantNameRaw !== "string" || merchantNameRaw.trim().length === 0) {
      return { ok: false, issue: contractIssue("chat", "metadata") };
    }
    if (countCodePoints(merchantNameRaw) > MAX_EXPENSE_SOURCE_MERCHANT_NAME_CODE_POINTS) {
      return { ok: false, issue: contractIssue("chat", "metadata") };
    }
  }
  const merchantName: string | null = merchantNameRaw;

  const confidence = decodeSourceConfidence(raw.confidence);
  if (confidence === null) {
    return { ok: false, issue: contractIssue("chat", "metadata") };
  }

  const payerHandleRaw = raw.payerHandle;
  if (payerHandleRaw !== null && (typeof payerHandleRaw !== "string" || payerHandleRaw.length === 0)) {
    return { ok: false, issue: contractIssue("chat", "payer") };
  }
  const payerHandle: string | null = payerHandleRaw;

  const expenseType = raw.expenseType;
  if (expenseType !== "single_amount" && expenseType !== "itemized") {
    return { ok: false, issue: contractIssue("chat", "expense_type") };
  }

  const splitType = raw.splitType;
  if (splitType !== "equal" && splitType !== "custom") {
    return { ok: false, issue: contractIssue("chat", "allocations") };
  }

  if (!Array.isArray(raw.items)) {
    return { ok: false, issue: structureIssue("chat", ["items"], "wrong_type") };
  }
  const canonicalItems: unknown[] = [];
  for (let i = 0; i < raw.items.length; i += 1) {
    const item = raw.items[i];
    if (!isStringRecord(item)) {
      return { ok: false, issue: structureIssue("chat", ["items", i], "wrong_type") };
    }
    const itemKeys = Object.keys(item);
    if (itemKeys.length !== SOURCE_ITEM_KEYS.length || !SOURCE_ITEM_KEYS.every((k) => k in item)) {
      return {
        ok: false,
        issue: structureIssue(
          "chat",
          ["items", i],
          itemKeys.length > SOURCE_ITEM_KEYS.length ? "unknown_key" : "missing_key",
        ),
      };
    }
    canonicalItems.push({
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalCents,
    });
  }

  const participantsResult = decodeSourceParticipants(raw.participants, "chat");
  if (!participantsResult.ok) return participantsResult;

  const allocationsResult = decodeChatAllocations(raw.allocations, splitType);
  if (!allocationsResult.ok) return allocationsResult;

  const moneyInput: ExpenseMoneyInput = {
    expenseType,
    totalAmountCents: raw.amountCents,
    serviceFeeBasisPoints: ZERO_SERVICE_FEE_BASIS_POINTS,
    fixedFeesCents: ZERO_EXPENSE_CENTS,
    items: canonicalItems,
  };
  const moneyResult = validateExpenseMoney(moneyInput, "source_parse");
  if (!moneyResult.ok) {
    return { ok: false, issue: moneyResult.issue };
  }

  const base = {
    source: "chat" as const,
    title,
    merchantName,
    participants: participantsResult.value,
    payerHandle,
    confidence,
    money: moneyResult.value,
  };
  const result: DecodedChatExpense<UntrustedParsedExpenseMoney> =
    splitType === "equal"
      ? { ...base, splitType: "equal", allocations: [] }
      : { ...base, splitType: "custom", allocations: allocationsResult.value };
  deepFreeze(result);
  return { ok: true, value: result };
}

/**
 * Decode a raw voice provider result. Same #578/#477 delegation as chat, but
 * voice has no confidence, payer, or split fields - it exposes no confirm/
 * store callback for a low-confidence or ambiguous result at all.
 */
function decodeVoiceExpenseResult(
  raw: unknown,
): ValidationResult<DecodedVoiceExpense<UntrustedParsedExpenseMoney>, ExpenseDecodeIssue> {
  if (!isStringRecord(raw)) {
    return { ok: false, issue: structureIssue("voice", [], "null") };
  }
  const rootKeys = Object.keys(raw);
  for (const key of VOICE_ROOT_KEYS) {
    if (!(key in raw)) {
      return { ok: false, issue: structureIssue("voice", [key], "missing_key") };
    }
  }
  if (rootKeys.length !== VOICE_ROOT_KEYS.length) {
    return { ok: false, issue: structureIssue("voice", [], "unknown_key") };
  }

  const titleRaw = raw.title;
  if (typeof titleRaw !== "string" || titleRaw.trim().length === 0) {
    return { ok: false, issue: contractIssue("voice", "metadata") };
  }
  const title = titleRaw.trim();
  if (countCodePoints(title) > MAX_EXPENSE_SOURCE_TITLE_CODE_POINTS) {
    return { ok: false, issue: contractIssue("voice", "metadata") };
  }

  const merchantNameRaw = raw.merchantName;
  if (merchantNameRaw !== null) {
    if (typeof merchantNameRaw !== "string" || merchantNameRaw.trim().length === 0) {
      return { ok: false, issue: contractIssue("voice", "metadata") };
    }
    if (countCodePoints(merchantNameRaw) > MAX_EXPENSE_SOURCE_MERCHANT_NAME_CODE_POINTS) {
      return { ok: false, issue: contractIssue("voice", "metadata") };
    }
  }
  const merchantName: string | null = merchantNameRaw;

  const expenseType = raw.expenseType;
  if (expenseType !== "single_amount" && expenseType !== "itemized") {
    return { ok: false, issue: contractIssue("voice", "expense_type") };
  }

  if (!Array.isArray(raw.items)) {
    return { ok: false, issue: structureIssue("voice", ["items"], "wrong_type") };
  }
  const canonicalItems: unknown[] = [];
  for (let i = 0; i < raw.items.length; i += 1) {
    const item = raw.items[i];
    if (!isStringRecord(item)) {
      return { ok: false, issue: structureIssue("voice", ["items", i], "wrong_type") };
    }
    const itemKeys = Object.keys(item);
    if (itemKeys.length !== SOURCE_ITEM_KEYS.length || !SOURCE_ITEM_KEYS.every((k) => k in item)) {
      return {
        ok: false,
        issue: structureIssue(
          "voice",
          ["items", i],
          itemKeys.length > SOURCE_ITEM_KEYS.length ? "unknown_key" : "missing_key",
        ),
      };
    }
    canonicalItems.push({
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalCents,
    });
  }

  const participantsResult = decodeSourceParticipants(raw.participants, "voice");
  if (!participantsResult.ok) return participantsResult;

  const moneyInput: ExpenseMoneyInput = {
    expenseType,
    totalAmountCents: raw.amountCents,
    serviceFeeBasisPoints: ZERO_SERVICE_FEE_BASIS_POINTS,
    fixedFeesCents: ZERO_EXPENSE_CENTS,
    items: canonicalItems,
  };
  const moneyResult = validateExpenseMoney(moneyInput, "source_parse");
  if (!moneyResult.ok) {
    return { ok: false, issue: moneyResult.issue };
  }

  const result: DecodedVoiceExpense<UntrustedParsedExpenseMoney> = {
    source: "voice",
    title,
    merchantName,
    participants: participantsResult.value,
    money: moneyResult.value,
  };
  deepFreeze(result);
  return { ok: true, value: result };
}

/**
 * Decoded OCR/SEFAZ receipt-scan result. Unlike chat/voice, a receipt may
 * carry a real service fee/fixed fee (Brazilian "taxa de serviço"), so its
 * money is validated in `scan_review` mode: `CompleteExpenseMoney`, never the
 * `source_parse` edit-only shape. An incomplete/zero/unreconciled receipt is
 * rejected here and never reaches `ScannedItemsReview` (issue #477).
 */
export type DecodedReceiptExpense<
  Source extends "ocr" | "sefaz",
  M extends CompleteExpenseMoney = CompleteExpenseMoney,
> = Readonly<{
  source: Source;
  merchantName: string | null;
  money: M;
}>;

const RECEIPT_ROOT_KEYS = [
  "merchantName",
  "expenseType",
  "totalAmountCents",
  "serviceFeeBasisPoints",
  "fixedFeesCents",
  "items",
] as const;

/**
 * Decode a raw OCR/SEFAZ receipt-scan result. Structural mirror of the
 * chat/voice decoders (exact root/item keys, #578 quantity, #477 cent/line
 * arithmetic delegated to `validateExpenseMoney`), but items and fees are
 * `scan_review`-complete: the upstream extractor (`receipt-ocr.ts`/
 * `nfce.ts`) must never call this with a fabricated/derived/defaulted
 * quantity, unit price, line total, fee percentage, or root total (#477
 * part 1 "SEFAZ/OCR extraction" rules) - this decoder only proves the wire
 * shape and the exact arithmetic reconciliation, exactly like #468's
 * canonical graph validator does for the persisted graph.
 */
function decodeReceiptExpenseResult(
  source: "ocr" | "sefaz",
  raw: unknown,
): ValidationResult<DecodedReceiptExpense<"ocr" | "sefaz">, ExpenseDecodeIssue> {
  if (!isStringRecord(raw)) {
    return { ok: false, issue: structureIssue(source, [], "null") };
  }
  const rootKeys = Object.keys(raw);
  for (const key of RECEIPT_ROOT_KEYS) {
    if (!(key in raw)) {
      return { ok: false, issue: structureIssue(source, [key], "missing_key") };
    }
  }
  if (rootKeys.length !== RECEIPT_ROOT_KEYS.length) {
    return { ok: false, issue: structureIssue(source, [], "unknown_key") };
  }

  const merchantNameRaw = raw.merchantName;
  if (merchantNameRaw !== null) {
    if (typeof merchantNameRaw !== "string" || merchantNameRaw.trim().length === 0) {
      return { ok: false, issue: contractIssue(source, "metadata") };
    }
    if (countCodePoints(merchantNameRaw) > MAX_EXPENSE_SOURCE_MERCHANT_NAME_CODE_POINTS) {
      return { ok: false, issue: contractIssue(source, "metadata") };
    }
  }
  const merchantName: string | null = merchantNameRaw;

  const expenseType = raw.expenseType;
  if (expenseType !== "single_amount" && expenseType !== "itemized") {
    return { ok: false, issue: contractIssue(source, "expense_type") };
  }

  if (!Array.isArray(raw.items)) {
    return { ok: false, issue: structureIssue(source, ["items"], "wrong_type") };
  }
  const canonicalItems: unknown[] = [];
  for (let i = 0; i < raw.items.length; i += 1) {
    const item = raw.items[i];
    if (!isStringRecord(item)) {
      return { ok: false, issue: structureIssue(source, ["items", i], "wrong_type") };
    }
    const itemKeys = Object.keys(item);
    if (itemKeys.length !== SOURCE_ITEM_KEYS.length || !SOURCE_ITEM_KEYS.every((k) => k in item)) {
      return {
        ok: false,
        issue: structureIssue(
          source,
          ["items", i],
          itemKeys.length > SOURCE_ITEM_KEYS.length ? "unknown_key" : "missing_key",
        ),
      };
    }
    canonicalItems.push({
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalCents,
    });
  }

  const moneyInput: ExpenseMoneyInput = {
    expenseType,
    totalAmountCents: raw.totalAmountCents,
    serviceFeeBasisPoints: raw.serviceFeeBasisPoints,
    fixedFeesCents: raw.fixedFeesCents,
    items: canonicalItems,
  };
  const moneyResult = validateExpenseMoney(moneyInput, "scan_review");
  if (!moneyResult.ok) {
    return { ok: false, issue: moneyResult.issue };
  }

  const result: DecodedReceiptExpense<"ocr" | "sefaz"> = {
    source,
    merchantName,
    money: moneyResult.value,
  };
  deepFreeze(result);
  return { ok: true, value: result };
}

/**
 * Decode a raw chat, voice, or OCR/SEFAZ receipt-scan provider result. Chat/
 * voice have no fee fields and validate money in `source_parse` (edit-only,
 * tolerates an incomplete/zero result); OCR/SEFAZ carry a real service/fixed
 * fee and validate money in `scan_review` (rejects any incomplete/zero/
 * unreconciled result outright - issue #477 "an invalid or incomplete
 * receipt never mounts ScannedItemsReview"). Exact root/item (/participant/
 * allocation, for chat) keys, #578 quantity, and #477 cent/line arithmetic
 * are delegated to `validateExpenseMoney`. Never repairs a defect - #476's
 * malformed-custom-allocation-collapses-to-`[]` rule is the sole documented
 * exception, and it never rejects otherwise-valid base money for it.
 */
export function decodeExpenseResult(
  source: "chat",
  mode: "source_parse",
  raw: unknown,
  context: ExpenseSourceDecodeContext,
): ValidationResult<DecodedChatExpense<UntrustedParsedExpenseMoney>, ExpenseDecodeIssue>;
export function decodeExpenseResult(
  source: "voice",
  mode: "source_parse",
  raw: unknown,
  context: ExpenseSourceDecodeContext,
): ValidationResult<DecodedVoiceExpense<UntrustedParsedExpenseMoney>, ExpenseDecodeIssue>;
export function decodeExpenseResult(
  source: "ocr" | "sefaz",
  mode: "scan_review",
  raw: unknown,
): ValidationResult<DecodedReceiptExpense<"ocr" | "sefaz">, ExpenseDecodeIssue>;
export function decodeExpenseResult(
  source: ExpenseSource,
  mode: "source_parse" | "scan_review",
  raw: unknown,
  context?: ExpenseSourceDecodeContext,
):
  | ValidationResult<DecodedChatExpense<UntrustedParsedExpenseMoney>, ExpenseDecodeIssue>
  | ValidationResult<DecodedVoiceExpense<UntrustedParsedExpenseMoney>, ExpenseDecodeIssue>
  | ValidationResult<DecodedReceiptExpense<"ocr" | "sefaz">, ExpenseDecodeIssue> {
  void context;
  if (source === "chat") return decodeChatExpenseResult(raw);
  if (source === "voice") return decodeVoiceExpenseResult(raw);
  return decodeReceiptExpenseResult(source, raw);
}
