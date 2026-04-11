import { describe, expect, it, vi } from "vitest";
import { getUnreadCounts, getTotalUnreadCount, markConversationRead } from "./unread-actions";

function mockSupabase(overrides: Record<string, unknown> = {}) {
  const defaults = {
    receipts: [] as { group_id: string; last_read_at: string }[],
    messages: [] as { group_id: string; created_at: string; sender_id?: string }[],
    dmPairs: [] as { group_id: string }[],
    upsertResult: { error: null },
  };
  const cfg = { ...defaults, ...overrides };

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === "conversation_read_receipts") {
      return {
        select: () => ({
          eq: () => ({
            in: () => Promise.resolve({ data: cfg.receipts, error: null }),
          }),
        }),
        upsert: () => Promise.resolve(cfg.upsertResult),
      };
    }
    if (table === "chat_messages") {
      return {
        select: () => ({
          in: () => ({
            neq: () => Promise.resolve({ data: cfg.messages, error: null }),
          }),
        }),
      };
    }
    if (table === "dm_pairs") {
      return {
        select: () => ({
          or: () => Promise.resolve({ data: cfg.dmPairs, error: null }),
        }),
      };
    }
    return {};
  });

  return { from: fromMock } as unknown as Parameters<typeof getUnreadCounts>[0];
}

describe("getUnreadCounts", () => {
  it("returns empty map for empty groupIds", async () => {
    const supabase = mockSupabase();
    const result = await getUnreadCounts(supabase, "user-1", []);
    expect(result.size).toBe(0);
  });

  it("counts all messages as unread when no read receipts exist", async () => {
    const supabase = mockSupabase({
      receipts: [],
      messages: [
        { group_id: "g1", created_at: "2026-04-11T10:00:00Z" },
        { group_id: "g1", created_at: "2026-04-11T11:00:00Z" },
        { group_id: "g2", created_at: "2026-04-11T12:00:00Z" },
      ],
    });

    const result = await getUnreadCounts(supabase, "user-1", ["g1", "g2"]);
    expect(result.get("g1")).toBe(2);
    expect(result.get("g2")).toBe(1);
  });

  it("only counts messages after last_read_at", async () => {
    const supabase = mockSupabase({
      receipts: [
        { group_id: "g1", last_read_at: "2026-04-11T10:30:00Z" },
      ],
      messages: [
        { group_id: "g1", created_at: "2026-04-11T10:00:00Z" },
        { group_id: "g1", created_at: "2026-04-11T11:00:00Z" },
        { group_id: "g1", created_at: "2026-04-11T12:00:00Z" },
      ],
    });

    const result = await getUnreadCounts(supabase, "user-1", ["g1"]);
    expect(result.get("g1")).toBe(2);
  });

  it("returns empty map when all messages are read", async () => {
    const supabase = mockSupabase({
      receipts: [
        { group_id: "g1", last_read_at: "2026-04-11T13:00:00Z" },
      ],
      messages: [
        { group_id: "g1", created_at: "2026-04-11T10:00:00Z" },
        { group_id: "g1", created_at: "2026-04-11T11:00:00Z" },
      ],
    });

    const result = await getUnreadCounts(supabase, "user-1", ["g1"]);
    expect(result.has("g1")).toBe(false);
  });
});

describe("getTotalUnreadCount", () => {
  it("returns 0 when no DM pairs exist", async () => {
    const supabase = mockSupabase({ dmPairs: [] });
    const result = await getTotalUnreadCount(supabase, "user-1");
    expect(result).toBe(0);
  });

  it("sums unread counts across all DM groups", async () => {
    const supabase = mockSupabase({
      dmPairs: [{ group_id: "g1" }, { group_id: "g2" }],
      receipts: [],
      messages: [
        { group_id: "g1", created_at: "2026-04-11T10:00:00Z" },
        { group_id: "g1", created_at: "2026-04-11T11:00:00Z" },
        { group_id: "g2", created_at: "2026-04-11T12:00:00Z" },
      ],
    });

    const result = await getTotalUnreadCount(supabase, "user-1");
    expect(result).toBe(3);
  });
});

describe("markConversationRead", () => {
  it("calls upsert with correct parameters", async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: () => ({ upsert: upsertMock }),
    } as unknown as Parameters<typeof markConversationRead>[0];

    await markConversationRead(supabase, "user-1", "group-1");

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        group_id: "group-1",
      }),
      { onConflict: "user_id,group_id" },
    );
  });
});
