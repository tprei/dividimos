import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRealtimeExpense } from "./use-realtime-expense";

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

describe("useRealtimeExpense", () => {
  it("does nothing when expenseId is undefined", () => {
    const onUpdate = vi.fn();
    renderHook(() => useRealtimeExpense(undefined, onUpdate));
    expect(removeChannelSpy).not.toHaveBeenCalled();
  });

  it("subscribes to UPDATE events on expenses table", () => {
    const onUpdate = vi.fn();
    renderHook(() => useRealtimeExpense("exp-1", onUpdate));

    expect(mockChannel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ event: "UPDATE", table: "expenses", filter: "id=eq.exp-1" }),
      expect.any(Function),
    );
    expect(mockChannel.subscribe).toHaveBeenCalled();
  });

  it("calls onUpdate with mapped fields on UPDATE", () => {
    const onUpdate = vi.fn();
    renderHook(() => useRealtimeExpense("exp-1", onUpdate));

    mockChannel.emit("UPDATE", { id: "exp-1", status: "active", updated_at: "2026-03-28T12:00:00Z" });

    expect(onUpdate).toHaveBeenCalledWith({ id: "exp-1", status: "active", updatedAt: "2026-03-28T12:00:00Z" });
  });

  it("removes the channel on unmount", () => {
    const onUpdate = vi.fn();
    const { unmount } = renderHook(() => useRealtimeExpense("exp-1", onUpdate));
    unmount();
    expect(removeChannelSpy).toHaveBeenCalledWith(mockChannel);
  });
});
