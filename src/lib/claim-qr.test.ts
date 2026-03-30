import { describe, expect, it } from "vitest";
import { parseClaimQrCode } from "./claim-qr";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("parseClaimQrCode", () => {
  it("parses a full HTTPS claim URL", () => {
    const result = parseClaimQrCode(`https://pagajaja.app/claim/${UUID}`);
    expect(result).toEqual({ token: UUID, url: `https://pagajaja.app/claim/${UUID}` });
  });

  it("parses a localhost claim URL", () => {
    const result = parseClaimQrCode(`http://localhost:3000/claim/${UUID}`);
    expect(result?.token).toBe(UUID);
  });

  it("parses a relative path", () => {
    const result = parseClaimQrCode(`/claim/${UUID}`);
    expect(result?.token).toBe(UUID);
  });

  it("returns null for non-claim URLs", () => {
    expect(parseClaimQrCode("https://nfce.fazenda.sp.gov.br/consulta")).toBeNull();
    expect(parseClaimQrCode("https://pagajaja.app/app")).toBeNull();
    expect(parseClaimQrCode("not a url")).toBeNull();
  });

  it("returns null for invalid UUID format", () => {
    expect(parseClaimQrCode("https://pagajaja.app/claim/not-a-uuid")).toBeNull();
    expect(parseClaimQrCode("https://pagajaja.app/claim/12345")).toBeNull();
  });

  it("is case-insensitive for hex digits", () => {
    const upper = UUID.toUpperCase();
    const result = parseClaimQrCode(`https://pagajaja.app/claim/${upper}`);
    expect(result?.token).toBe(upper);
  });

  it("trims whitespace", () => {
    const result = parseClaimQrCode(`  https://pagajaja.app/claim/${UUID}  `);
    expect(result?.token).toBe(UUID);
  });
});
