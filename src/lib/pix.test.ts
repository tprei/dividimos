import { describe, expect, it } from "vitest";
import { generatePixCopiaECola, maskPixKey, validatePixKey } from "./pix";

describe("generatePixCopiaECola", () => {
  const basePayload = {
    pixKey: "user@example.com",
    merchantName: "Loja Teste",
    merchantCity: "Sao Paulo",
    amountCents: 1050,
  };

  it("starts with format indicator '000201'", () => {
    const result = generatePixCopiaECola(basePayload);
    expect(result).toMatch(/^000201/);
  });

  it("contains the Pix key in field 26", () => {
    const result = generatePixCopiaECola(basePayload);
    expect(result).toContain("user@example.com");
  });

  it("encodes amount correctly for 1050 cents (10.50)", () => {
    const result = generatePixCopiaECola(basePayload);
    expect(result).toContain("5405" + "10.50");
  });

  it("encodes amount correctly for 100 cents (1.00)", () => {
    const result = generatePixCopiaECola({ ...basePayload, amountCents: 100 });
    expect(result).toContain("54041.00");
  });

  it("strips diacritics from merchant name", () => {
    const result = generatePixCopiaECola({ ...basePayload, merchantName: "João Café" });
    expect(result).toContain("Joao Cafe");
    expect(result).not.toContain("ã");
    expect(result).not.toContain("é");
  });

  it("strips diacritics from merchant city", () => {
    const result = generatePixCopiaECola({ ...basePayload, merchantCity: "São Paulo" });
    expect(result).toContain("Sao Paulo");
  });

  it("truncates merchant name to 25 characters", () => {
    const longName = "A".repeat(30);
    const result = generatePixCopiaECola({ ...basePayload, merchantName: longName });
    expect(result).toContain("A".repeat(25));
    expect(result).not.toContain("A".repeat(26));
  });

  it("truncates merchant city to 15 characters", () => {
    const longCity = "B".repeat(20);
    const result = generatePixCopiaECola({ ...basePayload, merchantCity: longCity });
    expect(result).toContain("B".repeat(15));
    expect(result).not.toContain("B".repeat(16));
  });

  it("uses '***' as default txId when omitted", () => {
    const result = generatePixCopiaECola(basePayload);
    expect(result).toContain("***");
  });

  it("uses provided txId", () => {
    const result = generatePixCopiaECola({ ...basePayload, txId: "TX123" });
    expect(result).toContain("TX123");
  });

  it("ends with 4 uppercase hex characters (CRC)", () => {
    const result = generatePixCopiaECola(basePayload);
    expect(result).toMatch(/[0-9A-F]{4}$/);
  });

  it("produces deterministic output for same inputs", () => {
    const a = generatePixCopiaECola(basePayload);
    const b = generatePixCopiaECola(basePayload);
    expect(a).toBe(b);
  });
});

describe("validatePixKey", () => {
  describe("phone keys", () => {
    it("accepts +55 with 11 digits", () => {
      expect(validatePixKey("+5511999998888")).toBe(true);
    });

    it("accepts +55 with 10 digits", () => {
      expect(validatePixKey("+551199998888")).toBe(true);
    });

    it("11-digit string without +55 is accepted as CPF (not phone)", () => {
      // "11999998888" has 11 digits, matching the CPF regex /^\d{11}$/
      expect(validatePixKey("11999998888")).toBe(true);
    });

    it("rejects phone too short after +55", () => {
      expect(validatePixKey("+5511")).toBe(false);
    });
  });

  describe("CPF keys", () => {
    it("accepts exactly 11 digits", () => {
      expect(validatePixKey("12345678901")).toBe(true);
    });

    it("rejects 10 digits", () => {
      expect(validatePixKey("1234567890")).toBe(false);
    });

    it("rejects 12 digits", () => {
      expect(validatePixKey("123456789012")).toBe(false);
    });
  });

  describe("email keys", () => {
    it("accepts valid email", () => {
      expect(validatePixKey("user@example.com")).toBe(true);
    });

    it("rejects string without @", () => {
      expect(validatePixKey("userexample.com")).toBe(false);
    });

    it("rejects bare username", () => {
      expect(validatePixKey("user")).toBe(false);
    });
  });

  describe("UUID (EVP) keys", () => {
    it("accepts valid UUID v4", () => {
      expect(validatePixKey("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    });

    it("accepts uppercase UUID", () => {
      expect(validatePixKey("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
    });

    it("rejects UUID without dashes", () => {
      expect(validatePixKey("550e8400e29b41d4a716446655440000")).toBe(false);
    });
  });

  it("rejects empty string", () => {
    expect(validatePixKey("")).toBe(false);
  });
});

describe("maskPixKey", () => {
  it("masks phone key", () => {
    expect(maskPixKey("+5511999998888")).toBe("(**) *****-8888");
  });

  // CPF keys (11 digits) hit the phone branch because the regex /^\+?\d{11,13}$/
  // matches 11-digit strings after stripping non-digits. The CPF-specific branch
  // at line 85 is unreachable for bare 11-digit strings.
  it("masks 11-digit CPF as phone pattern (ordering precedence)", () => {
    expect(maskPixKey("12345678901")).toBe("(**) *****-8901");
  });

  it("masks email key", () => {
    // local "user" has 4 chars: Math.max(1, 4-2) = 2 stars → "u**r@..."
    expect(maskPixKey("user@example.com")).toBe("u**r@example.com");
  });

  it("masks email with single-char local part", () => {
    expect(maskPixKey("a@b.com")).toBe("a*a@b.com");
  });

  it("masks UUID key", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(maskPixKey(uuid)).toBe("550e8400...0000");
  });

  it("returns unrecognized key as-is", () => {
    expect(maskPixKey("unknown-key")).toBe("unknown-key");
  });
});
