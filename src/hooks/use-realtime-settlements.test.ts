import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRealtimeSettlements } from "./use-realtime-settlements";

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

describe("useRealtimeSettlements", () => {
  it("does nothing when groupId is undefined", () => {
    renderHook(() => useRealtimeSettlements(undefined, vi.fn()));
    expect(removeChannelSpy).not.toHaveBeenCalled();
  });

  it("subscribes to INSERT and UPDATE on settlements table", () => {
    renderHook(() => useRealtimeSettlements("group-1", vi.fn()));

    expect(mockChannel.on).toHaveBeenCalledTimes(2);
    expect(mockChannel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ event: "INSERT", table: "settlements" }),
      expect.any(Function),
    );
    expect(mockChannel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ event: "UPDATE", table: "settlements" }),
      expect.any(Function),
    );
  });

  it("emits inserted event on INSERT", () => {
    const onEvent = vi.fn();
    renderHook(() => useRealtimeSettlements("group-1", onEvent));

    mockChannel.emit("INSERT", {
      id: "s1", group_id: "group-1", from_user_id: "alice", to_user_id: "bob",
      amount_cents: 2500, status: "pending", created_at: "2026-03-28T12:00:00Z", confirmed_at: null,
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: "inserted",
      settlement: {
        id: "s1", groupId: "group-1", fromUserId: "alice", toUserId: "bob",
        amountCents: 2500, status: "pending", createdAt: "2026-03-28T12:00:00Z", confirmedAt: undefined,
      },
    });
  });

  it("emits updated event on UPDATE", () => {
    const onEvent = vi.fn();
    renderHook(() => useRealtimeSettlements("group-1", onEvent));

    mockChannel.emit("UPDATE", {
      id: "s1", group_id: "group-1", from_user_id: "alice", to_user_id: "bob",
      amount_cents: 2500, status: "confirmed", created_at: "2026-03-28T12:00:00Z", confirmed_at: "2026-03-28T12:30:00Z",
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: "updated",
      settlement: {
        id: "s1", groupId: "group-1", fromUserId: "alice", toUserId: "bob",
        amountCents: 2500, status: "confirmed", createdAt: "2026-03-28T12:00:00Z", confirmedAt: "2026-03-28T12:30:00Z",
      },
    });
  });

  it("removes the channel on unmount", () => {
    const { unmount } = renderHook(() => useRealtimeSettlements("group-1", vi.fn()));
    unmount();
    expect(removeChannelSpy).toHaveBeenCalledWith(mockChannel);
  });

  it("uses ref to avoid re-subscribing when callback changes", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(({ cb }) => useRealtimeSettlements("group-1", cb), { initialProps: { cb: cb1 } });
    const firstChannel = mockChannel;
    rerender({ cb: cb2 });

    firstChannel.emit("INSERT", {
      id: "s2", group_id: "group-1", from_user_id: "carol", to_user_id: "bob",
      amount_cents: 1000, status: "pending", created_at: "2026-03-28T15:00:00Z", confirmed_at: null,
    });

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });
});
