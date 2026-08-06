import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockLoadGroupFinances = vi.fn();
vi.mock("@/lib/supabase/group-finances", () => ({
  loadGroupFinances: (...args: unknown[]) => mockLoadGroupFinances(...args),
}));

import { useGroupFinances } from "./use-group-finances";
import type { Balance } from "@/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeBalance(userA: string, userB: string, amountCents: number): Balance {
  return {
    groupId: "group-1",
    userA: userA < userB ? userA : userB,
    userB: userA < userB ? userB : userA,
    amountCents: userA < userB ? amountCents : -amountCents,
    updatedAt: "",
  };
}

type Snapshot = { balances: Balance[]; settlements: never[]; participants: never[] };
const empty: Snapshot = { balances: [], settlements: [], participants: [] };

describe("useGroupFinances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits only the newest load when an older one resolves last", async () => {
    const loadA = deferred<Snapshot>();
    const loadB = deferred<Snapshot>();
    mockLoadGroupFinances
      .mockReturnValueOnce(loadA.promise)
      .mockReturnValueOnce(loadB.promise);

    const { result } = renderHook(() =>
      useGroupFinances({ groupId: "group-1", participants: [] }),
    );

    act(() => result.current.refresh());

    await act(async () => {
      loadB.resolve({ ...empty, balances: [makeBalance("a", "b", 5000)] });
      loadA.resolve({ ...empty, balances: [makeBalance("a", "b", 1000)] });
    });

    expect(result.current.state.phase).toBe("ready");
    expect(result.current.state.snapshot!.balances[0].amountCents).toBe(5000);
  });

  it("enters error phase on rejection with no snapshot", async () => {
    mockLoadGroupFinances.mockRejectedValueOnce(new Error("network"));

    const { result } = renderHook(() =>
      useGroupFinances({ groupId: "group-1", participants: [] }),
    );

    await waitFor(() => {
      expect(result.current.state.phase).toBe("error");
    });
    expect(result.current.state.snapshot).toBeNull();
  });

  it("preserves the previous snapshot when a later load rejects", async () => {
    mockLoadGroupFinances.mockResolvedValueOnce({
      ...empty,
      balances: [makeBalance("a", "b", 3000)],
    });

    const { result } = renderHook(() =>
      useGroupFinances({ groupId: "group-1", participants: [] }),
    );

    await waitFor(() => {
      expect(result.current.state.phase).toBe("ready");
    });

    mockLoadGroupFinances.mockRejectedValueOnce(new Error("transient"));
    act(() => result.current.refresh());

    await waitFor(() => {
      expect(result.current.state.phase).toBe("error");
    });
    expect(result.current.state.snapshot).not.toBeNull();
    expect(result.current.state.snapshot!.balances).toHaveLength(1);
  });

  it("applyRealtimeBalance no-ops when there is no committed snapshot", async () => {
    const load = deferred<Snapshot>();
    mockLoadGroupFinances.mockReturnValue(load.promise);

    const { result } = renderHook(() =>
      useGroupFinances({ groupId: "group-1", participants: [] }),
    );

    act(() => result.current.applyRealtimeBalance(makeBalance("a", "b", 5000)));

    expect(result.current.state.phase).toBe("loading");
    expect(result.current.state.snapshot).toBeNull();

    await act(async () => {
      load.resolve(empty);
    });
    expect(result.current.state.phase).toBe("ready");
  });

  it("patches a committed snapshot on realtime balance", async () => {
    mockLoadGroupFinances.mockResolvedValueOnce({
      ...empty,
      balances: [makeBalance("a", "b", 5000)],
    });

    const { result } = renderHook(() =>
      useGroupFinances({ groupId: "group-1", participants: [] }),
    );

    await waitFor(() => {
      expect(result.current.state.phase).toBe("ready");
    });

    act(() => result.current.applyRealtimeBalance(makeBalance("a", "b", 0)));

    expect(result.current.state.snapshot!.balances).toHaveLength(0);
  });
});
