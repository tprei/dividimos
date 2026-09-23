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

  it("keeps an unusual split exact rather than truncating it", () => {
    expect(formatRoomTicks(40)).toBe("1/3000");
    expect(formatRoomTicks(17_143)).toBe("17143/120000");
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
    expect(claimOptionsFor(8_000, 360_000)).toEqual({
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
    expect(claimOptionsFor(8_000, 300_000)).toEqual({
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
    expect(claimOptionsFor(8_000, 840_000)).toEqual({
      kind: "stepper",
      maxUnits: 7,
      total: 8,
    });
  });

  it("offers only fractions that fit and adds a distinct remainder", () => {
    expect(claimOptionsFor(1_000, 80_000)).toEqual({
      kind: "fractions",
      options: [
        { label: "Metade", ticks: 60_000 },
        { label: "⅓", ticks: 40_000 },
        { label: "¼", ticks: 30_000 },
        { label: "O resto · 2/3", ticks: 80_000 },
      ],
    });
    expect(claimOptionsFor(1_000, 40_000)).toEqual({
      kind: "fractions",
      options: [
        { label: "⅓", ticks: 40_000 },
        { label: "¼", ticks: 30_000 },
      ],
    });
  });

  it("offers the named full-line fractions when the whole item fits", () => {
    expect(claimOptionsFor(1_000, 120_000)).toEqual({
      kind: "fractions",
      options: [
        { label: "Inteira", ticks: 120_000 },
        { label: "Metade", ticks: 60_000 },
        { label: "⅓", ticks: 40_000 },
        { label: "¼", ticks: 30_000 },
      ],
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
    expect(claimQuantityLabel(1_000, 17_143)).toBe("17143/120000");
    expect(claimQuantityLabel(1_000, 0)).toBe("0");
    expect(() => claimQuantityLabel(1_000, -1)).toThrow(RangeError);
  });
});
