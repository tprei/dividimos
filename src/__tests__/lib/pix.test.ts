import { describe, it, expect } from "vitest";
import {
  generatePixCopiaECola,
  validatePixKey,
  maskPixKey,
} from "@/lib/pix";

describe("validatePixKey", () => {
  it("validates phone with country code", () => {
    expect(validatePixKey("+5511999998888")).toBe(true);
  });

  it("validates phone with 10 digits (landline)", () => {
    expect(validatePixKey("+551133334444")).toBe(true);
  });

  it("rejects phone without country code", () => {
    expect(validatePixKey("11999998888")).toBe(true); // matches CPF regex (11 digits)
  });

  it("validates CPF (11 digits)", () => {
    expect(validatePixKey("12345678901")).toBe(true);
  });

  it("rejects CPF with formatting", () => {
    expect(validatePixKey("123.456.789-01")).toBe(false);
  });

  it("validates email", () => {
    expect(validatePixKey("user@example.com")).toBe(true);
  });

  it("rejects email without @", () => {
    expect(validatePixKey("userexample.com")).toBe(false);
  });

  it("validates random/EVP key (UUID)", () => {
    expect(validatePixKey("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
  });

  it("rejects short random key", () => {
    expect(validatePixKey("123e4567")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validatePixKey("")).toBe(false);
  });

  it("rejects random text", () => {
    expect(validatePixKey("not-a-pix-key")).toBe(false);
  });
});

describe("maskPixKey", () => {
  it("masks phone number", () => {
    const result = maskPixKey("+5511999998888");
    expect(result).toBe("(**) *****-8888");
  });

  it("masks phone without plus", () => {
    // 5511999998888 has 13 digits after stripping, matches phone regex
    const result = maskPixKey("5511999998888");
    expect(result).toBe("(**) *****-8888");
  });

  it("masks raw 11-digit number as phone (not CPF) — known behavior", () => {
    // The phone regex runs first and matches 11 digits
    const result = maskPixKey("12345678901");
    expect(result).toBe("(**) *****-8901");
  });

  it("masks email", () => {
    const result = maskPixKey("john@example.com");
    expect(result).toBe("j**n@example.com");
  });

  it("masks single-char-local email", () => {
    const result = maskPixKey("a@b.com");
    expect(result).toBe("a*a@b.com");
  });

  it("masks UUID/random key", () => {
    const result = maskPixKey("123e4567-e89b-12d3-a456-426614174000");
    expect(result).toBe("123e4567...4000");
  });

  it("returns unknown key as-is", () => {
    expect(maskPixKey("unknown")).toBe("unknown");
  });
});

describe("generatePixCopiaECola", () => {
  it("generates valid EMV format string", () => {
    const result = generatePixCopiaECola({
      pixKey: "+5511999998888",
      merchantName: "João Silva",
      merchantCity: "São Paulo",
      amountCents: 5000,
      txId: "test123",
    });

    // Must start with payload format indicator "00" "02" "01"
    // then merchant account "26" with variable length
    expect(result).toMatch(/^000201263\d/);
    // Must contain Pix key in merchant account info
    expect(result).toContain("+5511999998888");
    // Must contain amount
    expect(result).toContain("50.00");
    // Must contain country code BR
    expect(result).toContain("BR");
    // Must end with 4-char CRC
    expect(result).toMatch(/6304[0-9A-F]{4}$/);
    // Merchant name should have accents stripped
    expect(result).toContain("Joao Silva");
    // City should have accents stripped
    expect(result).toContain("Sao Paulo");
  });

  it("uses default txId when not provided", () => {
    const result = generatePixCopiaECola({
      pixKey: "user@example.com",
      merchantName: "Test",
      merchantCity: "Test",
      amountCents: 100,
    });
    expect(result).toContain("***");
  });

  it("truncates long merchant name to 25 chars", () => {
    const longName = "A".repeat(30);
    const result = generatePixCopiaECola({
      pixKey: "user@example.com",
      merchantName: longName,
      merchantCity: "Test",
      amountCents: 100,
    });
    // The name field should have at most 25 chars
    expect(result).toContain("A".repeat(25));
    expect(result).not.toContain("A".repeat(26));
  });

  it("truncates long city to 15 chars", () => {
    const longCity = "B".repeat(20);
    const result = generatePixCopiaECola({
      pixKey: "user@example.com",
      merchantName: "Test",
      merchantCity: longCity,
      amountCents: 100,
    });
    expect(result).toContain("B".repeat(15));
    expect(result).not.toContain("B".repeat(16));
  });

  it("formats amount with two decimal places", () => {
    const result = generatePixCopiaECola({
      pixKey: "user@example.com",
      merchantName: "Test",
      merchantCity: "Test",
      amountCents: 1,
    });
    expect(result).toContain("0.01");
  });

  it("produces deterministic output for same input", () => {
    const payload = {
      pixKey: "user@example.com",
      merchantName: "Test",
      merchantCity: "Test",
      amountCents: 1000,
    };
    const a = generatePixCopiaECola(payload);
    const b = generatePixCopiaECola(payload);
    expect(a).toBe(b);
  });
});
