import { beforeEach, describe, expect, it } from "vitest";
import {
  clearClaimToken,
  readClaimToken,
  writeClaimToken,
} from "./claim-token-cache";

describe("claim-token-cache", () => {
  const guestId = "guest-1";

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a token per guest", () => {
    expect(readClaimToken(guestId)).toBeNull();

    writeClaimToken(guestId, "gst1_abc");
    expect(readClaimToken(guestId)).toBe("gst1_abc");

    writeClaimToken(guestId, "gst1_def");
    expect(readClaimToken(guestId)).toBe("gst1_def");
  });

  it("keeps tokens isolated per guest", () => {
    writeClaimToken("guest-1", "gst1_abc");
    writeClaimToken("guest-2", "gst1_def");

    expect(readClaimToken("guest-1")).toBe("gst1_abc");
    expect(readClaimToken("guest-2")).toBe("gst1_def");
  });

  it("drops the token on clear and leaves other guests untouched", () => {
    writeClaimToken("guest-1", "gst1_abc");
    writeClaimToken("guest-2", "gst1_def");

    clearClaimToken("guest-1");

    expect(readClaimToken("guest-1")).toBeNull();
    expect(readClaimToken("guest-2")).toBe("gst1_def");
  });
});
