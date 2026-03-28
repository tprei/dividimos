import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRealtimeBalances } from "./use-realtime-balances";

type ChannelCallback = (payload: { new: Record<string, unknown> }) => void;

function createMockChannel() {
  const listeners: { event: string; cb: ChannelCallback }[] = [];
  const channel = {
    on: vi.fn((_type: string, opts: { event: string }, cb: ChannelCallback) => {
      listeners.push({ event: opts.event, cb });
      return channel;
    }),
    subscribe: vi.fn(() => channel),
    _listeners: listeners,
    emit(event: string, row: Record<string, unknown>) {
      for (const l of listeners) {
        if (l.event === event) l.cb({ new: row });
      }
    },
  };
  return channel;
}

let mockChannel: ReturnType<typeof createMockChannel>;
const removeChannelSpy = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => {
      mockChannel = createMockChannel();
      return mockChannel;
    },
    removeChannel: removeChannelSpy,
  }),
}));

const originalEnv = process.env.NEXT_PUBLIC_SUPABASE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  removeChannelSpy.mockClear();
});

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnv;
});

describe("useRealtimeBalances", () => {
  it("does nothing when groupId is undefined", () => {
    renderHook(() => useRealtimeBalances(undefined, vi.fn()));
    expect(removeChannelSpy).not.toHaveBeenCalled();
  });

  it("subscribes to INSERT and UPDATE events on balances table", () => {
    renderHook(() => useRealtimeBalances("group-1", vi.fn()));

    expect(mockChannel.on).toHaveBeenCalledTimes(2);
    expect(mockChannel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ event: "INSERT", table: "balances", filter: "group_id=eq.group-1" }),
      expect.any(Function),
    );
    expect(mockChannel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ event: "UPDATE", table: "balances", filter: "group_id=eq.group-1" }),
      expect.any(Function),
    );
  });

  it("calls onBalanceChange with mapped Balance on INSERT", () => {
    const cb = vi.fn();
    renderHook(() => useRealtimeBalances("group-1", cb));

    mockChannel.emit("INSERT", {
      group_id: "group-1", user_a: "alice", user_b: "bob", amount_cents: 5000, updated_at: "2026-03-28T12:00:00Z",
    });

    expect(cb).toHaveBeenCalledWith({
      groupId: "group-1", userA: "alice", userB: "bob", amountCents: 5000, updatedAt: "2026-03-28T12:00:00Z",
    });
  });

  it("calls onBalanceChange with mapped Balance on UPDATE", () => {
    const cb = vi.fn();
    renderHook(() => useRealtimeBalances("group-1", cb));

    mockChannel.emit("UPDATE", {
      group_id: "group-1", user_a: "alice", user_b: "carol", amount_cents: -3000, updated_at: "2026-03-28T13:00:00Z",
    });

    expect(cb).toHaveBeenCalledWith({
      groupId: "group-1", userA: "alice", userB: "carol", amountCents: -3000, updatedAt: "2026-03-28T13:00:00Z",
    });
  });

  it("removes the channel on unmount", () => {
    const { unmount } = renderHook(() => useRealtimeBalances("group-1", vi.fn()));
    unmount();
    expect(removeChannelSpy).toHaveBeenCalledWith(mockChannel);
  });

  it("uses ref to avoid re-subscribing when callback changes", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(({ cb }) => useRealtimeBalances("group-1", cb), { initialProps: { cb: cb1 } });
    const firstChannel = mockChannel;
    rerender({ cb: cb2 });

    firstChannel.emit("UPDATE", {
      group_id: "group-1", user_a: "a", user_b: "b", amount_cents: 100, updated_at: "2026-03-28T14:00:00Z",
    });

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });
});
