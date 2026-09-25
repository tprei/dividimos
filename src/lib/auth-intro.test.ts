import { describe, expect, it } from "vitest";
import { shouldPlayIntro } from "./auth-intro";

const firstVisit = { seen: false, next: null, error: null };

describe("shouldPlayIntro", () => {
  it("plays on a first visit headed to the app", () => {
    expect(shouldPlayIntro(firstVisit)).toBe(true);
    expect(shouldPlayIntro({ ...firstVisit, next: "/app" })).toBe(true);
  });

  it("skips once the device has seen it", () => {
    expect(shouldPlayIntro({ ...firstVisit, seen: true })).toBe(false);
  });

  it("goes straight to login when a link brought the visitor somewhere specific", () => {
    for (const next of ["/join/abc", "/claim", "/room/r1", "/u/ana", "/app/groups/g1"]) {
      expect(shouldPlayIntro({ ...firstVisit, next })).toBe(false);
    }
  });

  it("goes straight to login after a failed sign-in", () => {
    expect(shouldPlayIntro({ ...firstVisit, error: "callback_failed" })).toBe(false);
  });

  it("treats an unsafe destination as no destination", () => {
    expect(shouldPlayIntro({ ...firstVisit, next: "https://evil.example.com" })).toBe(true);
  });
});
