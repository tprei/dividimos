import { describe, expect, it } from "vitest";
import { normalizePhone, phoneToTestEmail, redirectForProfile } from "./phone-utils";

describe("normalizePhone", () => {
  it("passes through international numbers with + prefix", () => {
    expect(normalizePhone("+44 7911 123456")).toBe("+447911123456");
    expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
  });

  it("detects Brazilian numbers starting with 55 and 12+ digits", () => {
    expect(normalizePhone("5511999990001")).toBe("+5511999990001");
    expect(normalizePhone("55 11 99999-0001")).toBe("+5511999990001");
  });

  it("prepends +55 for bare Brazilian numbers", () => {
    expect(normalizePhone("11999990001")).toBe("+5511999990001");
    expect(normalizePhone("(11) 99999-0001")).toBe("+5511999990001");
  });

  it("prepends +55 for short numbers starting with 55 (under 12 digits)", () => {
    // "5511" is only 4 digits — too short to be a full Brazilian international number
    expect(normalizePhone("5511")).toBe("+555511");
  });

  it("handles whitespace around + prefix", () => {
    expect(normalizePhone("  +5511999990001")).toBe("+5511999990001");
  });

  it("strips all non-digit characters except leading +", () => {
    expect(normalizePhone("+55 (11) 99999-0001")).toBe("+5511999990001");
    expect(normalizePhone("11.99999.0001")).toBe("+5511999990001");
  });
});

describe("phoneToTestEmail", () => {
  it("converts phone to test email format", () => {
    expect(phoneToTestEmail("+5511999990001")).toBe("5511999990001@phone.pagajaja.local");
  });

  it("strips the + prefix", () => {
    expect(phoneToTestEmail("+447911123456")).toBe("447911123456@phone.pagajaja.local");
  });
});

describe("redirectForProfile", () => {
  it("redirects to onboard when profile is null", () => {
    expect(redirectForProfile(null, "/app")).toBe("/auth/onboard");
  });

  it("redirects to onboard with next param when target is not /app", () => {
    expect(redirectForProfile(null, "/app/groups/123")).toBe(
      "/auth/onboard?next=%2Fapp%2Fgroups%2F123",
    );
  });

  it("redirects to onboard when profile is not onboarded", () => {
    const profile = { onboarded: false, two_factor_enabled: false };
    expect(redirectForProfile(profile, "/app")).toBe("/auth/onboard");
  });

  it("redirects to 2FA verification when two_factor_enabled", () => {
    const profile = { onboarded: true, two_factor_enabled: true };
    expect(redirectForProfile(profile, "/app")).toBe(
      "/auth/verify-2fa?next=%2Fapp",
    );
  });

  it("redirects to 2FA with custom path", () => {
    const profile = { onboarded: true, two_factor_enabled: true };
    expect(redirectForProfile(profile, "/app/groups/456")).toBe(
      "/auth/verify-2fa?next=%2Fapp%2Fgroups%2F456",
    );
  });

  it("returns safePath directly for onboarded user without 2FA", () => {
    const profile = { onboarded: true, two_factor_enabled: false };
    expect(redirectForProfile(profile, "/app")).toBe("/app");
    expect(redirectForProfile(profile, "/app/groups/789")).toBe("/app/groups/789");
  });
});
