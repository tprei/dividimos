import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_CONSENT_VERSION,
  __resetAiConsentForTests,
  grantAiConsent,
  hasAiConsent,
  revokeAiConsent,
  subscribeAiConsent,
} from "./ai-consent";

const KEY = "dividimos.ai.consent";

beforeEach(() => {
  __resetAiConsentForTests();
});

describe("ai-consent storage", () => {
  it("reports consent after granting", () => {
    expect(hasAiConsent("account-a")).toBe(false);
    grantAiConsent("account-a");
    expect(hasAiConsent("account-a")).toBe(true);
  });

  it("keeps accounts isolated on the same device", () => {
    grantAiConsent("account-a");
    expect(hasAiConsent("account-a")).toBe(true);
    expect(hasAiConsent("account-b")).toBe(false);
  });

  it("revokes only the target account", () => {
    grantAiConsent("account-a");
    grantAiConsent("account-b");
    revokeAiConsent("account-a");
    expect(hasAiConsent("account-a")).toBe(false);
    expect(hasAiConsent("account-b")).toBe(true);
  });

  it("ignores a stored entry with an older version", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        "account-a": { version: AI_CONSENT_VERSION - 1, grantedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    expect(hasAiConsent("account-a")).toBe(false);
  });

  it("ignores corrupt JSON and keeps granting working", () => {
    localStorage.setItem(KEY, "{not json");
    expect(hasAiConsent("account-a")).toBe(false);
    grantAiConsent("account-a");
    expect(hasAiConsent("account-a")).toBe(true);
  });

  it("ignores entries that do not match the entry shape", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        "account-boolean": true,
        "account-number": 42,
        "account-string": "yes",
        "account-no-granted-at": { version: AI_CONSENT_VERSION },
        "account-float-version": { version: 1.5, grantedAt: "2026-01-01T00:00:00.000Z" },
        "account-string-version": { version: `${AI_CONSENT_VERSION}`, grantedAt: "2026-01-01T00:00:00.000Z" },
        "account-valid": { version: AI_CONSENT_VERSION, grantedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    expect(hasAiConsent("account-boolean")).toBe(false);
    expect(hasAiConsent("account-number")).toBe(false);
    expect(hasAiConsent("account-string")).toBe(false);
    expect(hasAiConsent("account-no-granted-at")).toBe(false);
    expect(hasAiConsent("account-float-version")).toBe(false);
    expect(hasAiConsent("account-string-version")).toBe(false);
    expect(hasAiConsent("account-valid")).toBe(true);
  });

  it("records the grant with the current version and an ISO timestamp", () => {
    const now = new Date("2026-09-27T12:00:00.000Z");
    grantAiConsent("account-a", now);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      "account-a": { version: AI_CONSENT_VERSION, grantedAt: "2026-09-27T12:00:00.000Z" },
    });
  });
});

describe("ai-consent subscribers", () => {
  it("notifies subscribers on grant and revoke", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAiConsent(listener);
    grantAiConsent("account-a");
    expect(listener).toHaveBeenCalledTimes(1);
    revokeAiConsent("account-a");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    grantAiConsent("account-a");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
