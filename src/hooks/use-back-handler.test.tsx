import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as backHandlerLib from "@/lib/capacitor/back-handler";
import {
  runBackHandlers,
  __resetBackHandlerStackForTests,
} from "@/lib/capacitor/back-handler";
import { useBackHandler } from "./use-back-handler";

beforeEach(() => {
  __resetBackHandlerStackForTests();
  vi.clearAllMocks();
});

describe("useBackHandler", () => {
  it("registers a handler and runBackHandlers calls onClose when enabled=true", () => {
    const onClose = vi.fn();
    renderHook(() => useBackHandler(true, onClose));

    act(() => {
      runBackHandlers();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when enabled is false", () => {
    const onClose = vi.fn();
    renderHook(() => useBackHandler(false, onClose));

    act(() => {
      runBackHandlers();
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("unregisters on unmount so runBackHandlers no longer calls onClose", () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useBackHandler(true, onClose));

    unmount();

    act(() => {
      runBackHandlers();
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("unregisters when enabled flips from true to false", () => {
    const onClose = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useBackHandler(enabled, onClose),
      { initialProps: { enabled: true } },
    );

    rerender({ enabled: false });

    act(() => {
      runBackHandlers();
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("registers pushBackHandler exactly once across re-renders with a changing onClose ref", () => {
    const pushSpy = vi.spyOn(backHandlerLib, "pushBackHandler");

    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useBackHandler(true, cb),
      { initialProps: { cb: vi.fn() } },
    );

    rerender({ cb: vi.fn() });
    rerender({ cb: vi.fn() });
    rerender({ cb: vi.fn() });

    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it("calls the latest onClose ref when triggered after re-renders", () => {
    const first = vi.fn();
    const latest = vi.fn();

    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useBackHandler(true, cb),
      { initialProps: { cb: first } },
    );

    rerender({ cb: latest });

    act(() => {
      runBackHandlers();
    });

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
