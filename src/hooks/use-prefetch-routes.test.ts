import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePrefetchRoutes, resetPrefetchCache } from "./use-prefetch-routes";

const mockPrefetch = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: mockPrefetch,
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  resetPrefetchCache();
});

describe("usePrefetchRoutes", () => {
  it("prefetches all provided routes", () => {
    renderHook(() => usePrefetchRoutes(["/app/groups/1", "/app/groups/2"]));

    vi.runAllTimers();

    expect(mockPrefetch).toHaveBeenCalledTimes(2);
    expect(mockPrefetch).toHaveBeenCalledWith("/app/groups/1");
    expect(mockPrefetch).toHaveBeenCalledWith("/app/groups/2");
  });

  it("does not prefetch the same route twice", () => {
    const { rerender } = renderHook(
      ({ routes }) => usePrefetchRoutes(routes),
      { initialProps: { routes: ["/app/groups/1"] } },
    );

    vi.runAllTimers();
    expect(mockPrefetch).toHaveBeenCalledTimes(1);

    mockPrefetch.mockClear();
    rerender({ routes: ["/app/groups/1", "/app/groups/2"] });

    vi.runAllTimers();
    expect(mockPrefetch).toHaveBeenCalledTimes(1);
    expect(mockPrefetch).toHaveBeenCalledWith("/app/groups/2");
  });

  it("does nothing with an empty array", () => {
    renderHook(() => usePrefetchRoutes([]));

    vi.runAllTimers();
    expect(mockPrefetch).not.toHaveBeenCalled();
  });

  it("staggers prefetch calls with 100ms intervals", () => {
    renderHook(() =>
      usePrefetchRoutes(["/a", "/b", "/c"]),
    );

    vi.advanceTimersByTime(0);
    expect(mockPrefetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(mockPrefetch).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(100);
    expect(mockPrefetch).toHaveBeenCalledTimes(3);
  });

  it("cleans up timers on unmount", () => {
    const { unmount } = renderHook(() =>
      usePrefetchRoutes(["/a", "/b", "/c"]),
    );

    vi.advanceTimersByTime(0);
    expect(mockPrefetch).toHaveBeenCalledTimes(1);

    unmount();
    vi.runAllTimers();
    // Only the first call that already fired should remain
    expect(mockPrefetch).toHaveBeenCalledTimes(1);
  });
});
