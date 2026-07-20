import { describe, expect, it } from "vitest";
import {
  MAX_EXPENSE_QUANTITY_MILLIUNITS,
  computeExpenseLineTotalCents,
  formatExpenseQuantity,
  parseExpenseQuantity,
  type ExpenseQuantity,
} from "./expense-quantity";
import { MAX_EXPENSE_CENTS, parseExpenseCents } from "./expense-money";

// Unwrap helper for value-based fixtures; failure cases call parseExpenseQuantity
// directly so they can assert the issue.
function q(value: unknown): ExpenseQuantity {
  const r = parseExpenseQuantity(value);
  if (!r.ok) throw new Error(`fixture: invalid quantity ${String(value)}`);
  return r.value;
}
function cents(value: number) {
  const r = parseExpenseCents(value, "allow");
  if (!r.ok) throw new Error(`fixture: invalid cents ${value}`);
  return r.value;
}

describe("parseExpenseQuantity", () => {
  it("accepts integer and fractional values via string or number", () => {
    expect(parseExpenseQuantity(1)).toEqual({ ok: true, value: 1000 });
    expect(parseExpenseQuantity("1")).toEqual({ ok: true, value: 1000 });
    expect(parseExpenseQuantity("0,5")).toEqual({ ok: true, value: 500 });
    expect(parseExpenseQuantity("0.5")).toEqual({ ok: true, value: 500 });
    expect(parseExpenseQuantity("1,5")).toEqual({ ok: true, value: 1500 });
    expect(parseExpenseQuantity(0.5)).toEqual({ ok: true, value: 500 });
    expect(parseExpenseQuantity("1,500")).toEqual({ ok: true, value: 1500 });
    expect(parseExpenseQuantity("0,001")).toEqual({ ok: true, value: 1 });
  });

  it("rejects empty, nonfinite, non-number, zero, negative", () => {
    expect(parseExpenseQuantity("")).toEqual({ ok: false, issue: { code: "required" } });
    expect(parseExpenseQuantity("   ")).toEqual({ ok: false, issue: { code: "required" } });
    expect(parseExpenseQuantity(Infinity)).toEqual({ ok: false, issue: { code: "nonfinite" } });
    expect(parseExpenseQuantity(null as unknown)).toEqual({
      ok: false,
      issue: { code: "not_number" },
    });
    expect(parseExpenseQuantity("0")).toEqual({ ok: false, issue: { code: "nonpositive" } });
    expect(parseExpenseQuantity("0,0")).toEqual({ ok: false, issue: { code: "nonpositive" } });
  });

  it("rejects over-precision (more than three fractional digits)", () => {
    expect(parseExpenseQuantity("0,0001")).toEqual({
      ok: false,
      issue: { code: "excess_precision" },
    });
    expect(parseExpenseQuantity("1,2345")).toEqual({
      ok: false,
      issue: { code: "excess_precision" },
    });
  });

  it("rejects malformed input without rounding or repair", () => {
    expect(parseExpenseQuantity("abc").ok).toBe(false);
    expect(parseExpenseQuantity("1,2,3").ok).toBe(false);
    expect(parseExpenseQuantity("-1").ok).toBe(false);
    expect(parseExpenseQuantity("1.5.5").ok).toBe(false);
  });

  it("enforces the upper bound", () => {
    expect(parseExpenseQuantity(`${MAX_EXPENSE_QUANTITY_MILLIUNITS / 1000}`)).toEqual({
      ok: true,
      value: MAX_EXPENSE_QUANTITY_MILLIUNITS,
    });
    // 1,000,000 items = 10^9 milliunits exceeds the 999.999-item cap
    expect(parseExpenseQuantity("1000000")).toEqual({
      ok: false,
      issue: { code: "out_of_range" },
    });
  });
});

describe("formatExpenseQuantity", () => {
  it("trims trailing fractional zeros", () => {
    expect(formatExpenseQuantity(q("1"))).toBe("1");
    expect(formatExpenseQuantity(q("0,5"))).toBe("0,5");
    expect(formatExpenseQuantity(q("1,5"))).toBe("1,5");
    expect(formatExpenseQuantity(q("1,501"))).toBe("1,501");
    expect(formatExpenseQuantity(q("0,001"))).toBe("0,001");
    expect(formatExpenseQuantity(q("1,05"))).toBe("1,05");
  });
});

describe("computeExpenseLineTotalCents", () => {
  it("rounds half up at the sub-centavo boundary", () => {
    // 0,5 x R$ 1,01 = 0,505 -> 51 centavos (#578's canonical example)
    expect(computeExpenseLineTotalCents(q("0,5"), cents(101))).toEqual({
      ok: true,
      value: 51,
    });
    // 0,001 x R$ 1,00 = 0,001 -> rounds to 0
    expect(computeExpenseLineTotalCents(q("0,001"), cents(100))).toEqual({
      ok: true,
      value: 0,
    });
    // 2 x R$ 3,33 = 666
    expect(computeExpenseLineTotalCents(q("2"), cents(333))).toEqual({
      ok: true,
      value: 666,
    });
    // 1,333 x R$ 1,00 = R$ 1,333 -> 133 centavos
    expect(computeExpenseLineTotalCents(q("1,333"), cents(100))).toEqual({
      ok: true,
      value: 133,
    });
  });

  it("rejects a derived total above MAX_EXPENSE_CENTS", () => {
    const r = computeExpenseLineTotalCents(q("999"), MAX_EXPENSE_CENTS);
    expect(r.ok).toBe(false);
  });
});

describe("round-trip", () => {
  it("parses and reformats the same value across sources", () => {
    for (const input of ["1", "0,5", "1,5", "1,501", "999", "0,001", "12,345"]) {
      const parsed = parseExpenseQuantity(input);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        const reformatted = formatExpenseQuantity(parsed.value);
        const reparsed = parseExpenseQuantity(reformatted);
        expect(reparsed.ok).toBe(true);
        if (reparsed.ok) {
          expect(reparsed.value).toBe(parsed.value);
        }
      }
    }
  });
});
