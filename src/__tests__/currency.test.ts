import { describe, expect, it } from "vitest";
import { distributeProportionally, distributeEvenly } from "@/lib/currency";

import { formatBRL } from "@/lib/currency";

describe("distributeProportionally", () => {
  it("should return zeros when total is zero", () => {
    expect(distributeProportionally(0, [1, 2, 3])).toEqual([0, 0, 0]);
  });

  it("should return zeros when weights sum is zero", () => {
    expect(distributeProportionally(100, [0, 0, 0])).toEqual([0, 0, 0]);
  });
  it("should return zeros when all weights are zero", () => {
    expect(distributeProportionally(100, [0, 0, 0])).toEqual([0, 0, 0]);
  });
  it("should return single value when one weight", () => {
    expect(distributeProportionally(100, [100])).toEqual([100]);
  });
  it("should preserve exact sum for weights with fractional parts", () => {
    const result = distributeProportionally(100, [33.33, 33.33, 33.34]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("should handle remainder distribution correctly", () => {
    const result = distributeProportionally(100, [30, 40, 26]);
    expect(result).toEqual([30, 44, 26]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("should handle unequal weights", () => {
    expect(distributeProportionally(100, [10, 20, 30, 40])).toEqual([10, 20, 30, 40]);
  });
  it("should handle R$0.01 split among 2 people", () => {
    const result = distributeProportionally(1, [1, 1]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("distributeEvenly", () => {
  it("should return empty array when count is zero", () => {
    expect(distributeEvenly(100, 0)).toEqual([]);
  });
  it("should return zeros when total is zero", () => {
    expect(distributeEvenly(0, 5)).toEqual([0, 0, 0, 0, 0]);
  });
  it("should distribute evenly among participants", () => {
    const result = distributeEvenly(100, 4);
    expect(result).toEqual([25, 25, 25, 25]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("should handle indivisible amounts with largest remainder", () => {
    const result = distributeEvenly(100, 3);
    expect(result).toEqual([34, 33, 33]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("should handle R$0.01 split among 3 people", () => {
    const result = distributeEvenly(1, 3);
    expect(result).toEqual([1, 0, 0]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("formatBRL integration", () => {
  it("should format cents to BRL string", () => {
    expect(formatBRL(100)).toBe("R$\u00a0 1,00");
    expect(formatBRL(1)).toBe("R$\u00a0 0,01");
    expect(formatBRL(12345)).toBe("R$\u00a0 123,45");
  });
});
