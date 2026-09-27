import { describe, expect, it } from "vitest";
import {
  claimOptionsFor,
  claimQuantityLabel,
  formatRoomTicks,
} from "./assignment-room-quantity";

describe("formatRoomTicks", () => {
  it("names common fractions of one item instead of rounding them", () => {
    expect(formatRoomTicks(60_000)).toBe("1/2");
    expect(formatRoomTicks(40_000)).toBe("1/3");
    expect(formatRoomTicks(80_000)).toBe("2/3");
    expect(formatRoomTicks(30_000)).toBe("1/4");
    expect(formatRoomTicks(24_000)).toBe("1/5");
  });

  it("uses decimal text once the quantity passes one item", () => {
    expect(formatRoomTicks(0)).toBe("0");
    expect(formatRoomTicks(120_000)).toBe("1");
    expect(formatRoomTicks(360_000)).toBe("3");
    expect(formatRoomTicks(180_000)).toBe("1,5");
    expect(formatRoomTicks(120)).toBe("0,001");
  });

  it("prints a below-unit fraction only when the value lands on one", () => {
    expect(formatRoomTicks(17_142)).toBe("1/7");
    expect(formatRoomTicks(17_143)).toBe("1/7");
    expect(formatRoomTicks(40_400)).toBe("≈0,34");
  });

  it("never prints a leftover as zero", () => {
    expect(formatRoomTicks(40)).toBe("<0,01");
  });

  it("keeps whole-milliunit leftovers as decimals", () => {
    expect(formatRoomTicks(44_400)).toBe("0,37");
    expect(formatRoomTicks(18_000)).toBe("0,15");
    expect(formatRoomTicks(1_200)).toBe("0,01");
  });

  it("prints exact leftovers while their denominator stays small", () => {
    expect(formatRoomTicks(64_000)).toBe("8/15");
  });

  it("approximates odd multi-unit quantities", () => {
    expect(formatRoomTicks(154_600)).toBe("≈1,29");
  });

  it("rejects tick counts a room can never hold", () => {
    expect(() => formatRoomTicks(-1)).toThrow(RangeError);
    expect(() => formatRoomTicks(1.5)).toThrow(RangeError);
    expect(() => formatRoomTicks(Number.NaN)).toThrow(RangeError);
    expect(() => formatRoomTicks(Number.MAX_SAFE_INTEGER + 2)).toThrow(
      RangeError,
    );
  });
});

