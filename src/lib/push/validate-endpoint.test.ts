import { describe, expect, it, vi, beforeEach } from "vitest";
import https from "node:https";

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({
  default: { lookup: lookupMock },
  lookup: lookupMock,
}));
import {
  createRebindingSafeAgent,
  isPublicAddress,
  resolvePublicHost,
  validateWebSubscription,
} from "./validate-endpoint";

const validKeys = {
  p256dh:
    "BCNXu22ndNATY-RZtaeIvbY2I92MODTxto2tmvWhhpTM-FgTfREXkh2l8LyhFkoPOtCnMUE3ultxDvWJtINvgF8",
  auth: "AQEBAQEBAQEBAQEBAQEBAQ",
};

const validSubscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: validKeys,
};

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "142.250.72.14", family: 4 }]);
});

describe("isPublicAddress", () => {
  it("accepts global IPv4 and IPv6 addresses", () => {
    expect(isPublicAddress("142.250.72.14")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects private, special, multicast, and mapped addresses", () => {
    expect(isPublicAddress("10.0.0.1")).toBe(false);
    expect(isPublicAddress("127.0.0.1")).toBe(false);
    expect(isPublicAddress("169.254.1.1")).toBe(false);
    expect(isPublicAddress("224.0.0.1")).toBe(false);
    expect(isPublicAddress("::1")).toBe(false);
    expect(isPublicAddress("fc00::1")).toBe(false);
    expect(isPublicAddress("fe80::1")).toBe(false);
    expect(isPublicAddress("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicAddress("192.88.99.1")).toBe(false);
    expect(isPublicAddress("2001:20::1")).toBe(false);
    expect(isPublicAddress("2002::1")).toBe(false);
  });
});

describe("resolvePublicHost", () => {
  it("rejects a private DNS answer", async () => {
    lookupMock.mockResolvedValue([{ address: "192.168.1.2", family: 4 }]);
    await expect(resolvePublicHost("fcm.googleapis.com")).rejects.toThrow();
  });

  it("turns DNS failures into a rejected resolution", async () => {
    lookupMock.mockRejectedValue(new Error("temporary DNS failure"));
    await expect(resolvePublicHost("fcm.googleapis.com")).rejects.toThrow();
  });
});

describe("validateWebSubscription", () => {
  it("accepts a valid allowlisted subscription", async () => {
    await expect(validateWebSubscription(validSubscription)).resolves.toEqual({
      ok: true,
      value: validSubscription,
    });
  });

  it.each([
    ["http://fcm.googleapis.com/fcm/send/abc", "http endpoint"],
    ["https://user:fcm.googleapis.com/fcm/send/abc", "userinfo"],
    ["https://fcm.googleapis.com:8443/fcm/send/abc", "non-default port"],
    ["https://192.0.2.1/fcm/send/abc", "literal IP"],
    ["https://evilpush.apple.com/abc", "host suffix lookalike"],
    ["https://push.apple.com/abc", "bare Apple suffix"],
  ])("rejects %s (%s) without DNS", async (endpoint) => {
    const result = await validateWebSubscription({ endpoint, keys: validKeys });
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects noncanonical and malformed keys", async () => {
    const result = await validateWebSubscription({
      endpoint: validSubscription.endpoint,
      keys: { p256dh: `${validKeys.p256dh}=`, auth: validKeys.auth },
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });

    const invalidPoint = await validateWebSubscription({
      endpoint: validSubscription.endpoint,
      keys: { p256dh: `BA${"A".repeat(85)}`, auth: validKeys.auth },
    });
    expect(invalidPoint).toEqual({ ok: false, reason: "invalid" });
  });

  it("returns a retryable result when DNS is unavailable", async () => {
    lookupMock.mockRejectedValue(new Error("DNS outage"));
    await expect(validateWebSubscription(validSubscription)).resolves.toEqual({
      ok: false,
      reason: "resolution_failed",
    });
  });

  it("rejects a private DNS answer as invalid", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(validateWebSubscription(validSubscription)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("creates an HTTPS agent for rebinding-safe lookups", () => {
    expect(createRebindingSafeAgent("fcm.googleapis.com")).toBeInstanceOf(https.Agent);
  });
});
