import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@capacitor/haptics", () => ({
  Haptics: {
    impact: vi.fn().mockResolvedValue(undefined),
    notification: vi.fn().mockResolvedValue(undefined),
    selectionStart: vi.fn().mockResolvedValue(undefined),
    selectionChanged: vi.fn().mockResolvedValue(undefined),
    selectionEnd: vi.fn().mockResolvedValue(undefined),
  },
  ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM", Heavy: "HEAVY" },
  NotificationType: {
    Success: "SUCCESS",
    Warning: "WARNING",
    Error: "ERROR",
  },
}));

import { Haptics } from "@capacitor/haptics";
import { haptics, useHaptics } from "./use-haptics";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("haptics", () => {
  it("tap() calls Haptics.impact with Light style", async () => {
    haptics.tap();
    await vi.waitFor(() => {
      expect(Haptics.impact).toHaveBeenCalledWith({ style: "LIGHT" });
    });
  });

  it("impact() calls Haptics.impact with Medium style", async () => {
    haptics.impact();
    await vi.waitFor(() => {
      expect(Haptics.impact).toHaveBeenCalledWith({ style: "MEDIUM" });
    });
  });

  it("success() calls Haptics.notification with Success type", async () => {
    haptics.success();
    await vi.waitFor(() => {
      expect(Haptics.notification).toHaveBeenCalledWith({ type: "SUCCESS" });
    });
  });

  it("error() calls Haptics.notification with Error type", async () => {
    haptics.error();
    await vi.waitFor(() => {
      expect(Haptics.notification).toHaveBeenCalledWith({ type: "ERROR" });
    });
  });

  it("selectionChanged() calls start, changed, end in sequence", async () => {
    haptics.selectionChanged();
    await vi.waitFor(() => {
      expect(Haptics.selectionStart).toHaveBeenCalled();
      expect(Haptics.selectionChanged).toHaveBeenCalled();
      expect(Haptics.selectionEnd).toHaveBeenCalled();
    });
  });

  it("silently swallows errors from Haptics API", async () => {
    vi.mocked(Haptics.impact).mockRejectedValueOnce(
      new Error("not available"),
    );
    expect(() => haptics.tap()).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("useHaptics", () => {
  it("returns the same haptics object", () => {
    expect(useHaptics()).toBe(haptics);
  });
});
