/**
 * Expense money domain: branded integer cents, basis points, graph revisions,
 * exact bigint arithmetic, deterministic allocators, and allocation bounds.
 *
 * This is the dependency-free core of issue #477. It knows the one product cap
 * (`MAX_EXPENSE_CENTS = 99_999_999`) and the one service-fee formula. It does
 * not know item quantity (issue #578 owns that) nor the persisted participant
 * map / allocation plan (issue #468 owns those); the canonical graph identity
 * types those layers consume live in `./expense-graph`.
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
declare const graphRevisionBrand: unique symbol;

/** Nonnegative integer centavos in `[0, MAX_EXPENSE_CENTS]`. */
export type ExpenseCents = SafeMinorUnitCents & {
  readonly [expenseCentsBrand]: true;
};

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

/** Monotonic expense graph revision in `[0, 2_147_483_647]`. */
export type GraphRevision = number & {
  readonly [graphRevisionBrand]: true;
};

function brandExpenseCents(value: number): ExpenseCents {
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
function brandGraphRevision(value: number): GraphRevision {
  return value as GraphRevision;
}

// ---------------------------------------------------------------------------
// Bounded constants. `ZERO_*` wrap literal zero; `MAX_EXPENSE_CENTS` wraps
// exactly `99_999_999`; both basis-point maxima wrap exactly `10_000`.
// ---------------------------------------------------------------------------

export const ZERO_EXPENSE_CENTS = brandExpenseCents(0);
export const ZERO_SERVICE_FEE_BASIS_POINTS = brandServiceFeeBasisPoints(0);
export const ZERO_ALLOCATION_BASIS_POINTS = brandAllocationBasisPoints(0);
export const ZERO_GRAPH_REVISION = brandGraphRevision(0);

export const MAX_EXPENSE_CENTS = brandExpenseCents(99_999_999);
export const MAX_SERVICE_FEE_BASIS_POINTS = brandServiceFeeBasisPoints(10_000);
export const MAX_ALLOCATION_BASIS_POINTS = brandAllocationBasisPoints(10_000);

/** PostgreSQL `integer` upper bound; `graph_revision` may not exceed it. */
const MAX_GRAPH_REVISION = 2_147_483_647;

export type ZeroExpenseCents = typeof ZERO_EXPENSE_CENTS;
export type ZeroServiceFeeBasisPoints = typeof ZERO_SERVICE_FEE_BASIS_POINTS;
export type ZeroAllocationBasisPoints = typeof ZERO_ALLOCATION_BASIS_POINTS;
export type ZeroGraphRevision = typeof ZERO_GRAPH_REVISION;

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
  | { code: "invalid_graph_revision"; path: readonly (string | number)[] }
  | {
      code: "derived_amount_out_of_range";
      field:
        | "service_fee"
        | "user_share_total"
        | "guest_share_total"
        | "payer_total";
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
  | { code: "payer_total_mismatch" };

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

/** Parse an unknown value as `GraphRevision` in `[0, 2_147_483_647]`. */
export function parseGraphRevision(
  value: unknown,
): ValidationResult<GraphRevision> {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value)
  ) {
    return {
      ok: false,
      issue: { code: "invalid_graph_revision", path: [] },
    };
  }
  if (value < 0 || value > MAX_GRAPH_REVISION) {
    return {
      ok: false,
      issue: { code: "invalid_graph_revision", path: [] },
    };
  }
  return { ok: true, value: brandGraphRevision(value) };
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
export function formatServiceFeeBasisPoints(rate: ServiceFeeBasisPoints): string {
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
 * PostgreSQL's positive half-away result. Rejects a derived fee above the cap.
 */
export function computeServiceFeeCents(
  subtotal: ExpenseCents | number,
  rate: ServiceFeeBasisPoints | number,
): ValidationResult<ExpenseCents> {
  const subtotalBig = BigInt(subtotal as number);
  const rateBig = BigInt(rate as number);
  const fee = (subtotalBig * rateBig + HALF_UP_BIAS) / BASIS_POINTS_DIVISOR;
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
 * nonzero total, and any derived value above the cap. Total zero returns an
 * explicit zero vector for existing consumer identities.
 */
export function allocateByWeights(
  total: ExpenseCents | number,
  weights: readonly (ExpenseCents | number)[],
): ValidationResult<readonly ExpenseCents[]> {
  const entityCount = weights.length;
  if (entityCount === 0) {
    return err({ code: "invalid_allocation_weights", reason: "no_entities" });
  }
  const zeroVector = Object.freeze(
    weights.map(() => ZERO_EXPENSE_CENTS),
  ) as readonly ExpenseCents[];
  if ((total as number) === 0) {
    return { ok: true, value: zeroVector };
  }
  let weightSum = BigInt(0);
  for (const w of weights) {
    weightSum += BigInt(w as number);
  }
  if (weightSum === BigInt(0)) {
    return err({ code: "invalid_allocation_weights", reason: "zero_weight" });
  }
  const totalBig = BigInt(total as number);
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
  const totalBig = BigInt(total as number);
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
