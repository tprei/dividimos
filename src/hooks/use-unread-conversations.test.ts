import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

type ChannelCallback = (payload: { new: Record<string, unknown> | null }) => void;

const channelNames: string[] = [];

function createMockChannel(name: string) {
  channelNames.push(name);
  const listeners: ChannelCallback[] = [];
  const channel = {
    on: vi.fn((_type: string, _opts: unknown, cb: ChannelCallback) => {
      listeners.push(cb);
      return channel;
    }),
    subscribe: vi.fn(() => channel),
    emit(row: Record<string, unknown> | null) {
      for (const cb of listeners) cb({ new: row });
    },
  };
  return channel;
}

let lastChannel: ReturnType<typeof createMockChannel>;
const removeChannelSpy = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (name: string) => {
      lastChannel = createMockChannel(name);
      return lastChannel;
    },
    removeChannel: removeChannelSpy,
  }),
}));

const mockGetTotalUnreadCount = vi.fn();
vi.mock("@/lib/supabase/unread-actions", () => ({
  getTotalUnreadCount: () => mockGetTotalUnreadCount(),
}));

const mockUseUser = vi.fn();
vi.mock("@/hooks/use-auth", () => ({
  useUser: () => mockUseUser(),
}));

const { useUnreadConversations } = await import("./use-unread-conversations");

beforeEach(() => {
  vi.useFakeTimers();
  channelNames.length = 0;
  removeChannelSpy.mockClear();
  mockGetTotalUnreadCount.mockReset().mockResolvedValue(3);
  mockUseUser.mockReturnValue({ id: "me" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useUnreadConversations", () => {
  it("uses a unique channel name per mount (no HMR/multi-mount collision)", () => {
    renderHook(() => useUnreadConversations());
    renderHook(() => useUnreadConversations());

    expect(channelNames).toHaveLength(2);
    expect(channelNames[0]).not.toBe(channelNames[1]);
    expect(channelNames[0]).toMatch(/^unread-badge:/);
  });

  it("ignores the user's own messages", async () => {
    renderHook(() => useUnreadConversations());
    await act(async () => {}); // flush mount refresh
    mockGetTotalUnreadCount.mockClear();

    act(() => {
      lastChannel.emit({ sender_id: "me" });
      vi.advanceTimersByTime(600);
    });

    expect(mockGetTotalUnreadCount).not.toHaveBeenCalled();
  });

  it("ignores malformed payloads", async () => {
    renderHook(() => useUnreadConversations());
    await act(async () => {});
    mockGetTotalUnreadCount.mockClear();

    act(() => {
      lastChannel.emit(null);
      lastChannel.emit({} as Record<string, unknown>);
      vi.advanceTimersByTime(600);
    });

    expect(mockGetTotalUnreadCount).not.toHaveBeenCalled();
  });

  it("re-fetches the authoritative count (debounced) on another user's message", async () => {
    renderHook(() => useUnreadConversations());
    await act(async () => {});
    mockGetTotalUnreadCount.mockClear();

    act(() => {
      lastChannel.emit({ sender_id: "other-1" });
      lastChannel.emit({ sender_id: "other-2" });
    });
    // Debounced: not called immediately, and the burst coalesces into one call.
    expect(mockGetTotalUnreadCount).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(mockGetTotalUnreadCount).toHaveBeenCalledTimes(1);
  });
});
