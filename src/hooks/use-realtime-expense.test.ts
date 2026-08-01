import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRealtimeExpense } from "./use-realtime-expense";

type BroadcastCallback = (payload: { payload: Record<string, unknown> }) => void;

function createMockChannel() {
  const listeners: { event: string; cb: BroadcastCallback }[] = [];
  const channel = {
    on: vi.fn((event: string, _filter: unknown, cb: BroadcastCallback) => {
      if (typeof _filter === "function") {
        // Two-arg form: .on(event, cb)
        listeners.push({ event, cb: _filter as BroadcastCallback });
      } else {
        listeners.push({ event, cb });
      }
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  return { channel, listeners };
}

let mockChannel: ReturnType<typeof createMockChannel>;
const removeChannelSpy = vi.fn();
const channelSpy = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: channelSpy,
    removeChannel: removeChannelSpy,
  }),
}));

const originalEnv = process.env.NEXT_PUBLIC_SUPABASE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  removeChannelSpy.mockClear();
  channelSpy.mockReset();
  channelSpy.mockImplementation(() => mockChannel.channel);
  mockChannel = createMockChannel();
});

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnv;
});

function fireBroadcast(
  listeners: { event: string; cb: BroadcastCallback }[],
  payload: Record<string, unknown>,
) {
  const l = listeners.find((l) => l.event === "broadcast");
  l?.cb({ payload });
}

describe("useRealtimeExpense", () => {
  it("does nothing when expenseId is undefined", () => {
    const onUpdate = vi.fn();
    renderHook(() => useRealtimeExpense(undefined, onUpdate));
    expect(mockChannel.channel.subscribe).not.toHaveBeenCalled();
  });

  it("subscribes to broadcast wake events", () => {
    const onUpdate = vi.fn();
    renderHook(() => useRealtimeExpense("exp-1", onUpdate));
    expect(mockChannel.channel.subscribe).toHaveBeenCalled();
    expect(mockChannel.listeners.some((l) => l.event === "broadcast")).toBe(true);
  });

  it("subscribes with private:true so the broadcast authorization RLS check runs", () => {
    const onUpdate = vi.fn();
    renderHook(() => useRealtimeExpense("exp-1", onUpdate));

    expect(channelSpy).toHaveBeenCalledWith(
      "expense_wake:exp-1",
      { config: { private: true } },
    );
  });

  it("calls onUpdate when a matching wake arrives", () => {
    const onUpdate = vi.fn();
    renderHook(() => useRealtimeExpense("exp-1", onUpdate));

    fireBroadcast(mockChannel.listeners, { expense_id: "exp-1", graph_revision: 2 });
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("skips wakes for a different expense_id", () => {
    const onUpdate = vi.fn();
    renderHook(() => useRealtimeExpense("exp-1", onUpdate));

    fireBroadcast(mockChannel.listeners, { expense_id: "exp-2", graph_revision: 2 });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("does not re-subscribe when only the callback identity changes", () => {
    const onUpdate1 = vi.fn();
    const onUpdate2 = vi.fn();
    const { rerender } = renderHook(
      ({ cb }) => useRealtimeExpense("exp-1", cb),
      { initialProps: { cb: onUpdate1 } },
    );

    expect(mockChannel.channel.subscribe).toHaveBeenCalledTimes(1);

    rerender({ cb: onUpdate2 });

    // Only expenseId triggers re-subscribe
    expect(mockChannel.channel.subscribe).toHaveBeenCalledTimes(1);
  });

  it("removes the channel on unmount", () => {
    const onUpdate = vi.fn();
    const { unmount } = renderHook(() => useRealtimeExpense("exp-1", onUpdate));
    unmount();
    expect(removeChannelSpy).toHaveBeenCalledTimes(1);
  });
});
