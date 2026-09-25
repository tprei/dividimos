import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTRO_AUTO_ADVANCE_MS, useAutoAdvance } from "./use-auto-advance";

function setup(enabled = true) {
  const onAdvance = vi.fn();
  const hook = renderHook((props: { enabled: boolean; slide: number }) => useAutoAdvance({ ...props, onAdvance }), {
    initialProps: { enabled, slide: 0 },
  });
  return { onAdvance, hook };
}

describe("useAutoAdvance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the scene to settle, then advances after the delay", () => {
    const { onAdvance, hook } = setup();

    act(() => vi.advanceTimersByTime(INTRO_AUTO_ADVANCE_MS * 2));
    expect(onAdvance).not.toHaveBeenCalled();

    act(() => hook.result.current.settle());
    expect(hook.result.current.counting).toBe(true);
    act(() => vi.advanceTimersByTime(INTRO_AUTO_ADVANCE_MS - 1));
    expect(onAdvance).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("holds while the screen is pressed and gives a full delay after release", () => {
    const { onAdvance, hook } = setup();
    act(() => hook.result.current.settle());
    act(() => vi.advanceTimersByTime(3000));

    act(() => hook.result.current.pause("press"));
    act(() => vi.advanceTimersByTime(INTRO_AUTO_ADVANCE_MS * 2));
    expect(onAdvance).not.toHaveBeenCalled();
    expect(hook.result.current.counting).toBe(false);

    act(() => hook.result.current.resume("press"));
    act(() => vi.advanceTimersByTime(INTRO_AUTO_ADVANCE_MS - 1));
    expect(onAdvance).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("stops counting while a tap animation runs and restarts when it settles", () => {
    const { onAdvance, hook } = setup();
    act(() => hook.result.current.settle());
    act(() => vi.advanceTimersByTime(3000));

    act(() => hook.result.current.busy());
    act(() => vi.advanceTimersByTime(INTRO_AUTO_ADVANCE_MS));
    expect(onAdvance).not.toHaveBeenCalled();

    act(() => hook.result.current.settle());
    act(() => vi.advanceTimersByTime(INTRO_AUTO_ADVANCE_MS));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("forgets a settled scene when the slide changes", () => {
    const { onAdvance, hook } = setup();
    act(() => hook.result.current.settle());

    hook.rerender({ enabled: true, slide: 1 });
    act(() => vi.advanceTimersByTime(INTRO_AUTO_ADVANCE_MS * 2));
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("never advances while disabled", () => {
    const { onAdvance, hook } = setup(false);
    act(() => hook.result.current.settle());
    act(() => vi.advanceTimersByTime(INTRO_AUTO_ADVANCE_MS * 2));

    expect(onAdvance).not.toHaveBeenCalled();
    expect(hook.result.current.counting).toBe(false);
  });
});
