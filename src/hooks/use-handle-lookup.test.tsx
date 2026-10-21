import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/types/ledger";
import { lookupUserByHandle } from "@/lib/sync/mutations-group";
import { useHandleLookup } from "./use-handle-lookup";

vi.mock("@/lib/sync/mutations-group", () => ({
  lookupUserByHandle: vi.fn(),
}));

const lookup = vi.mocked(lookupUserByHandle);

function profile(handle: string): UserProfile {
  return {
    id: `user-${handle}`,
    handle,
    name: handle[0].toUpperCase() + handle.slice(1),
    avatarUrl: null,
    isBot: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
  lookup.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useHandleLookup", () => {
  it("stays idle and never calls the lookup for a null handle", () => {
    const { result } = renderHook(() => useHandleLookup(null));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(lookup).not.toHaveBeenCalled();
    expect(result.current.lookup).toEqual({ status: "idle" });
  });

  it("reports loading during the debounce and fires exactly one request after 500ms", async () => {
    const pending = deferred<UserProfile | null>();
    lookup.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useHandleLookup("alice"));

    expect(result.current.lookup).toEqual({ status: "loading", handle: "alice" });

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(lookup).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("alice", expect.any(AbortSignal));

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(result.current.lookup).toEqual({ status: "loading", handle: "alice" });

    pending.resolve(profile("alice"));
    await flush();
    expect(result.current.lookup).toEqual({
      status: "found",
      handle: "alice",
      profile: profile("alice"),
    });
  });

  it("clears the pending timer when the handle changes", () => {
    lookup.mockResolvedValue(profile("bob"));
    const { rerender } = renderHook(
      ({ handle }) => useHandleLookup(handle),
      { initialProps: { handle: "alice" as string | null } },
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ handle: "bob" });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("bob", expect.any(AbortSignal));
  });

  it("never surfaces a late reply for a superseded handle", async () => {
    const aliceLookup = deferred<UserProfile | null>();
    lookup.mockReturnValueOnce(aliceLookup.promise);
    lookup.mockResolvedValueOnce(profile("bob"));
    const { result, rerender } = renderHook(
      ({ handle }) => useHandleLookup(handle),
      { initialProps: { handle: "alice" as string | null } },
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(lookup).toHaveBeenCalledTimes(1);

    rerender({ handle: "bob" });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    await flush();
    expect(result.current.lookup).toEqual({
      status: "found",
      handle: "bob",
      profile: profile("bob"),
    });

    await act(async () => {
      aliceLookup.resolve(profile("alice"));
    });
    expect(result.current.lookup).toEqual({
      status: "found",
      handle: "bob",
      profile: profile("bob"),
    });
  });

  it("cancels the pending request on unmount", () => {
    lookup.mockResolvedValue(profile("alice"));
    const { unmount } = renderHook(() => useHandleLookup("alice"));

    unmount();
    act(() => {
      vi.runAllTimers();
    });

    expect(lookup).not.toHaveBeenCalled();
  });

  it("reports failed on a thrown error and finds the profile on retry", async () => {
    lookup.mockRejectedValueOnce(new Error("offline"));
    lookup.mockResolvedValueOnce(profile("alice"));
    const { result } = renderHook(() => useHandleLookup("alice"));

    act(() => {
      vi.advanceTimersByTime(500);
    });
    await flush();
    expect(result.current.lookup).toEqual({ status: "failed", handle: "alice" });

    act(() => {
      result.current.retry();
    });
    expect(result.current.lookup).toEqual({ status: "loading", handle: "alice" });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    await flush();
    expect(result.current.lookup).toEqual({
      status: "found",
      handle: "alice",
      profile: profile("alice"),
    });
  });

  it("reports not_found when the lookup returns null", async () => {
    lookup.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useHandleLookup("ninguem"));

    act(() => {
      vi.advanceTimersByTime(500);
    });
    await flush();

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(result.current.lookup).toEqual({ status: "not_found", handle: "ninguem" });
  });

  it("holds loading across A→B→A until the fresh lookup settles", async () => {
    lookup.mockResolvedValueOnce(profile("alice"));
    const second = deferred<UserProfile | null>();
    lookup.mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(
      ({ handle }) => useHandleLookup(handle),
      { initialProps: { handle: "alice" as string | null } },
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });
    await flush();
    expect(result.current.lookup).toEqual({
      status: "found",
      handle: "alice",
      profile: profile("alice"),
    });

    rerender({ handle: "bob" });
    expect(result.current.lookup).toEqual({ status: "loading", handle: "bob" });

    rerender({ handle: "alice" });
    expect(result.current.lookup).toEqual({ status: "loading", handle: "alice" });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    await flush();
    expect(result.current.lookup).toEqual({ status: "loading", handle: "alice" });

    second.resolve(profile("alice"));
    await flush();
    expect(result.current.lookup).toEqual({
      status: "found",
      handle: "alice",
      profile: profile("alice"),
    });
  });

  it("holds loading across A→null→A until the fresh lookup settles", async () => {
    lookup.mockResolvedValueOnce(profile("alice"));
    const second = deferred<UserProfile | null>();
    lookup.mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(
      ({ handle }) => useHandleLookup(handle),
      { initialProps: { handle: "alice" as string | null } },
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });
    await flush();
    expect(result.current.lookup).toEqual({
      status: "found",
      handle: "alice",
      profile: profile("alice"),
    });

    rerender({ handle: null });
    expect(result.current.lookup).toEqual({ status: "idle" });

    rerender({ handle: "alice" });
    expect(result.current.lookup).toEqual({ status: "loading", handle: "alice" });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    await flush();
    expect(result.current.lookup).toEqual({ status: "loading", handle: "alice" });

    second.resolve(null);
    await flush();
    expect(result.current.lookup).toEqual({ status: "not_found", handle: "alice" });
  });
});
