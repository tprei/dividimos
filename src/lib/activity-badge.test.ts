import { describe, it, expect, beforeEach } from "vitest";
import { markLatestActivity, markActivityViewed, hasUnreadActivity } from "./activity-badge";

describe("activity-badge", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns false when no activity has been recorded", () => {
    expect(hasUnreadActivity()).toBe(false);
  });

  it("returns true when activity exists but was never viewed", () => {
    markLatestActivity("2025-01-01T10:00:00Z");
    expect(hasUnreadActivity()).toBe(true);
  });

  it("returns false after activity is viewed", () => {
    markLatestActivity("2025-01-01T10:00:00Z");
    markActivityViewed();
    expect(hasUnreadActivity()).toBe(false);
  });

  it("returns true when new activity arrives after last view", () => {
    markLatestActivity("2025-01-01T10:00:00Z");
    markActivityViewed();
    expect(hasUnreadActivity()).toBe(false);

    // Simulate activity arriving after view — use a future timestamp
    const future = new Date(Date.now() + 86_400_000).toISOString();
    markLatestActivity(future);
    expect(hasUnreadActivity()).toBe(true);
  });

  it("keeps the newest timestamp when an older one is provided", () => {
    markLatestActivity("2025-01-02T12:00:00Z");
    markLatestActivity("2025-01-01T08:00:00Z");
    // newest should still be 2025-01-02, not overwritten by the older one
    markActivityViewed();
    // viewed_at (now) > newest (2025-01-02), so should be false
    expect(hasUnreadActivity()).toBe(false);
  });

  it("updates newest timestamp when a newer one is provided", () => {
    markLatestActivity("2025-01-01T10:00:00Z");
    markActivityViewed();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    markLatestActivity(future);
    expect(hasUnreadActivity()).toBe(true);
  });
});
