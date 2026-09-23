import { ROOM_TICKS_PER_MILLIUNIT } from "@/lib/assignment-room-money";
import {
  formatExpenseQuantity,
  type ExpenseQuantity,
} from "@/lib/expense-quantity";

/**
 * Human-readable room quantities.
 *
 * Claims are stored as integer ticks so that a third of an item is exact:
 * 120 ticks per milliunit means one whole item is 120_000 ticks and every
 * common fraction divides it without a remainder. Decimal text cannot express
 * those values — a third would print as `0,333` and stop adding up — so a
 * quantity that is not a clean decimal is shown as the reduced fraction it
 * actually is.
 */

/** Ticks in one whole item. */
const TICKS_PER_UNIT = 1_000 * ROOM_TICKS_PER_MILLIUNIT;

/** Denominators that read as fractions rather than as an odd ratio. */
const FAMILIAR_DENOMINATORS = new Set([2, 3, 4, 5, 6, 8, 10]);

export type ClaimOptions =
  | {
      kind: "whole";
      options: Array<{ label: string; ticks: number }>;
      total: number;
    }
  | { kind: "stepper"; maxUnits: number; total: number }
  | {
      kind: "fractions";
      options: Array<{ label: string; ticks: number }>;
    };

function assertRoomQuantity(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`invalid ${name}: ${value}`);
  }
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

/**
 * Format claim ticks as a quantity of items: `"1"`, `"1,5"`, `"1/3"`,
 * `"2/3"`. Rejects values that cannot come from a decoded room, because a
 * negative or fractional tick count is a bug to surface rather than a number
 * to round away.
 */
export function formatRoomTicks(ticks: number): string {
  if (!Number.isSafeInteger(ticks) || ticks < 0) {
    throw new RangeError(`invalid claim ticks: ${ticks}`);
  }
  if (ticks === 0) return "0";
  if (ticks % TICKS_PER_UNIT === 0) {
    return String(ticks / TICKS_PER_UNIT);
  }

  const divisor = greatestCommonDivisor(ticks, TICKS_PER_UNIT);
  const numerator = ticks / divisor;
  const denominator = TICKS_PER_UNIT / divisor;
  // Below one item a fraction is what people say out loud: "metade", "um
  // terço". Above it "1,5" reads better than "3/2".
  if (ticks < TICKS_PER_UNIT && FAMILIAR_DENOMINATORS.has(denominator)) {
    return `${numerator}/${denominator}`;
  }
  if (ticks % ROOM_TICKS_PER_MILLIUNIT === 0) {
    const milliunits = (ticks / ROOM_TICKS_PER_MILLIUNIT) as ExpenseQuantity;
    return formatExpenseQuantity(milliunits);
  }
  return `${numerator}/${denominator}`;
}

/**
 * Build the finite set of quantities offered by the claim sheet.
 *
 * `maxTicks` is the largest absolute claim the selected participant may make:
 * their saved ticks plus the line's currently unclaimed ticks.
 */
export function claimOptionsFor(
  quantityMilliunits: number,
  maxTicks: number,
): ClaimOptions {
  assertRoomQuantity(quantityMilliunits, "quantity milliunits");
  assertRoomQuantity(maxTicks, "maximum claim ticks");

  const capacityTicks = quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT;
  if (!Number.isSafeInteger(capacityTicks)) {
    throw new RangeError(`invalid quantity milliunits: ${quantityMilliunits}`);
  }
  const availableTicks = Math.min(maxTicks, capacityTicks);

  if (quantityMilliunits >= 2_000) {
    const total = quantityMilliunits / 1_000;
    const wholeUnits = Math.floor(availableTicks / TICKS_PER_UNIT);
    if (wholeUnits > 6) {
      return { kind: "stepper", maxUnits: wholeUnits, total };
    }

    const options = Array.from({ length: wholeUnits }, (_, index) => {
      const units = index + 1;
      return { label: String(units), ticks: units * TICKS_PER_UNIT };
    });
    if (
      availableTicks > 0 &&
      !options.some((option) => option.ticks === availableTicks)
    ) {
      options.push({
        label: `O resto · ${formatRoomTicks(availableTicks)}`,
        ticks: availableTicks,
      });
    }
    return { kind: "whole", options, total };
  }

  const fractions = [
    { label: "Inteira", ticks: capacityTicks },
    { label: "Metade", ticks: capacityTicks / 2 },
    { label: "⅓", ticks: capacityTicks / 3 },
    { label: "¼", ticks: capacityTicks / 4 },
  ].filter(
    (option) =>
      Number.isSafeInteger(option.ticks) &&
      option.ticks > 0 &&
      option.ticks <= availableTicks,
  );

  if (
    availableTicks > 0 &&
    !fractions.some((option) => option.ticks === availableTicks)
  ) {
    fractions.push({
      label: `O resto · ${formatRoomTicks(availableTicks)}`,
      ticks: availableTicks,
    });
  }
  return { kind: "fractions", options: fractions };
}
