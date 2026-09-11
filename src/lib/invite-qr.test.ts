import { describe, expect, it, vi } from "vitest";
import { PRODUCTION_CLAIM_ORIGIN } from "./claim-qr";
import {
  INVITE_TOKEN_RE,
  parseGroupInviteQrCode,
  parseProfileQrCode,
} from "./invite-qr";

const TOKEN = "a".repeat(32);
const production = (path: string) => `${PRODUCTION_CLAIM_ORIGIN}${path}`;

describe("INVITE_TOKEN_RE", () => {
  it("accepts exactly 32 base64url characters", () => {
    expect(INVITE_TOKEN_RE.test(TOKEN)).toBe(true);
    expect(INVITE_TOKEN_RE.test("a".repeat(31))).toBe(false);
    expect(INVITE_TOKEN_RE.test("a".repeat(33))).toBe(false);
    expect(INVITE_TOKEN_RE.test("a".repeat(32) + "!")).toBe(false);
  });
});

describe("parseGroupInviteQrCode", () => {
  it("accepts a production join URL", () => {
    expect(parseGroupInviteQrCode(production(`/join/${TOKEN}`))).toEqual({ token: TOKEN });
  });

  it("accepts a loopback join URL outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(parseGroupInviteQrCode(`http://localhost:3000/join/${TOKEN}`)).toEqual({
      token: TOKEN,
    });
    vi.unstubAllEnvs();
  });

  it("rejects a wrong-length token", () => {
    expect(parseGroupInviteQrCode(production(`/join/${"a".repeat(31)}`))).toBeNull();
  });

  it("rejects a foreign origin", () => {
    expect(parseGroupInviteQrCode(`https://evil.example.com/join/${TOKEN}`)).toBeNull();
  });

  it("rejects query strings and fragments", () => {
    expect(parseGroupInviteQrCode(production(`/join/${TOKEN}?x=1`))).toBeNull();
    expect(parseGroupInviteQrCode(production(`/join/${TOKEN}#frag`))).toBeNull();
  });

  it("rejects lookalike paths and whitespace", () => {
    expect(parseGroupInviteQrCode(production(`/joinx/${TOKEN}`))).toBeNull();
    expect(parseGroupInviteQrCode(production(`/join/${TOKEN}/`))).toBeNull();
    expect(parseGroupInviteQrCode(` ${production(`/join/${TOKEN}`)}`)).toBeNull();
  });
});

describe("parseProfileQrCode", () => {
  it("accepts a profile URL and lowercases the handle", () => {
    expect(parseProfileQrCode(production("/u/Fulano"))).toEqual({ handle: "fulano" });
  });

  it("rejects handles that are too short", () => {
    expect(parseProfileQrCode(production("/u/ab"))).toBeNull();
  });

  it("rejects whitespace in the payload", () => {
    expect(parseProfileQrCode(production("/u/nome com espaço"))).toBeNull();
  });

  it("rejects a path-like handle", () => {
    expect(parseProfileQrCode(production("/u/ana/more"))).toBeNull();
  });
});
