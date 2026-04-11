import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useOnboardingTour } from "./use-onboarding-tour";

describe("useOnboardingTour", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows tour for new user", () => {
    const { result } = renderHook(() => useOnboardingTour("user-1"));
    expect(result.current.shouldShow).toBe(true);
  });

  it("does not show tour when already completed", () => {
    localStorage.setItem("dividimos_tour_completed_user-1", "true");
    const { result } = renderHook(() => useOnboardingTour("user-1"));
    expect(result.current.shouldShow).toBe(false);
  });

  it("does not show tour when userId is undefined", () => {
    const { result } = renderHook(() => useOnboardingTour(undefined));
    expect(result.current.shouldShow).toBe(false);
  });

  it("completeTour sets localStorage and hides tour", () => {
    const { result } = renderHook(() => useOnboardingTour("user-2"));
    expect(result.current.shouldShow).toBe(true);

    act(() => {
      result.current.completeTour();
    });

    expect(result.current.shouldShow).toBe(false);
    expect(localStorage.getItem("dividimos_tour_completed_user-2")).toBe("true");
  });

  it("resetTour clears localStorage and shows tour again", () => {
    localStorage.setItem("dividimos_tour_completed_user-3", "true");
    const { result } = renderHook(() => useOnboardingTour("user-3"));
    expect(result.current.shouldShow).toBe(false);

    act(() => {
      result.current.resetTour();
    });

    expect(result.current.shouldShow).toBe(true);
    expect(localStorage.getItem("dividimos_tour_completed_user-3")).toBeNull();
  });

  it("uses unique key per user", () => {
    const { result: r1 } = renderHook(() => useOnboardingTour("user-a"));
    act(() => {
      r1.current.completeTour();
    });

    const { result: r2 } = renderHook(() => useOnboardingTour("user-b"));
    expect(r2.current.shouldShow).toBe(true);
  });

  it("handles localStorage errors gracefully on completeTour", () => {
    const { result } = renderHook(() => useOnboardingTour("user-err"));
    expect(result.current.shouldShow).toBe(true);

    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    act(() => {
      result.current.completeTour();
    });

    // State still updates even if localStorage write fails
    expect(result.current.shouldShow).toBe(false);

    spy.mockRestore();
  });
});
