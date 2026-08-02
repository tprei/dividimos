import { describe, expect, it, vi } from "vitest";
import {
  buildClaimUrl,
  CLAIM_TOKEN_RE,
  parseClaimQrCode,
  PRODUCTION_CLAIM_ORIGIN,
} from "./claim-qr";

const TOKEN = "gst1_" + "a".repeat(43);

describe("CLAIM_TOKEN_RE", () => {
  it("accepts a well-formed credential", () => {
    expect(CLAIM_TOKEN_RE.test(TOKEN)).toBe(true);
  });

  it("rejects credentials that are too short or too long", () => {
    expect(CLAIM_TOKEN_RE.test("gst1_" + "a".repeat(42))).toBe(false);
    expect(CLAIM_TOKEN_RE.test("gst1_" + "a".repeat(44))).toBe(false);
  });

  it("rejects other prefixes and bare tokens", () => {
    expect(CLAIM_TOKEN_RE.test("gst2_" + "a".repeat(43))).toBe(false);
    expect(CLAIM_TOKEN_RE.test("a".repeat(48))).toBe(false);
  });
});

describe("parseClaimQrCode", () => {
  describe("accepts", () => {
    it("parses a production-origin fragment URL", () => {
      const result = parseClaimQrCode(`${PRODUCTION_CLAIM_ORIGIN}/claim#${TOKEN}`);
      expect(result).toEqual({ token: TOKEN, url: `/claim#${TOKEN}` });
    });

    it("parses a relative /claim#<token> input", () => {
      const result = parseClaimQrCode(`/claim#${TOKEN}`);
      expect(result).toEqual({ token: TOKEN, url: `/claim#${TOKEN}` });
    });

    it("parses a localhost dev URL in non-production", () => {
      const result = parseClaimQrCode(`http://localhost:3000/claim#${TOKEN}`);
      expect(result?.token).toBe(TOKEN);
    });

    it("parses a 127.0.0.1 dev URL in non-production", () => {
      const result = parseClaimQrCode(`http://127.0.0.1:5173/claim#${TOKEN}`);
      expect(result?.token).toBe(TOKEN);
    });

    it("parses an IPv6 loopback dev URL in non-production", () => {
      const result = parseClaimQrCode(`http://[::1]:8080/claim#${TOKEN}`);
      expect(result?.token).toBe(TOKEN);
    });

    it("returns the local path as url, never the origin", () => {
      const result = parseClaimQrCode(`${PRODUCTION_CLAIM_ORIGIN}/claim#${TOKEN}`);
      expect(result?.url).toBe(`/claim#${TOKEN}`);
      expect(result?.url).not.toContain("dividimos.ai");
    });
  });

  describe("rejects path-style and apex inputs", () => {
    it("rejects /claim/<token> (path transport)", () => {
      expect(parseClaimQrCode(`${PRODUCTION_CLAIM_ORIGIN}/claim/${TOKEN}`)).toBeNull();
    });

    it("rejects a relative /claim/<token>", () => {
      expect(parseClaimQrCode(`/claim/${TOKEN}`)).toBeNull();
    });

    it("rejects the apex origin", () => {
      expect(parseClaimQrCode(`https://dividimos.ai/claim#${TOKEN}`)).toBeNull();
    });

    it("rejects a subdomain", () => {
      expect(parseClaimQrCode(`https://app.dividimos.ai/claim#${TOKEN}`)).toBeNull();
    });

    it("rejects http (downgraded) on the production host", () => {
      expect(parseClaimQrCode(`http://www.dividimos.ai/claim#${TOKEN}`)).toBeNull();
    });

    it("rejects an unrelated host", () => {
      expect(parseClaimQrCode(`https://evil.com/claim#${TOKEN}`)).toBeNull();
    });
  });

  describe("rejects whitespace", () => {
    it("rejects a leading space (never trimmed)", () => {
      expect(parseClaimQrCode(` ${PRODUCTION_CLAIM_ORIGIN}/claim#${TOKEN}`)).toBeNull();
    });

    it("rejects a trailing newline", () => {
      expect(parseClaimQrCode(`${PRODUCTION_CLAIM_ORIGIN}/claim#${TOKEN}\n`)).toBeNull();
    });

    it("rejects a unicode space inside the payload", () => {
      expect(
        parseClaimQrCode(`${PRODUCTION_CLAIM_ORIGIN}/claim#${TOKEN}\u00a0`),
      ).toBeNull();
    });
  });

  describe("rejects malformed fragments", () => {
    it("rejects a raw uuid in the fragment", () => {
      expect(
        parseClaimQrCode(`${PRODUCTION_CLAIM_ORIGIN}/claim#550e8400-e29b-41d4-a716-446655440000`),
      ).toBeNull();
    });

    it("rejects a raw uuid (uppercase) in the fragment", () => {
      expect(
        parseClaimQrCode(`${PRODUCTION_CLAIM_ORIGIN}/claim#550E8400-E29B-41D4-A716-446655440000`),
      ).toBeNull();
    });

    it("rejects a bare token with no /claim path", () => {
      expect(parseClaimQrCode(TOKEN)).toBeNull();
    });

    it("rejects a fragment with extra suffix", () => {
      expect(parseClaimQrCode(`${PRODUCTION_CLAIM_ORIGIN}/claim#${TOKEN}x`)).toBeNull();
      expect(parseClaimQrCode(`${PRODUCTION_CLAIM_ORIGIN}/claim#${TOKEN}#more`)).toBeNull();
    });

    it("rejects an empty fragment", () => {
      expect(parseClaimQrCode(`${PRODUCTION_CLAIM_ORIGIN}/claim#`)).toBeNull();
    });

    it("rejects a query string", () => {
      expect(
        parseClaimQrCode(`${PRODUCTION_CLAIM_ORIGIN}/claim?x=1#${TOKEN}`),
      ).toBeNull();
    });

    it("rejects a non-gst1 prefix", () => {
      expect(
        parseClaimQrCode(`${PRODUCTION_CLAIM_ORIGIN}/claim#${"inv_" + "a".repeat(43)}`),
      ).toBeNull();
    });
  });

  describe("rejects garbage", () => {
    it("returns null for non-claim URLs", () => {
      expect(parseClaimQrCode("https://nfce.fazenda.sp.gov.br/consulta")).toBeNull();
      expect(parseClaimQrCode(`${PRODUCTION_CLAIM_ORIGIN}/app`)).toBeNull();
      expect(parseClaimQrCode("not a url")).toBeNull();
      expect(parseClaimQrCode("")).toBeNull();
    });
  });
});

describe("buildClaimUrl", () => {
  it("builds a production-origin fragment URL in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(buildClaimUrl(TOKEN)).toBe(`${PRODUCTION_CLAIM_ORIGIN}/claim#${TOKEN}`);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("uses the window origin otherwise", () => {
    expect(buildClaimUrl(TOKEN)).toBe(`${window.location.origin}/claim#${TOKEN}`);
  });
});
