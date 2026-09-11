import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  MAX_ALLOCATION_BASIS_POINTS,
  MAX_EXPENSE_CENTS,
  MAX_SERVICE_FEE_BASIS_POINTS,
  allocateByBasisPoints,
  allocateByWeights,
  allocateEvenly,
  computeServiceFeeCents,
} from "@/lib/expense-money";
import { propertyConfig } from "@/test/property";

const cents = fc.integer({ min: 0, max: MAX_EXPENSE_CENTS as number });
const basisPoints = fc.integer({ min: 0, max: MAX_SERVICE_FEE_BASIS_POINTS as number });

function unwrap<T>(result: { ok: true; value: T } | { ok: false; issue: unknown }): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.issue)}`);
  }
  return result.value;
}

describe("allocateByWeights", () => {
  it("distributes the exact total with at most one cent of spread per weight", () => {
    fc.assert(
      fc.property(
        cents,
        fc.array(cents, { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
          fc.pre(weightSum > 0);

          const shares = unwrap(allocateByWeights(total, weights));

          expect(shares.reduce((sum, share) => sum + (share as number), 0)).toBe(total);
          shares.forEach((share, index) => {
            const exact = (BigInt(total) * BigInt(weights[index])) / BigInt(weightSum);
            expect(share as number).toBeGreaterThanOrEqual(Number(exact));
            expect(share as number).toBeLessThanOrEqual(Number(exact) + 1);
          });
        },
      ),
      propertyConfig(500),
    );
  });

  it("agrees with allocateEvenly when every weight is equal", () => {
    fc.assert(
      fc.property(
        cents,
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 1000 }),
        (total, count, weight) => {
          const weighted = unwrap(allocateByWeights(total, Array<number>(count).fill(weight)));
          const even = unwrap(allocateEvenly(total, count));
          expect(weighted).toEqual(even);
        },
      ),
      propertyConfig(500),
    );
  });
});

describe("allocateEvenly", () => {
  it("splits the exact total within one cent, remainder first", () => {
    fc.assert(
      fc.property(cents, fc.integer({ min: 1, max: 24 }), (total, count) => {
        const shares = unwrap(allocateEvenly(total, count)).map((share) => share as number);

        expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total);
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
        for (let index = 1; index < shares.length; index++) {
          expect(shares[index]).toBeLessThanOrEqual(shares[index - 1]);
        }
      }),
      propertyConfig(500),
    );
  });
});

describe("allocateByBasisPoints", () => {
  it("distributes the exact total across weights summing to 100%", () => {
    fc.assert(
      fc.property(
        cents,
        fc.integer({ min: 1, max: 8 }),
        fc.array(fc.integer({ min: 0, max: MAX_ALLOCATION_BASIS_POINTS as number }), {
          minLength: 1,
          maxLength: 8,
        }),
        (total, count, seeds) => {
          const raw = Array.from({ length: count }, (_, index) => seeds[index] ?? 0);
          const rawSum = raw.reduce((sum, value) => sum + value, 0);
          fc.pre(rawSum > 0);
          const scaled = unwrap(allocateByWeights(MAX_ALLOCATION_BASIS_POINTS, raw)).map(
            (value) => value as number,
          );

          const shares = unwrap(allocateByBasisPoints(total, scaled));

          expect(shares.reduce((sum, share) => sum + (share as number), 0)).toBe(total);
          shares.forEach((share, index) => {
            const exact = (BigInt(total) * BigInt(scaled[index])) / BigInt(10_000);
            expect(share as number).toBeGreaterThanOrEqual(Number(exact));
            expect(share as number).toBeLessThanOrEqual(Number(exact) + 1);
          });
        },
      ),
      propertyConfig(500),
    );
  });
});

describe("computeServiceFeeCents", () => {
  it("rounds half up exactly as the SQL does", () => {
    fc.assert(
      fc.property(cents, basisPoints, (subtotal, rate) => {
        const fee = unwrap(computeServiceFeeCents(subtotal, rate));
        const reference =
          (BigInt(subtotal) * BigInt(rate) + BigInt(5000)) / BigInt(10_000);
        expect(fee as number).toBe(Number(reference));
      }),
      propertyConfig(500),
    );
  });

  it("never decreases when the subtotal or the rate grows", () => {
    fc.assert(
      fc.property(cents, cents, basisPoints, basisPoints, (a, b, lowRate, highRate) => {
        const [smaller, larger] = a <= b ? [a, b] : [b, a];
        const [low, high] = lowRate <= highRate ? [lowRate, highRate] : [highRate, lowRate];

        expect(unwrap(computeServiceFeeCents(larger, low)) as number).toBeGreaterThanOrEqual(
          unwrap(computeServiceFeeCents(smaller, low)) as number,
        );
        expect(unwrap(computeServiceFeeCents(smaller, high)) as number).toBeGreaterThanOrEqual(
          unwrap(computeServiceFeeCents(smaller, low)) as number,
        );
      }),
      propertyConfig(500),
    );
  });
});
