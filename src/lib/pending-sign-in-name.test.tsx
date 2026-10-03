import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingSignInName,
  getPendingSignInName,
  onboardingNameFallback,
  setPendingSignInName,
} from "./pending-sign-in-name";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("pending sign-in name", () => {
  it("returns the stored name only to the user who signed in", () => {
    setPendingSignInName("user-a", "  Ana Souza ");

    expect(getPendingSignInName("user-a")).toBe("Ana Souza");
    expect(getPendingSignInName("user-b")).toBeNull();
  });

  it("ignores an empty name instead of replacing a stored one", () => {
    setPendingSignInName("user-a", "Ana Souza");
    setPendingSignInName("user-a", "   ");

    expect(getPendingSignInName("user-a")).toBe("Ana Souza");
  });

  it("forgets the name after sign-out clears it", () => {
    setPendingSignInName("user-a", "Ana Souza");
    clearPendingSignInName();

    expect(getPendingSignInName("user-a")).toBeNull();
  });

  it("treats a malformed stored entry as absent", () => {
    window.sessionStorage.setItem("dividimos:pending-sign-in-name", "{not json");
    expect(getPendingSignInName("user-a")).toBeNull();

    window.sessionStorage.setItem("dividimos:pending-sign-in-name", JSON.stringify({ userId: "user-a" }));
    expect(getPendingSignInName("user-a")).toBeNull();
  });
});

describe("onboardingNameFallback", () => {
  it("starts empty when the name is the random local part of a Hide My Email relay", () => {
    expect(
      onboardingNameFallback({ name: "x7k2p9qd4m", email: "x7k2p9qd4m@privaterelay.appleid.com" }),
    ).toBe("");
    expect(
      onboardingNameFallback({ name: "x7k2p9qd4m", email: "x7k2p9qd4m@PrivateRelay.AppleID.com" }),
    ).toBe("");
  });

  it("keeps a real name even for a relay address", () => {
    expect(
      onboardingNameFallback({ name: "Ana Souza", email: "x7k2p9qd4m@privaterelay.appleid.com" }),
    ).toBe("Ana Souza");
  });

  it("keeps the existing fallback for ordinary email addresses", () => {
    expect(onboardingNameFallback({ name: "ana", email: "ana@gmail.com" })).toBe("ana");
  });
});
