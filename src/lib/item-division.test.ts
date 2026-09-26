import { describe, expect, it } from "vitest";
import { centsToBasisPoints,
  shareArcs,
  type ShareArc,
  computeDivision,
  divisionForItem,
  divisionStatusText,
  equalDivision,
  isDivisionValid,
  previewDivision,
  recomputeDivisionShares,
} from "./item-division";

describe("previewDivision", () => {
  it("previews each percentage independently while the sum is not 100%", () => {
    const percentTexts = { a: "35,00", b: "60,00" };
    const division = computeDivision(500, "percent", ["a", "b"], percentTexts, {});

    const preview = previewDivision(500, "percent", ["a", "b"], percentTexts, {}, division);

    expect(division.ok).toBe(false);
    expect(preview.centsById).toEqual({ a: 175, b: 300 });
    expect(preview.basisPointsById).toEqual({ a: 3500, b: 6000 });
  });

  it("blanks only the unparseable row", () => {
    const percentTexts = { a: "35,00", b: "abc" };
    const division = computeDivision(500, "percent", ["a", "b"], percentTexts, {});

    const preview = previewDivision(500, "percent", ["a", "b"], percentTexts, {}, division);

    expect(preview.centsById).toEqual({ a: 175, b: null });
    expect(preview.basisPointsById.b).toBeNull();
  });

  it("reuses the exact allocation, remainder included, once the division closes", () => {
    const percentTexts = { a: "33,33", b: "66,67" };
    const division = computeDivision(1000, "percent", ["a", "b"], percentTexts, {});

    const preview = previewDivision(1000, "percent", ["a", "b"], percentTexts, {}, division);

    expect(preview.centsById).toEqual({ a: 333, b: 667 });
  });

  it("keeps a zero item total free of NaN and Infinity ratios", () => {
    const fixedTexts = { a: "0", b: "0" };
    const division = computeDivision(0, "fixed", ["a", "b"], {}, fixedTexts);

    const preview = previewDivision(0, "fixed", ["a", "b"], {}, fixedTexts, division);

    expect(preview.basisPointsById).toEqual({ a: null, b: null });
    for (const cents of Object.values(preview.centsById)) {
      expect(Number.isFinite(cents ?? 0)).toBe(true);
    }
  });

  it("shows a fixed amount as its share of the item total", () => {
    const fixedTexts = { a: "2,50", b: "1,00" };
    const division = computeDivision(500, "fixed", ["a", "b"], {}, fixedTexts);

    const preview = previewDivision(500, "fixed", ["a", "b"], {}, fixedTexts, division);

    expect(preview.centsById).toEqual({ a: 250, b: 100 });
    expect(preview.basisPointsById).toEqual({ a: 5000, b: 2000 });
  });
});

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

  it("names the accepted format when a field cannot be parsed", () => {
    expect(divisionStatusText({ ok: false, reason: "invalid_input" }, "percent")).toBe(
      "Percentuais vão de 0 a 100, com até duas casas decimais.",
    );
    expect(divisionStatusText({ ok: false, reason: "invalid_input" }, "fixed")).toBe(
      "Valores em reais, com até duas casas decimais.",
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

describe("divisionForItem", () => {
  it("converts persisted split rows into a valid percent division", () => {
    expect(
      divisionForItem(
        { id: "item-1", totalPriceCents: 1000 },
        [
          { itemId: "item-1", userId: "a", splitType: "percentage", value: 25, computedAmountCents: 250 },
          { itemId: "item-1", userId: "b", splitType: "percentage", value: 75, computedAmountCents: 750 },
        ],
      ),
    ).toEqual({
      mode: "percent",
      shares: [
        { participantId: "a", cents: 250, basisPoints: 2500 },
        { participantId: "b", cents: 750, basisPoints: 7500 },
      ],
    });
  });

  it("returns null when persisted shares no longer reconcile", () => {
    expect(
      divisionForItem(
        { id: "item-1", totalPriceCents: 1000 },
        [{ itemId: "item-1", userId: "a", splitType: "fixed", value: 4, computedAmountCents: 400 }],
      ),
    ).toBeNull();
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

describe("centsToBasisPoints", () => {
  it("converts a centavo share to integer half-up basis points", () => {
    expect(centsToBasisPoints(100, 1_000)).toBe(1_000);
    expect(centsToBasisPoints(200, 1_000)).toBe(2_000);
    expect(centsToBasisPoints(1, 3)).toBe(3_333);
    expect(centsToBasisPoints(2, 3)).toBe(6_667);
  });

  it("returns zero for a non-positive total", () => {
    expect(centsToBasisPoints(500, 0)).toBe(0);
  });
});

describe("shareArcs", () => {
  const arcAngles = (arcs: ShareArc[]) =>
    arcs.map(({ participantId, startDegrees, sweepDegrees }) => [participantId, startDegrees, sweepDegrees]);

  it("splits the circle in halves for an equal split between 2 of 3 people", () => {
    const arcs = shareArcs(["a", "b", "c"], equalDivision(["a", "b"], 20_000));

    expect(arcAngles(arcs)).toEqual([
      ["a", 0, 180],
      ["b", 180, 180],
      ["c", 360, 0],
    ]);
    expect(arcs.map((arc) => arc.consumed)).toEqual([true, true, false]);
    expect(arcs.map((arc) => arc.basisPoints)).toEqual([5_000, 5_000, 0]);
  });

  it("follows the row order, not the order the shares were stored in", () => {
    const division = { mode: "fixed" as const, shares: [{ participantId: "c", cents: 785 }, { participantId: "a", cents: 149 }, { participantId: "b", cents: 66 }] };

    const arcs = shareArcs(["a", "b", "c"], division);

    expect(arcs.map((arc) => arc.cents)).toEqual([149, 66, 785]);
    expect(arcs[0].startDegrees).toBe(0);
    expect(arcs[0].sweepDegrees).toBeCloseTo(53.64, 10);
    expect(arcs[1].startDegrees).toBeCloseTo(53.64, 10);
    expect(arcs[1].sweepDegrees).toBeCloseTo(23.76, 10);
    expect(arcs[2].startDegrees).toBeCloseTo(77.4, 10);
    expect(arcs[2].startDegrees + arcs[2].sweepDegrees).toBeCloseTo(360, 10);
    expect(arcs.map((arc) => arc.basisPoints)).toEqual([1_490, 660, 7_850]);
  });

  it("gives the remainder centavo its own sliver and still closes the circle", () => {
    const arcs = shareArcs(["a", "b", "c"], equalDivision(["a", "b", "c"], 1_000));

    expect(arcs.map((arc) => arc.cents)).toEqual([334, 333, 333]);
    expect(arcs[0].sweepDegrees).toBeCloseTo(120.24, 10);
    expect(arcs[1].sweepDegrees).toBeCloseTo(119.88, 10);
    expect(arcs[2].startDegrees + arcs[2].sweepDegrees).toBeCloseTo(360, 10);
  });

  it("draws a full ring for a single consumer", () => {
    expect(arcAngles(shareArcs(["a", "b"], equalDivision(["b"], 999)))).toEqual([
      ["a", 0, 0],
      ["b", 0, 360],
    ]);
  });

  it("keeps a zero-cent share in the division without an arc", () => {
    const division = { mode: "fixed" as const, shares: [{ participantId: "a", cents: 0 }, { participantId: "b", cents: 500 }] };

    const [a, b] = shareArcs(["a", "b"], division);

    expect(a).toMatchObject({ consumed: true, cents: 0, sweepDegrees: 0 });
    expect(b).toMatchObject({ startDegrees: 0, sweepDegrees: 360 });
  });

  it("draws nothing for an item nobody took yet", () => {
    expect(shareArcs(["a", "b"], null).every((arc) => !arc.consumed && arc.sweepDegrees === 0)).toBe(true);
  });
});
