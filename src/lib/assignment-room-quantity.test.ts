import { describe, expect, it } from "vitest";
import { formatRoomTicks } from "./assignment-room-quantity";

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
