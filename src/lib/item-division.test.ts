import { describe, expect, it } from "vitest";
import {
  computeDivision,
  divisionStatusText,
  equalDivision,
  isDivisionValid,
  recomputeDivisionShares,
} from "./item-division";

describe("computeDivision", () => {
  it("rejects an empty selection", () => {
    expect(computeDivision(1000, "equal", [], {}, {})).toEqual({ ok: false, reason: "empty" });
  });

  it("allocates equal shares with the remainder in selection order", () => {
    const result = computeDivision(1000, "equal", ["a", "b", "c"], {}, {});
    expect(result).toEqual({ ok: true, centsById: { a: 334, b: 333, c: 333 } });
  });

  it("reports the missing basis points when percentages do not close 100%", () => {
    const result = computeDivision(1000, "percent", ["a", "b"], { a: "39,99", b: "60,00" }, {});
    expect(result).toEqual({ ok: false, reason: "total", remainder: 1 });
  });

  it("returns basis points and cents when percentages sum to exactly 100%", () => {
    const result = computeDivision(1000, "percent", ["a", "b"], { a: "33,33", b: "66,67" }, {});
    expect(result).toEqual({
      ok: true,
      centsById: { a: 333, b: 667 },
      basisPointsById: { a: 3333, b: 6667 },
    });
  });

  it("rejects percentages with more than two decimals", () => {
    expect(computeDivision(1000, "percent", ["a"], { a: "99,999" }, {})).toEqual({
      ok: false,
      reason: "invalid_input",
    });
  });

  it("reports the remainder when fixed values miss the item total", () => {
    const result = computeDivision(1000, "fixed", ["a", "b"], {}, { a: "4,00", b: "5,50" });
    expect(result).toEqual({ ok: false, reason: "total", remainder: 50 });
  });

  it("reports excess when fixed values exceed the item total", () => {
    const result = computeDivision(1000, "fixed", ["a", "b"], {}, { a: "6,00", b: "5,00" });
    expect(result).toEqual({ ok: false, reason: "total", remainder: -100 });
  });

  it("accepts exact fixed values", () => {
    const result = computeDivision(1000, "fixed", ["a", "b"], {}, { a: "4,25", b: "5,75" });
    expect(result).toEqual({ ok: true, centsById: { a: 425, b: 575 } });
  });
});

describe("divisionStatusText", () => {
  it("describes percent and fixed remainders with the exact amount", () => {
    expect(divisionStatusText({ ok: false, reason: "total", remainder: 1 }, "percent")).toBe(
      "Faltam 0,01% para fechar 100%.",
    );
    expect(divisionStatusText({ ok: false, reason: "total", remainder: -50 }, "fixed")).toBe(
      "Excede R$\u00a00,50 do valor do item.",
    );
  });
});

describe("equalDivision and isDivisionValid", () => {
  it("builds an equal division that reconciles to the item", () => {
    const value = equalDivision(["a", "b", "c"], 100);
    expect(value).toEqual({
      mode: "equal",
      shares: [
        { participantId: "a", cents: 34 },
        { participantId: "b", cents: 33 },
        { participantId: "c", cents: 33 },
      ],
    });
    expect(isDivisionValid(value!, 100)).toBe(true);
    expect(isDivisionValid(value!, 101)).toBe(false);
  });

  it("returns null when there is nobody to split with", () => {
    expect(equalDivision([], 100)).toBeNull();
  });
});

describe("recomputeDivisionShares", () => {
  it("keeps authored fixed shares untouched when the item amount changes", () => {
    const value = { mode: "fixed" as const, shares: [{ participantId: "a", cents: 700 }, { participantId: "b", cents: 300 }] };
    expect(recomputeDivisionShares(value, 1200)).toBe(value);
    expect(isDivisionValid(recomputeDivisionShares(value, 1200), 1200)).toBe(false);
  });

  it("reallocates percent shares from their basis points", () => {
    const value = {
      mode: "percent" as const,
      shares: [
        { participantId: "a", cents: 250, basisPoints: 2500 },
        { participantId: "b", cents: 750, basisPoints: 7500 },
      ],
    };
    expect(recomputeDivisionShares(value, 2000)).toEqual({
      mode: "percent",
      shares: [
        { participantId: "a", cents: 500, basisPoints: 2500 },
        { participantId: "b", cents: 1500, basisPoints: 7500 },
      ],
    });
  });

  it("reallocates equal shares evenly", () => {
    const value = { mode: "equal" as const, shares: [{ participantId: "a", cents: 50 }, { participantId: "b", cents: 50 }] };
    expect(recomputeDivisionShares(value, 101)).toEqual({
      mode: "equal",
      shares: [
        { participantId: "a", cents: 51 },
        { participantId: "b", cents: 50 },
      ],
    });
  });
});
