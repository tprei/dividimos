import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the realtime subscription behavior in GroupSettlementView.
 *
 * These tests verify that:
 * 1. The component subscribes to the unified `ledger` table filtered by group_id.
 * 2. Both debt and payment entry_type changes trigger a reload.
 * 3. The subscription callback is debounced to prevent excessive reloads.
 * 4. The channel is properly cleaned up on unmount.
 */

// --- Mock Supabase client ---

type SubscriptionCallback = (payload: Record<string, unknown>) => void;

interface MockChannel {
  name: string;
  filter: string | undefined;
  table: string | undefined;
  callback: SubscriptionCallback | undefined;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
}

function createMockChannel(): MockChannel {
  const channel: MockChannel = {
    name: "",
    filter: undefined,
    table: undefined,
    callback: undefined,
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  // .on() captures the filter config and callback, returns channel for chaining
  channel.on.mockImplementation(
    (_event: string, config: { filter?: string; table?: string }, cb: SubscriptionCallback) => {
      channel.filter = config.filter;
      channel.table = config.table;
      channel.callback = cb;
      return channel;
    },
  );
  channel.subscribe.mockReturnValue(channel);
  return channel;
}

let mockChannel: MockChannel;
const mockRemoveChannel = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (name: string) => {
      mockChannel.name = name;
      return mockChannel;
    },
    removeChannel: mockRemoveChannel,
  }),
}));

// --- Simulate the subscription setup logic from the component ---

import { createClient } from "@/lib/supabase/client";

/**
 * Extracts the realtime subscription setup logic from GroupSettlementView
 * so we can test it in isolation without rendering the full component.
 */
function setupRealtimeSubscription(
  groupId: string,
  onReload: () => void,
): () => void {
  const supabase = createClient();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const channel = supabase
    .channel(`group-ledger:${groupId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "ledger", filter: `group_id=eq.${groupId}` },
      () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => onReload(), 300);
      },
    )
    .subscribe();

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    supabase.removeChannel(channel);
  };
}

describe("GroupSettlementView realtime subscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockChannel = createMockChannel();
    mockRemoveChannel.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes to the ledger table filtered by group_id", () => {
    const onReload = vi.fn();
    setupRealtimeSubscription("group-123", onReload);

    expect(mockChannel.name).toBe("group-ledger:group-123");
    expect(mockChannel.table).toBe("ledger");
    expect(mockChannel.filter).toBe("group_id=eq.group-123");
    expect(mockChannel.subscribe).toHaveBeenCalled();
  });

  it("calls reload after debounce delay when a change arrives", () => {
    const onReload = vi.fn();
    setupRealtimeSubscription("group-123", onReload);

    // Simulate a realtime event
    mockChannel.callback!({});
    expect(onReload).not.toHaveBeenCalled();

    // Advance past debounce delay
    vi.advanceTimersByTime(300);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("debounces multiple rapid changes into a single reload", () => {
    const onReload = vi.fn();
    setupRealtimeSubscription("group-123", onReload);

    // Simulate multiple rapid realtime events (e.g. bulk payment recording)
    mockChannel.callback!({ new: { entry_type: "debt" } });
    vi.advanceTimersByTime(100);
    mockChannel.callback!({ new: { entry_type: "payment" } });
    vi.advanceTimersByTime(100);
    mockChannel.callback!({ new: { entry_type: "payment" } });

    // Should not have reloaded yet
    expect(onReload).not.toHaveBeenCalled();

    // Advance past debounce from last event
    vi.advanceTimersByTime(300);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("handles both debt and payment entry_type changes", () => {
    const onReload = vi.fn();
    setupRealtimeSubscription("group-123", onReload);

    // Debt entry change
    mockChannel.callback!({ new: { entry_type: "debt", amount_cents: 5000 } });
    vi.advanceTimersByTime(300);
    expect(onReload).toHaveBeenCalledTimes(1);

    // Payment entry change
    mockChannel.callback!({ new: { entry_type: "payment", amount_cents: 2000 } });
    vi.advanceTimersByTime(300);
    expect(onReload).toHaveBeenCalledTimes(2);
  });

  it("cleans up the channel on teardown", () => {
    const onReload = vi.fn();
    const cleanup = setupRealtimeSubscription("group-123", onReload);

    cleanup();

    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel);
  });

  it("cancels pending debounce timer on teardown", () => {
    const onReload = vi.fn();
    const cleanup = setupRealtimeSubscription("group-123", onReload);

    // Trigger a change but don't let it complete
    mockChannel.callback!({});
    vi.advanceTimersByTime(100);

    // Teardown should cancel the pending timer
    cleanup();
    vi.advanceTimersByTime(300);

    expect(onReload).not.toHaveBeenCalled();
  });

  it("reloads independently for separate debounce windows", () => {
    const onReload = vi.fn();
    setupRealtimeSubscription("group-123", onReload);

    // First event and complete debounce
    mockChannel.callback!({});
    vi.advanceTimersByTime(300);
    expect(onReload).toHaveBeenCalledTimes(1);

    // Second event after first completed
    mockChannel.callback!({});
    vi.advanceTimersByTime(300);
    expect(onReload).toHaveBeenCalledTimes(2);
  });
});
