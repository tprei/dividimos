import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useOnboardingTour } from "./use-onboarding-tour";

describe("useOnboardingTour", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ---- Preserved cases through the new (userId, identityGeneration) API ----

  it("shows tour for new user", () => {
    const { result } = renderHook(() => useOnboardingTour("user-1", 0));
    expect(result.current.shouldShow).toBe(true);
  });

  it("does not show tour when already completed", () => {
    localStorage.setItem("dividimos_tour_completed_user-1", "true");
    const { result } = renderHook(() => useOnboardingTour("user-1", 0));
    expect(result.current.shouldShow).toBe(false);
  });

  it("does not show tour when userId is null", () => {
    const { result } = renderHook(() => useOnboardingTour(null, 0));
    expect(result.current.shouldShow).toBe(false);
  });

  it("completeTour sets localStorage and hides tour", () => {
    const { result } = renderHook(() => useOnboardingTour("user-2", 0));
    expect(result.current.shouldShow).toBe(true);

    act(() => {
      result.current.completeTour();
    });

    expect(result.current.shouldShow).toBe(false);
    expect(localStorage.getItem("dividimos_tour_completed_user-2")).toBe("true");
  });

  it("resetTour clears localStorage and shows tour again", () => {
    localStorage.setItem("dividimos_tour_completed_user-3", "true");
    const { result } = renderHook(() => useOnboardingTour("user-3", 0));
    expect(result.current.shouldShow).toBe(false);

    act(() => {
      result.current.resetTour();
    });

    expect(result.current.shouldShow).toBe(true);
    expect(localStorage.getItem("dividimos_tour_completed_user-3")).toBeNull();
  });

  it("uses unique key per user", () => {
    const { result: r1 } = renderHook(() => useOnboardingTour("user-a", 0));
    act(() => {
      r1.current.completeTour();
    });

    const { result: r2 } = renderHook(() => useOnboardingTour("user-b", 0));
    expect(r2.current.shouldShow).toBe(true);
  });

  it("handles localStorage errors gracefully on completeTour", () => {
    const { result } = renderHook(() => useOnboardingTour("user-err", 0));
    expect(result.current.shouldShow).toBe(true);

    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    act(() => {
      result.current.completeTour();
    });

    // State still updates even if localStorage write fails.
    expect(result.current.shouldShow).toBe(false);
    // The write itself genuinely failed -- nothing was persisted.
    expect(localStorage.getItem("dividimos_tour_completed_user-err")).toBeNull();

    spy.mockRestore();
  });

  // ---- Identity-boundary behavior (one renderHook through all transitions) ----

  it("hides synchronously at every identity boundary then reflects the current key", () => {
    const shouldShowLog: boolean[] = [];
    const { result, rerender } = renderHook(
      ({ uid, gen }: { uid: string | null; gen: number }) => {
        const tour = useOnboardingTour(uid, gen);
        shouldShowLog.push(tour.shouldShow);
        return tour;
      },
      { initialProps: { uid: "A" as string | null, gen: 1 } },
    );

    // Mount: initial render shouldShow=false (no committed owner), then
    // layout effect reads A's key → true.
    expect(result.current.shouldShow).toBe(true);

    // --- A/g1 → A/g2: same-user generation bump re-reads A's key ---
    // Externally complete A's tour to prove the bump re-reads rather than
    // retaining the transient visible=true from g1.
    localStorage.setItem("dividimos_tour_completed_A", "true");
    shouldShowLog.length = 0;
    rerender({ uid: "A", gen: 2 });
    // Boundary render: committed owner is still {A,1} but props are {A,2}.
    expect(shouldShowLog[0]).toBe(false);
    // After the layout effect re-reads A's key: hidden.
    expect(result.current.shouldShow).toBe(false);

    // --- A/g2 → null (sign out): null → not ready ---
    shouldShowLog.length = 0;
    rerender({ uid: null, gen: 3 });
    expect(shouldShowLog[0]).toBe(false);
    expect(result.current.shouldShow).toBe(false);

    // --- null → B (account switch): reads B's key ---
    shouldShowLog.length = 0;
    rerender({ uid: "B", gen: 4 });
    expect(shouldShowLog[0]).toBe(false);
    expect(result.current.shouldShow).toBe(true);

    // Complete B, then switch B → A: B's completion must not leak to A.
    act(() => result.current.completeTour());
    expect(localStorage.getItem("dividimos_tour_completed_B")).toBe("true");
    shouldShowLog.length = 0;
    rerender({ uid: "A", gen: 5 });
    // Boundary: committed owner is still {B,4}.
    expect(shouldShowLog[0]).toBe(false);
    // A was completed earlier → hidden.
    expect(result.current.shouldShow).toBe(false);
    expect(localStorage.getItem("dividimos_tour_completed_A")).toBe("true");
  });

  // ---- Stale-callback isolation ----

  it("stale completeTour/resetTour from a previous generation are total no-ops", () => {
    const { result, rerender } = renderHook(
      ({ uid, gen }: { uid: string | null; gen: number }) =>
        useOnboardingTour(uid, gen),
      { initialProps: { uid: "A" as string | null, gen: 1 } },
    );
    expect(result.current.shouldShow).toBe(true);

    // Capture A/g1 callbacks.
    const staleComplete = result.current.completeTour;
    const staleReset = result.current.resetTour;

    // Bump generation.
    rerender({ uid: "A", gen: 2 });
    expect(result.current.shouldShow).toBe(true); // re-read A key, still uncompleted

    // Invoke stale callbacks → no key, no state change.
    act(() => staleComplete());
    expect(localStorage.getItem("dividimos_tour_completed_A")).toBeNull();
    expect(result.current.shouldShow).toBe(true);

    act(() => staleReset());
    expect(localStorage.getItem("dividimos_tour_completed_A")).toBeNull();
    expect(result.current.shouldShow).toBe(true);
  });

  it("stale completeTour/resetTour from a previous user touch neither account key", () => {
    const { result, rerender } = renderHook(
      ({ uid, gen }: { uid: string | null; gen: number }) =>
        useOnboardingTour(uid, gen),
      { initialProps: { uid: "A" as string | null, gen: 1 } },
    );
    expect(result.current.shouldShow).toBe(true);

    const staleComplete = result.current.completeTour;
    const staleReset = result.current.resetTour;

    // Switch A → B.
    rerender({ uid: "B", gen: 2 });
    expect(result.current.shouldShow).toBe(true);

    // Invoke A's stale callbacks → neither key changes.
    act(() => staleComplete());
    expect(localStorage.getItem("dividimos_tour_completed_A")).toBeNull();
    expect(localStorage.getItem("dividimos_tour_completed_B")).toBeNull();
    expect(result.current.shouldShow).toBe(true);

    act(() => staleReset());
    expect(localStorage.getItem("dividimos_tour_completed_A")).toBeNull();
    expect(localStorage.getItem("dividimos_tour_completed_B")).toBeNull();
    expect(result.current.shouldShow).toBe(true);
  });
});
