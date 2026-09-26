import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_SKELETON_DELAY_MS, usePendingNavigation } from "./use-pending-navigation";

const mockPathname = vi.fn(() => "/app");

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

describe("usePendingNavigation", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/app");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the destination at once and reveals the skeleton after the delay", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePendingNavigation());

    act(() => result.current.begin("/app/groups"));
    expect(result.current.href).toBe("/app/groups");
    expect(result.current.showSkeleton).toBe(false);

    act(() => vi.advanceTimersByTime(PENDING_SKELETON_DELAY_MS - 1));
    expect(result.current.showSkeleton).toBe(false);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.showSkeleton).toBe(true);
  });

  it("clears the pending state once the pathname catches up", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(() => usePendingNavigation());

    act(() => result.current.begin("/app/groups"));
    act(() => vi.advanceTimersByTime(PENDING_SKELETON_DELAY_MS));
    expect(result.current.showSkeleton).toBe(true);

    mockPathname.mockReturnValue("/app/groups");
    rerender();

    expect(result.current.href).toBeNull();
    expect(result.current.showSkeleton).toBe(false);
  });

  it("abandons the pending tab on popstate with an unchanged pathname", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePendingNavigation());

    act(() => result.current.begin("/app/groups"));
    expect(result.current.href).toBe("/app/groups");

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.href).toBeNull();
    expect(result.current.showSkeleton).toBe(false);

    act(() => vi.advanceTimersByTime(PENDING_SKELETON_DELAY_MS + 1));
    expect(result.current.href).toBeNull();
    expect(result.current.showSkeleton).toBe(false);
  });

  it("ignores begin for the current pathname and clears a pending tab with it", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePendingNavigation());

    act(() => result.current.begin("/app"));
    expect(result.current.href).toBeNull();
    expect(result.current.showSkeleton).toBe(false);

    act(() => result.current.begin("/app/groups"));
    expect(result.current.href).toBe("/app/groups");

    act(() => {
      result.current.begin("/app");
      vi.advanceTimersByTime(PENDING_SKELETON_DELAY_MS);
    });
    expect(result.current.href).toBeNull();
    expect(result.current.showSkeleton).toBe(false);
  });

  it("keeps the skeleton revealed and swaps the destination on a second begin", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePendingNavigation());

    act(() => result.current.begin("/app/groups"));
    act(() => vi.advanceTimersByTime(PENDING_SKELETON_DELAY_MS));
    expect(result.current.showSkeleton).toBe(true);

    act(() => result.current.begin("/app/profile"));
    expect(result.current.href).toBe("/app/profile");
    expect(result.current.showSkeleton).toBe(true);
  });

  it("does not resurrect a cleared pending tab when returning to the origin", () => {
    const { result, rerender } = renderHook(() => usePendingNavigation());

    act(() => result.current.begin("/app/groups"));
    mockPathname.mockReturnValue("/app/groups");
    rerender();
    expect(result.current.href).toBeNull();
    expect(result.current.showSkeleton).toBe(false);

    mockPathname.mockReturnValue("/app");
    rerender();
    expect(result.current.href).toBeNull();
    expect(result.current.showSkeleton).toBe(false);
  });
});
