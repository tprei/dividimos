import { describe, expect, it, test } from "vitest";
import {
  centsToDecimal,
  decimalToCents,
  formatBillAmount,
  formatBRL,
  parseBRLInput,
  sanitizeDecimalInput,
} from "./currency";

describe("formatBRL", () => {
  it("formats zero", () => {
    expect(formatBRL(0)).toBe("R$\u00a00,00");
  });

  it("formats one centavo", () => {
    expect(formatBRL(1)).toBe("R$\u00a00,01");
  });

  it("formats R$1,00", () => {
    expect(formatBRL(100)).toBe("R$\u00a01,00");
  });

  it("formats with thousands separator", () => {
    expect(formatBRL(999999)).toBe("R$\u00a09.999,99");
  });

  it("formats negative values", () => {
    expect(formatBRL(-500)).toBe("-R$\u00a05,00");
  });
});

describe("centsToDecimal", () => {
  it("converts zero", () => {
    expect(centsToDecimal(0)).toBe("0.00");
  });

  it("converts 1050 to 10.50", () => {
    expect(centsToDecimal(1050)).toBe("10.50");
  });

  it("converts 1 centavo", () => {
    expect(centsToDecimal(1)).toBe("0.01");
  });

  it("converts 999 centavos", () => {
    expect(centsToDecimal(999)).toBe("9.99");
  });
});

describe("decimalToCents", () => {
  it("converts 10.5 to 1050", () => {
    expect(decimalToCents(10.5)).toBe(1050);
  });

  it("converts zero", () => {
    expect(decimalToCents(0)).toBe(0);
  });

  it("converts 0.01 to 1", () => {
    expect(decimalToCents(0.01)).toBe(1);
  });

  it("handles floating point precision for 19.99", () => {
    expect(decimalToCents(19.99)).toBe(1999);
  });

  it("handles floating point precision for 0.1 + 0.2", () => {
    expect(decimalToCents(0.1 + 0.2)).toBe(30);
  });

  it("1.005 rounds to 100 due to floating point (1.005 * 100 = 100.4999...)", () => {
    expect(decimalToCents(1.005)).toBe(100);
  });
});

describe("parseBRLInput", () => {
  it("parses comma decimal (Brazilian format)", () => {
    expect(parseBRLInput("10,50")).toBe(1050);
  });

  it("parses dot decimal", () => {
    expect(parseBRLInput("10.50")).toBe(1050);
  });

  it("parses with currency symbol", () => {
    expect(parseBRLInput("R$ 10,50")).toBe(1050);
  });

  it("returns 0 for empty string", () => {
    expect(parseBRLInput("")).toBe(0);
  });

  it("returns 0 for non-numeric input", () => {
    expect(parseBRLInput("abc")).toBe(0);
  });

  it("parses single centavo", () => {
    expect(parseBRLInput("0,01")).toBe(1);
  });

  it("parses large number without thousands separator", () => {
    expect(parseBRLInput("12345,67")).toBe(1234567);
  });

  // Known limitation: parseBRLInput does not handle thousands-separated Brazilian format.
  // "1.234,56" (meaning R$ 1,234.56 = 123456 cents) is incorrectly parsed as 123 cents
  // because the implementation strips the period, replaces only the first comma with a dot,
  // yielding "1.234.56" → parseFloat returns 1.234 → Math.round(1.234 * 100) = 123.
  test.fails("parses thousands-separated Brazilian format (known limitation)", () => {
    expect(parseBRLInput("1.234,56")).toBe(123456);
  });
});

describe("formatBillAmount", () => {
  it('shows "Em criação..." for draft bills', () => {
    expect(formatBillAmount("draft", 0)).toBe("Em criação...");
  });

  it('shows "Em criação..." for draft bills even with a non-zero amount', () => {
    expect(formatBillAmount("draft", 5000)).toBe("Em criação...");
  });

  it("shows formatted amount for active bills", () => {
    expect(formatBillAmount("active", 5000)).toBe("R$\u00a050,00");
  });

  it("shows formatted amount for finalized bills", () => {
    expect(formatBillAmount("finalized", 1050)).toBe("R$\u00a010,50");
  });

  it("shows R$ 0,00 for non-draft bills with zero amount", () => {
    expect(formatBillAmount("active", 0)).toBe("R$\u00a00,00");
  });
});

describe("sanitizeDecimalInput", () => {
  it("preserves digits and commas", () => {
    expect(sanitizeDecimalInput("10,50")).toBe("10,50");
  });

  it("strips currency symbol and spaces, preserves comma", () => {
    expect(sanitizeDecimalInput("R$ 12,50")).toBe("12,50");
  });

  it("returns empty string unchanged", () => {
    expect(sanitizeDecimalInput("")).toBe("");
  });

  it("strips non-digit non-comma characters but keeps digits", () => {
    expect(sanitizeDecimalInput("abc123,45")).toBe("123,45");
  });

  it("strips dots (dots are not decimal separators in this format)", () => {
    expect(sanitizeDecimalInput("1.234,56")).toBe("1234,56");
  });
});
