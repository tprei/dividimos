import { describe, it, expect } from "vitest";
import {
  formatBRL,
  centsToDecimal,
  decimalToCents,
  parseBRLInput,
  sanitizeDecimalInput,
} from "@/lib/currency";

describe("formatBRL", () => {
  it("formats zero cents", () => {
    expect(formatBRL(0)).toBe("R$\u00a00,00");
  });

  it("formats whole reais", () => {
    expect(formatBRL(10000)).toBe("R$\u00a0100,00");
  });

  it("formats cents only", () => {
    expect(formatBRL(99)).toBe("R$\u00a00,99");
  });

  it("formats typical restaurant bill", () => {
    expect(formatBRL(15750)).toBe("R$\u00a0157,50");
  });

  it("formats large amounts", () => {
    expect(formatBRL(999999)).toBe("R$\u00a09.999,99");
  });

  it("formats 1 cent", () => {
    expect(formatBRL(1)).toBe("R$\u00a00,01");
  });

  it("handles negative amounts", () => {
    const result = formatBRL(-500);
    expect(result).toContain("5,00");
  });
});

describe("centsToDecimal", () => {
  it("converts 0 cents", () => {
    expect(centsToDecimal(0)).toBe("0.00");
  });

  it("converts 10000 cents to 100.00", () => {
    expect(centsToDecimal(10000)).toBe("100.00");
  });

  it("converts 1 cent", () => {
    expect(centsToDecimal(1)).toBe("0.01");
  });

  it("converts odd cents", () => {
    expect(centsToDecimal(1001)).toBe("10.01");
  });
});

describe("decimalToCents", () => {
  it("converts round values", () => {
    expect(decimalToCents(100)).toBe(10000);
  });

  it("converts decimal values", () => {
    expect(decimalToCents(10.5)).toBe(1050);
  });

  it("rounds floating point properly", () => {
    // 0.1 + 0.2 = 0.30000000000000004
    expect(decimalToCents(0.1 + 0.2)).toBe(30);
  });

  it("converts zero", () => {
    expect(decimalToCents(0)).toBe(0);
  });

  it("handles three decimal places by rounding", () => {
    expect(decimalToCents(10.999)).toBe(1100);
    expect(decimalToCents(10.994)).toBe(1099);
  });
});

describe("parseBRLInput", () => {
  it("parses Brazilian format with comma", () => {
    expect(parseBRLInput("100,00")).toBe(10000);
  });

  it("parses with R$ prefix", () => {
    expect(parseBRLInput("R$ 100,00")).toBe(10000);
  });

  it("parses plain number", () => {
    expect(parseBRLInput("50.25")).toBe(5025);
  });

  it("returns 0 for empty string", () => {
    expect(parseBRLInput("")).toBe(0);
  });

  it("returns 0 for garbage input", () => {
    expect(parseBRLInput("abc")).toBe(0);
  });

  it("returns 0 for NaN-producing input", () => {
    expect(parseBRLInput("...")).toBe(0);
  });

  it("parses cents-only input", () => {
    expect(parseBRLInput("0,99")).toBe(99);
  });
});

describe("sanitizeDecimalInput", () => {
  it("allows digits and comma", () => {
    expect(sanitizeDecimalInput("100,00")).toBe("100,00");
  });

  it("strips letters and special chars, keeps digits and comma", () => {
    expect(sanitizeDecimalInput("R$ 100,00")).toBe("100,00");
  });

  it("strips special chars but keeps comma", () => {
    expect(sanitizeDecimalInput("1.234,56")).toBe("1234,56");
  });

  it("returns empty for no valid chars", () => {
    expect(sanitizeDecimalInput("$@!")).toBe("");
  });
});
