import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRealtimeChat } from "./use-realtime-chat";

type ChannelCallback = (payload: {
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}) => void;

function createMockChannel() {
  const listeners: { event: string; cb: ChannelCallback }[] = [];
  const channel = {
    on: vi.fn(
      (_type: string, opts: { event: string }, cb: ChannelCallback) => {
        listeners.push({ event: opts.event, cb });
        return channel;
      },
    ),
    subscribe: vi.fn(() => channel),
    _listeners: listeners,
    emit(
      event: string,
      payload: {
        new?: Record<string, unknown>;
        old?: Record<string, unknown>;
      },
    ) {
      for (const l of listeners) {
        if (l.event === event) l.cb(payload);
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

const sampleRow = {
  id: "msg-1",
  group_id: "group-1",
  sender_id: "user-a",
  message_type: "text" as const,
  content: "Olá!",
  expense_id: null,
  settlement_id: null,
  created_at: "2026-04-12T10:00:00Z",
};

describe("useRealtimeChat", () => {
  it("does nothing when groupId is undefined", () => {
    renderHook(() => useRealtimeChat(undefined, vi.fn()));
    expect(removeChannelSpy).not.toHaveBeenCalled();
  });

  it("subscribes to INSERT, UPDATE, and DELETE events on chat_messages table", () => {
    renderHook(() => useRealtimeChat("group-1", vi.fn()));

    expect(mockChannel.on).toHaveBeenCalledTimes(3);
    expect(mockChannel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "INSERT",
        table: "chat_messages",
        filter: "group_id=eq.group-1",
      }),
      expect.any(Function),
    );
    expect(mockChannel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "UPDATE",
        table: "chat_messages",
        filter: "group_id=eq.group-1",
      }),
      expect.any(Function),
    );
    expect(mockChannel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "DELETE",
        table: "chat_messages",
        filter: "group_id=eq.group-1",
      }),
      expect.any(Function),
    );
  });

  it("fires inserted event with mapped ChatMessage on INSERT", () => {
    const cb = vi.fn();
    renderHook(() => useRealtimeChat("group-1", cb));

    mockChannel.emit("INSERT", { new: sampleRow });

    expect(cb).toHaveBeenCalledWith({
      type: "inserted",
      message: {
        id: "msg-1",
        groupId: "group-1",
        senderId: "user-a",
        messageType: "text",
        content: "Olá!",
        expenseId: undefined,
        settlementId: undefined,
        createdAt: "2026-04-12T10:00:00Z",
      },
    });
  });

  it("fires inserted event for system_expense messages with expenseId", () => {
    const cb = vi.fn();
    renderHook(() => useRealtimeChat("group-1", cb));

    mockChannel.emit("INSERT", {
      new: {
        ...sampleRow,
        id: "msg-2",
        message_type: "system_expense",
        expense_id: "exp-1",
      },
    });

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "inserted",
        message: expect.objectContaining({
          messageType: "system_expense",
          expenseId: "exp-1",
        }),
      }),
    );
  });

  it("fires updated event with mapped ChatMessage on UPDATE", () => {
    const cb = vi.fn();
    renderHook(() => useRealtimeChat("group-1", cb));

    mockChannel.emit("UPDATE", {
      new: { ...sampleRow, content: "Editado" },
    });

    expect(cb).toHaveBeenCalledWith({
      type: "updated",
      message: expect.objectContaining({
        id: "msg-1",
        content: "Editado",
      }),
    });
  });

  it("fires deleted event with messageId on DELETE", () => {
    const cb = vi.fn();
    renderHook(() => useRealtimeChat("group-1", cb));

    mockChannel.emit("DELETE", { old: { id: "msg-1" } });

    expect(cb).toHaveBeenCalledWith({
      type: "deleted",
      messageId: "msg-1",
    });
  });

  it("removes the channel on unmount", () => {
    const { unmount } = renderHook(() =>
      useRealtimeChat("group-1", vi.fn()),
    );
    unmount();
    expect(removeChannelSpy).toHaveBeenCalledWith(mockChannel);
  });

  it("uses ref to avoid re-subscribing when callback changes", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(
      ({ cb }) => useRealtimeChat("group-1", cb),
      { initialProps: { cb: cb1 } },
    );
    const firstChannel = mockChannel;
    rerender({ cb: cb2 });

    firstChannel.emit("INSERT", { new: sampleRow });

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });

  it("does not subscribe when NEXT_PUBLIC_SUPABASE_URL is missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevChannel = mockChannel;
    const cb = vi.fn();
    renderHook(() => useRealtimeChat("group-1", cb));
    // The effect should return early — no new channel created
    expect(mockChannel).toBe(prevChannel);
  });
});
