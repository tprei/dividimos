import { describe, expect, it } from "vitest";
import { parseJoinQrCode } from "./join-qr";

const TOKEN = "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";

describe("parseJoinQrCode", () => {
  it("reads the payload the invite modal advertises", () => {
    expect(parseJoinQrCode(`https://www.dividimos.ai/join/${TOKEN}`)).toEqual({
      token: TOKEN,
      url: `/join/${TOKEN}`,
    });
  });

  it("accepts a relative path against the production origin", () => {
    expect(parseJoinQrCode(`/join/${TOKEN}`)?.url).toBe(`/join/${TOKEN}`);
  });

  it("refuses a foreign origin", () => {
    expect(parseJoinQrCode(`https://evil.example.com/join/${TOKEN}`)).toBeNull();
  });

  it("refuses anything that is not exactly one invite token", () => {
    expect(parseJoinQrCode("https://www.dividimos.ai/join/not-a-uuid")).toBeNull();
    expect(parseJoinQrCode(`https://www.dividimos.ai/join/${TOKEN}/extra`)).toBeNull();
    expect(parseJoinQrCode("https://www.dividimos.ai/join")).toBeNull();
    // A claim credential is a different transport and must not resolve here.
    expect(parseJoinQrCode(`https://www.dividimos.ai/claim#gst1_${"a".repeat(43)}`)).toBeNull();
  });

  it("refuses a payload carrying extra data", () => {
    expect(parseJoinQrCode(`https://www.dividimos.ai/join/${TOKEN}?ref=x`)).toBeNull();
    expect(parseJoinQrCode(`https://www.dividimos.ai/join/${TOKEN}#frag`)).toBeNull();
    expect(parseJoinQrCode(` https://www.dividimos.ai/join/${TOKEN}`)).toBeNull();
  });
});
