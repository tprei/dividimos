import { describe, expect, it } from "vitest";
import {
  CURRENT_AI_CONSENT_VERSION,
  hasCurrentAiConsent,
  type AiConsentState,
} from "./ai-consent";

const GRANTED_AT = "2026-09-27T12:00:00.000Z";

function consent(
  overrides: Partial<AiConsentState> = {},
): AiConsentState {
  return {
    aiConsentVersion: CURRENT_AI_CONSENT_VERSION,
    aiConsentGrantedAt: GRANTED_AT,
    ...overrides,
  };
}

describe("hasCurrentAiConsent", () => {
  it("accepts a current version with a valid timestamp", () => {
    expect(hasCurrentAiConsent(consent())).toBe(true);
  });

  it("rejects null and undefined consent", () => {
    expect(hasCurrentAiConsent(null)).toBe(false);
    expect(hasCurrentAiConsent(undefined)).toBe(false);
  });

  it("rejects a missing timestamp", () => {
    expect(hasCurrentAiConsent(consent({ aiConsentGrantedAt: null }))).toBe(false);
  });

  it("rejects an invalid timestamp", () => {
    expect(
      hasCurrentAiConsent(consent({ aiConsentGrantedAt: "not-a-date" })),
    ).toBe(false);
  });

  it("rejects an old version", () => {
    expect(hasCurrentAiConsent(consent({ aiConsentVersion: 0 }))).toBe(false);
  });

  it("rejects a future version", () => {
    expect(hasCurrentAiConsent(consent({ aiConsentVersion: 2 }))).toBe(false);
  });

  it("rejects a noninteger version", () => {
    expect(hasCurrentAiConsent(consent({ aiConsentVersion: 1.5 }))).toBe(false);
  });
});