describe("claimOptionsFor", () => {
  it("offers each available whole unit up to six", () => {
    expect(claimOptionsFor(8_000, 360_000, 0)).toEqual({
      kind: "whole",
      total: 8,
      options: [
        { label: "1", ticks: 120_000 },
        { label: "2", ticks: 240_000 },
        { label: "3", ticks: 360_000 },
      ],
    });
  });

  it("adds the exact remainder when whole-unit options cannot express it", () => {
    expect(claimOptionsFor(8_000, 300_000, 0)).toEqual({
      kind: "whole",
      total: 8,
      options: [
        { label: "1", ticks: 120_000 },
        { label: "2", ticks: 240_000 },
        { label: "O resto · 2,5", ticks: 300_000 },
      ],
    });
  });

  it("uses a bounded whole-unit stepper above six available units", () => {
    expect(claimOptionsFor(8_000, 840_000, 0)).toEqual({
      kind: "stepper",
      maxUnits: 7,
      total: 8,
    });
  });

  it("offers only fractions that fit and adds a distinct remainder", () => {
    expect(claimOptionsFor(1_000, 80_000, 4)).toEqual({
      kind: "fractions",
      options: [
        { label: "Metade", ticks: 60_000 },
        { label: "⅓", ticks: 40_000 },
        { label: "¼", ticks: 30_000 },
        { label: "O resto · 2/3", ticks: 80_000 },
      ],
    });
    expect(claimOptionsFor(1_000, 40_000, 4)).toEqual({
      kind: "fractions",
      options: [
        { label: "⅓", ticks: 40_000 },
        { label: "¼", ticks: 30_000 },
      ],
    });
  });

  it("offers the named full-line fractions when the whole item fits", () => {
    expect(claimOptionsFor(1_000, 120_000, 4)).toEqual({
      kind: "fractions",
      options: [
        { label: "Inteira", ticks: 120_000 },
        { label: "Metade", ticks: 60_000 },
        { label: "⅓", ticks: 40_000 },
        { label: "¼", ticks: 30_000 },
      ],
    });
  });

  it("offers a fifth once five participants are active, not before", () => {
    expect(claimOptionsFor(1_000, 120_000, 4)).toEqual({
      kind: "fractions",
      options: [
        { label: "Inteira", ticks: 120_000 },
        { label: "Metade", ticks: 60_000 },
        { label: "⅓", ticks: 40_000 },
        { label: "¼", ticks: 30_000 },
      ],
    });
    expect(claimOptionsFor(1_000, 120_000, 5)).toEqual({
      kind: "fractions",
      options: [
        { label: "Inteira", ticks: 120_000 },
        { label: "Metade", ticks: 60_000 },
        { label: "⅓", ticks: 40_000 },
        { label: "¼", ticks: 30_000 },
        { label: "⅕", ticks: 24_000 },
      ],
    });
  });

  it("unlocks a sixth at six people and an eighth only at eight", () => {
    const throughSixth = [
      { label: "Inteira", ticks: 120_000 },
      { label: "Metade", ticks: 60_000 },
      { label: "⅓", ticks: 40_000 },
      { label: "¼", ticks: 30_000 },
      { label: "⅕", ticks: 24_000 },
      { label: "⅙", ticks: 20_000 },
    ];
    expect(claimOptionsFor(1_000, 120_000, 6)).toEqual({
      kind: "fractions",
      options: throughSixth,
    });
    expect(claimOptionsFor(1_000, 120_000, 7)).toEqual({
      kind: "fractions",
      options: throughSixth,
    });
    expect(claimOptionsFor(1_000, 120_000, 8)).toEqual({
      kind: "fractions",
      options: [...throughSixth, { label: "⅛", ticks: 15_000 }],
    });
  });
});

describe("claimQuantityLabel", () => {
  it("distinguishes units from fractions of a single line", () => {
    expect(claimQuantityLabel(3_000, 300_000)).toBe("2,5");
    expect(claimQuantityLabel(3_000, 60_000)).toBe("0,5");
    expect(claimQuantityLabel(1_000, 120_000)).toBe("inteira");
    expect(claimQuantityLabel(1_000, 60_000)).toBe("metade");
    expect(claimQuantityLabel(1_000, 40_000)).toBe("⅓");
    expect(claimQuantityLabel(1_000, 30_000)).toBe("¼");
    expect(claimQuantityLabel(1_000, 80_000)).toBe("⅔");
    expect(claimQuantityLabel(1_000, 90_000)).toBe("¾");
    expect(claimQuantityLabel(500, 30_000)).toBe("metade");
    expect(claimQuantityLabel(1_000, 17_143)).toBe("1/7");
    expect(claimQuantityLabel(1_000, 0)).toBe("0%");
    expect(() => claimQuantityLabel(1_000, -1)).toThrow(RangeError);
  });

  it("reads shares rounded to either side of an odd cut as that fraction", () => {
    expect(claimQuantityLabel(1_000, Math.floor(120_000 / 7))).toBe("1/7");
    expect(claimQuantityLabel(1_000, Math.ceil(120_000 / 7))).toBe("1/7");
    expect(claimQuantityLabel(1_000, 26_667)).toBe("2/9");
    expect(claimQuantityLabel(1_000, 10_000)).toBe("1/12");
  });

  it("prints two fifths with its glyph", () => {
    expect(claimQuantityLabel(1_000, 48_000)).toBe("⅖");
  });

  it("falls back to a whole percent when no fraction is close", () => {
    expect(claimQuantityLabel(1_000, 44_400)).toBe("37%");
  });

  it("never reads a partial share as none or all of the item", () => {
    expect(claimQuantityLabel(1_000, 400)).toBe("<1%");
    expect(claimQuantityLabel(1_000, 119_999)).toBe(">99%");
  });
});
