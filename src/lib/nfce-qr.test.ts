import { describe, expect, it } from "vitest";
import { parseNfceQrCode, validateChaveAcesso } from "./nfce-qr";

// A valid 44-digit key with correct mod-11 check digit
// UF=35(SP), AAMM=2401, CNPJ=12345678901234, mod=65, serie=001, num=000000001, tpEmis=1, cNF=12345678, cDV=?
// We'll compute a real one for testing
function makeValidChave(): string {
  const base = "3524011234567890123465001000000001112345678";
  // Compute check digit (mod 11, weights 2-9 cycling right to left)
  const digits = base.split("").map(Number);
  let sum = 0;
  let weight = 2;
  for (let i = 42; i >= 0; i--) {
    sum += digits[i] * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const checkDigit = remainder < 2 ? 0 : 11 - remainder;
  return base + checkDigit;
}

const VALID_CHAVE = makeValidChave();

describe("parseNfceQrCode", () => {
  it("returns null for non-URL strings", () => {
    expect(parseNfceQrCode("not a url")).toBeNull();
    expect(parseNfceQrCode("12345")).toBeNull();
    expect(parseNfceQrCode("")).toBeNull();
  });

  it("returns null for non-HTTP protocols", () => {
    expect(parseNfceQrCode(`ftp://nfce.sefaz.example.com?chNFe=${VALID_CHAVE}`)).toBeNull();
  });

  it("extracts chave from chNFe query parameter", () => {
    const url = `https://nfce.sefaz.sp.gov.br/consulta?chNFe=${VALID_CHAVE}`;
    const result = parseNfceQrCode(url);
    expect(result).not.toBeNull();
    expect(result!.chaveAcesso).toBe(VALID_CHAVE);
    expect(result!.url).toBe(url);
  });

  it("extracts chave from pipe-delimited p parameter", () => {
    const url = `https://nfce.fazenda.sp.gov.br/consulta?p=${VALID_CHAVE}|2|1|1|abc`;
    const result = parseNfceQrCode(url);
    expect(result).not.toBeNull();
    expect(result!.chaveAcesso).toBe(VALID_CHAVE);
  });

  it("extracts chave from URL path", () => {
    const url = `https://nfce.sefaz.rs.gov.br/nfce/${VALID_CHAVE}/view`;
    const result = parseNfceQrCode(url);
    expect(result).not.toBeNull();
    expect(result!.chaveAcesso).toBe(VALID_CHAVE);
  });

  it("recognizes various SEFAZ domain patterns", () => {
    const domains = [
      "nfce.sefaz.sp.gov.br",
      "nfc-e.fazenda.mg.gov.br",
      "sat.sef.sc.gov.br",
      "nfe.svrs.rs.gov.br",
      "dfe-portal.sefaz.am.gov.br",
    ];

    for (const domain of domains) {
      const url = `https://${domain}/consulta?chNFe=${VALID_CHAVE}`;
      const result = parseNfceQrCode(url);
      expect(result, `should parse URL with domain ${domain}`).not.toBeNull();
      expect(result!.chaveAcesso).toBe(VALID_CHAVE);
    }
  });

  it("returns null for URLs without 44-digit key", () => {
    expect(parseNfceQrCode("https://nfce.sefaz.sp.gov.br/consulta?chNFe=123")).toBeNull();
    expect(parseNfceQrCode("https://example.com/page")).toBeNull();
  });

  it("trims whitespace from input", () => {
    const url = `  https://nfce.sefaz.sp.gov.br/consulta?chNFe=${VALID_CHAVE}  `;
    const result = parseNfceQrCode(url);
    expect(result).not.toBeNull();
    expect(result!.chaveAcesso).toBe(VALID_CHAVE);
  });
});

describe("validateChaveAcesso", () => {
  it("returns true for a valid chave with correct check digit", () => {
    expect(validateChaveAcesso(VALID_CHAVE)).toBe(true);
  });

  it("returns false for wrong length", () => {
    expect(validateChaveAcesso("123")).toBe(false);
    expect(validateChaveAcesso(VALID_CHAVE + "0")).toBe(false);
  });

  it("returns false for non-numeric strings", () => {
    expect(validateChaveAcesso("a".repeat(44))).toBe(false);
  });

  it("returns false when check digit is wrong", () => {
    // Flip the last digit
    const lastDigit = Number(VALID_CHAVE[43]);
    const wrongDigit = (lastDigit + 1) % 10;
    const wrongChave = VALID_CHAVE.slice(0, 43) + wrongDigit;
    expect(validateChaveAcesso(wrongChave)).toBe(false);
  });
});
