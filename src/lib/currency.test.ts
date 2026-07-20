import { describe, expect, it } from "vitest";
import {
  formatBRL,
  parseSafeMinorUnitCents,
  parseSignedSafeMinorUnitCents,
  type SafeMinorUnitCents,
  type SignedSafeMinorUnitCents,
} from "./currency";

describe("parseSafeMinorUnitCents", () => {
  it("accepts nonnegative safe integers", () => {
    expect(parseSafeMinorUnitCents(0)).toEqual({ ok: true, value: 0 });
    expect(parseSafeMinorUnitCents(1)).toEqual({ ok: true, value: 1 });
    expect(parseSafeMinorUnitCents(Number.MAX_SAFE_INTEGER)).toEqual({
      ok: true,
      value: Number.MAX_SAFE_INTEGER,
    });
  });

  it("rejects non-numbers", () => {
    for (const bad of ["0", true, false, null, undefined, {}, []] as unknown[]) {
      expect(parseSafeMinorUnitCents(bad)).toEqual({ ok: false, issue: "not_number" });
    }
  });

  it("rejects NaN as nonfinite", () => {
    expect(parseSafeMinorUnitCents(NaN)).toEqual({ ok: false, issue: "nonfinite" });
  });

  it("rejects infinities", () => {
    expect(parseSafeMinorUnitCents(Infinity)).toEqual({ ok: false, issue: "nonfinite" });
    expect(parseSafeMinorUnitCents(-Infinity)).toEqual({ ok: false, issue: "nonfinite" });
  });

  it("rejects fractions", () => {
    expect(parseSafeMinorUnitCents(0.5)).toEqual({ ok: false, issue: "fractional" });
    expect(parseSafeMinorUnitCents(1.1)).toEqual({ ok: false, issue: "fractional" });
  });

  it("rejects unsafe integers", () => {
    expect(parseSafeMinorUnitCents(Number.MAX_SAFE_INTEGER + 1)).toEqual({
      ok: false,
      issue: "unsafe",
    });
  });

  it("rejects negatives", () => {
    expect(parseSafeMinorUnitCents(-1)).toEqual({ ok: false, issue: "negative" });
  });
});

describe("parseSignedSafeMinorUnitCents", () => {
  it("accepts signed safe integers within range", () => {
    expect(parseSignedSafeMinorUnitCents(0)).toEqual({ ok: true, value: 0 });
    expect(parseSignedSafeMinorUnitCents(-500)).toEqual({ ok: true, value: -500 });
    expect(parseSignedSafeMinorUnitCents(Number.MAX_SAFE_INTEGER)).toEqual({
      ok: true,
      value: Number.MAX_SAFE_INTEGER,
    });
    expect(parseSignedSafeMinorUnitCents(-Number.MAX_SAFE_INTEGER)).toEqual({
      ok: true,
      value: -Number.MAX_SAFE_INTEGER,
    });
  });

  it("rejects the same structural defects except negatives are allowed", () => {
    expect(parseSignedSafeMinorUnitCents("0" as unknown)).toEqual({
      ok: false,
      issue: "not_number",
    });
    expect(parseSignedSafeMinorUnitCents(0.5)).toEqual({ ok: false, issue: "fractional" });
    expect(parseSignedSafeMinorUnitCents(Number.MAX_SAFE_INTEGER + 1)).toEqual({
      ok: false,
      issue: "unsafe",
    });
  });
});

describe("formatBRL", () => {
  it("formats small values", () => {
    expect(formatBRL(0 as SafeMinorUnitCents)).toBe("R$\u00a00,00");
    expect(formatBRL(1 as SafeMinorUnitCents)).toBe("R$\u00a00,01");
    expect(formatBRL(100 as SafeMinorUnitCents)).toBe("R$\u00a01,00");
  });

  it("formats with thousands separator", () => {
    expect(formatBRL(999999 as SafeMinorUnitCents)).toBe("R$\u00a09.999,99");
    expect(formatBRL(99_999_999 as SafeMinorUnitCents)).toBe("R$\u00a0999.999,99");
  });

  it("formats negative values", () => {
    expect(formatBRL(-500 as SignedSafeMinorUnitCents)).toBe("-R$\u00a05,00");
    expect(formatBRL(-1 as SignedSafeMinorUnitCents)).toBe("-R$\u00a00,01");
  });

  it("loses no cents near Number.MAX_SAFE_INTEGER", () => {
    // 9_007_199_254_740_991 centavos = R$ 90.071.992.547.409,91
    expect(formatBRL(Number.MAX_SAFE_INTEGER as SafeMinorUnitCents)).toBe(
      "R$\u00a090.071.992.547.409,91",
    );
    expect(formatBRL(-Number.MAX_SAFE_INTEGER as SignedSafeMinorUnitCents)).toBe(
      "-R$\u00a090.071.992.547.409,91",
    );
  });

  it("formats a value that a float /100 would round incorrectly", () => {
    // 1.5e35-ish is unsafe; pick a safe-integer value whose float /100 breaks.
    // 9_007_199_254_740_949 cents: float division gives a reais that loses cents.
    const value = 9_007_199_254_740_949 as SafeMinorUnitCents;
    expect(formatBRL(value)).toBe("R$\u00a090.071.992.547.409,49");
  });
});
