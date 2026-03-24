import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptPixKey, encryptPixKey } from "./crypto";

const TEST_KEY = "aa".repeat(32);

beforeAll(() => {
  process.env.PIX_ENCRYPTION_KEY = TEST_KEY;
});

afterAll(() => {
  delete process.env.PIX_ENCRYPTION_KEY;
});

describe("encryptPixKey / decryptPixKey", () => {
  it("round-trips an email key", () => {
    const original = "user@example.com";
    expect(decryptPixKey(encryptPixKey(original))).toBe(original);
  });

  it("round-trips a phone key", () => {
    const original = "+5511999998888";
    expect(decryptPixKey(encryptPixKey(original))).toBe(original);
  });

  it("round-trips a CPF key", () => {
    const original = "12345678901";
    expect(decryptPixKey(encryptPixKey(original))).toBe(original);
  });

  it("round-trips a UUID key", () => {
    const original = "550e8400-e29b-41d4-a716-446655440000";
    expect(decryptPixKey(encryptPixKey(original))).toBe(original);
  });

  it("produces different ciphertext each call (random IV)", () => {
    const key = "user@example.com";
    expect(encryptPixKey(key)).not.toBe(encryptPixKey(key));
  });

  it("output format is base64:base64:base64", () => {
    const encrypted = encryptPixKey("test");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);
    const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
    for (const part of parts) {
      expect(part).toMatch(base64Pattern);
    }
  });
});

describe("encryptPixKey error handling", () => {
  it("throws when PIX_ENCRYPTION_KEY is missing", () => {
    const saved = process.env.PIX_ENCRYPTION_KEY;
    delete process.env.PIX_ENCRYPTION_KEY;
    expect(() => encryptPixKey("test")).toThrow("PIX_ENCRYPTION_KEY must be");
    process.env.PIX_ENCRYPTION_KEY = saved;
  });

  it("throws when PIX_ENCRYPTION_KEY has wrong length", () => {
    const saved = process.env.PIX_ENCRYPTION_KEY;
    process.env.PIX_ENCRYPTION_KEY = "aa".repeat(16);
    expect(() => encryptPixKey("test")).toThrow("PIX_ENCRYPTION_KEY must be");
    process.env.PIX_ENCRYPTION_KEY = saved;
  });
});

describe("decryptPixKey error handling", () => {
  it("throws for empty input", () => {
    expect(() => decryptPixKey("")).toThrow("No encrypted key provided");
  });

  it("throws for wrong number of parts", () => {
    expect(() => decryptPixKey("only:two")).toThrow("Invalid encrypted key format");
  });

  it("throws when ciphertext is tampered", () => {
    const encrypted = encryptPixKey("secret");
    const parts = encrypted.split(":");
    const tampered = parts[0] + ":" + parts[1] + ":" + "AAAA" + parts[2].slice(4);
    expect(() => decryptPixKey(tampered)).toThrow();
  });
});
