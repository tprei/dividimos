import { beforeEach, describe, expect, it } from "vitest";
import {
  clearClaimToken,
  readClaimToken,
  readClaimTokenEntry,
  writeClaimToken,
} from "./claim-token-cache";

const HOUR = 60 * 60 * 1000;
const future = () => new Date(Date.now() + HOUR).toISOString();
const past = () => new Date(Date.now() - HOUR).toISOString();

describe("claim-token-cache", () => {
  const guestId = "guest-1";

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a token per guest", () => {
    expect(readClaimToken(guestId)).toBeNull();

    writeClaimToken(guestId, "gst1_abc", future());
    expect(readClaimToken(guestId)).toBe("gst1_abc");

    writeClaimToken(guestId, "gst1_def", future());
    expect(readClaimToken(guestId)).toBe("gst1_def");
  });

  it("keeps tokens isolated per guest", () => {
    writeClaimToken("guest-1", "gst1_abc", future());
    writeClaimToken("guest-2", "gst1_def", future());

    expect(readClaimToken("guest-1")).toBe("gst1_abc");
    expect(readClaimToken("guest-2")).toBe("gst1_def");
  });

  it("drops the token on clear and leaves other guests untouched", () => {
    writeClaimToken("guest-1", "gst1_abc", future());
    writeClaimToken("guest-2", "gst1_def", future());

    clearClaimToken("guest-1");

    expect(readClaimToken("guest-1")).toBeNull();
    expect(readClaimToken("guest-2")).toBe("gst1_def");
  });

  it("exposes the expiry alongside the token", () => {
    const expiresAt = future();
    writeClaimToken(guestId, "gst1_abc", expiresAt);

    expect(readClaimTokenEntry(guestId)).toEqual({ token: "gst1_abc", expiresAt });
  });

  it("forgets an expired token instead of returning it", () => {
    writeClaimToken(guestId, "gst1_abc", past());

    expect(readClaimToken(guestId)).toBeNull();
    expect(window.localStorage.getItem(`dividimos:claim-token:${guestId}`)).toBeNull();
  });

  it("forgets a value written before the expiry was tracked", () => {
    window.localStorage.setItem(`dividimos:claim-token:${guestId}`, "gst1_legacy");

    expect(readClaimToken(guestId)).toBeNull();
    expect(window.localStorage.getItem(`dividimos:claim-token:${guestId}`)).toBeNull();
  });
});
