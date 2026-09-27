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

/** Shares the sheet spells with a glyph instead of a plain `k/n` ratio. */
const FRACTION_GLYPHS: Record<string, string> = {
  "1/3": "⅓",
  "2/3": "⅔",
  "1/4": "¼",
  "3/4": "¾",
  "1/5": "⅕",
  "2/5": "⅖",
  "3/5": "⅗",
  "4/5": "⅘",
  "1/6": "⅙",
  "5/6": "⅚",
  "1/8": "⅛",
  "3/8": "⅜",
  "5/8": "⅝",
  "7/8": "⅞",
};

/** Whole percents, as in `"37%"`. */
const WHOLE_PERCENT = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 0,
});

/** Item counts with at most two decimals, as in `"1,29"`. */
const APPROX_UNITS = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
});

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
 * Reduced `k/n` over denominators 2 to 12 whose exact cut `ticks` lands on:
 * `ticks` equals the floor or the ceiling of `k * capacity / n`. Null when no
 * fraction of at most twelve parts is that close.
 */
function exactUnitFraction(
  ticks: number,
  capacityTicks: number,
): { numerator: number; denominator: number } | null {
  for (let denominator = 2; denominator <= 12; denominator += 1) {
    for (let numerator = 1; numerator < denominator; numerator += 1) {
      if (greatestCommonDivisor(numerator, denominator) !== 1) continue;
      const exactTicks = (numerator * capacityTicks) / denominator;
      if (
        Math.floor(exactTicks) === ticks ||
        Math.ceil(exactTicks) === ticks
      ) {
        return { numerator, denominator };
      }
    }
  }
  return null;
}

/**
 * Format claim ticks as a quantity of items: `"1"`, `"1,5"`, `"1/3"`,
 * `"8/15"`, `"1/7"`, `"≈0,34"`. Reduced fractions print exactly while their
 * denominator stays at most 120; rarer sub-unit quantities fall back to the
 * guest fraction they land on, else to a two-decimal approximation. Rejects
 * values that cannot come from a decoded room, because a negative or
 * fractional tick count is a bug to surface rather than a number to round
 * away.
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
  if (ticks < TICKS_PER_UNIT && denominator <= 120) {
    return `${numerator}/${denominator}`;
  }
  if (ticks % ROOM_TICKS_PER_MILLIUNIT === 0) {
    const milliunits = (ticks / ROOM_TICKS_PER_MILLIUNIT) as ExpenseQuantity;
    return formatExpenseQuantity(milliunits);
  }
  if (denominator <= 120) {
    return `${numerator}/${denominator}`;
  }
  if (ticks < TICKS_PER_UNIT) {
    const fraction = exactUnitFraction(ticks, TICKS_PER_UNIT);
    if (fraction) {
      return `${fraction.numerator}/${fraction.denominator}`;
    }
  }
  return `≈${APPROX_UNITS.format(ticks / TICKS_PER_UNIT)}`;
}

/** Shared spoken quantity for a claim; single-line fractions are relative to its capacity. */
export function claimQuantityLabel(quantityMilliunits: number, ticks: number): string {
  assertRoomQuantity(quantityMilliunits, "quantity milliunits");
  assertRoomQuantity(ticks, "claim ticks");
  if (quantityMilliunits >= 2_000) {
    return ticks % ROOM_TICKS_PER_MILLIUNIT === 0
      ? formatExpenseQuantity((ticks / ROOM_TICKS_PER_MILLIUNIT) as ExpenseQuantity)
      : formatRoomTicks(ticks);
  }
  const capacity = quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT;
  if (capacity > 0) {
    if (ticks === capacity) return "inteira";
    if (ticks === capacity / 2) return "metade";
    const fraction = exactUnitFraction(ticks, capacity);
    if (fraction) {
      const ratio = `${fraction.numerator}/${fraction.denominator}`;
      return FRACTION_GLYPHS[ratio] ?? ratio;
    }
    return WHOLE_PERCENT.format(ticks / capacity);
  }
  return formatRoomTicks(ticks);
}

/**
 * Build the finite set of quantities offered by the claim sheet.
 *
 * `maxTicks` is the largest absolute claim the selected participant may make:
 * their saved ticks plus the line's currently unclaimed ticks.
 * `activeParticipantCount` unlocks the ⅕ ⅙ ⅛ shares once the room actually has
 * enough people to split into them.
 */
export function claimOptionsFor(
  quantityMilliunits: number,
  maxTicks: number,
  activeParticipantCount: number,
): ClaimOptions {
  assertRoomQuantity(quantityMilliunits, "quantity milliunits");
  assertRoomQuantity(maxTicks, "maximum claim ticks");
  assertRoomQuantity(activeParticipantCount, "active participant count");

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
  ];
  if (activeParticipantCount >= 5) {
    fractions.push({ label: "⅕", ticks: capacityTicks / 5 });
  }
  if (activeParticipantCount >= 6) {
    fractions.push({ label: "⅙", ticks: capacityTicks / 6 });
  }
  if (activeParticipantCount >= 8) {
    fractions.push({ label: "⅛", ticks: capacityTicks / 8 });
  }
  const options = fractions.filter(
    (option) =>
      Number.isSafeInteger(option.ticks) &&
      option.ticks > 0 &&
      option.ticks <= availableTicks,
  );

  if (
    availableTicks > 0 &&
    !options.some((option) => option.ticks === availableTicks)
  ) {
    options.push({
      label: `O resto · ${formatRoomTicks(availableTicks)}`,
      ticks: availableTicks,
    });
  }
  return { kind: "fractions", options };
}
