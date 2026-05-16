import { describe, expect, it, vi } from "vitest";
import { getUnreadCounts, getTotalUnreadCount, markConversationRead } from "./unread-actions";

type UnreadRow = { group_id: string; unread_count: number };

function mockSupabase(overrides: {
  rpcRows?: UnreadRow[];
  dmPairs?: { group_id: string }[];
  upsertResult?: { error: null | { message: string } };
} = {}) {
  const cfg = {
    rpcRows: [] as UnreadRow[],
    dmPairs: [] as { group_id: string }[],
    upsertResult: { error: null },
    ...overrides,
  };

  const rpcMock = vi.fn().mockResolvedValue({ data: cfg.rpcRows, error: null });

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === "conversation_read_receipts") {
      return {
        upsert: () => Promise.resolve(cfg.upsertResult),
      };
    }
    if (table === "dm_pairs") {
      return {
        select: () => Promise.resolve({ data: cfg.dmPairs, error: null }),
      };
    }
    return {};
  });

  return { from: fromMock, rpc: rpcMock } as unknown as Parameters<typeof getUnreadCounts>[0];
}

describe("getUnreadCounts", () => {
  it("returns empty map for empty groupIds", async () => {
    const supabase = mockSupabase();
    const result = await getUnreadCounts(supabase, []);
    expect(result.size).toBe(0);
  });

  it("calls get_unread_counts RPC with the provided groupIds", async () => {
    const supabase = mockSupabase({ rpcRows: [] });
    await getUnreadCounts(supabase, ["g1", "g2"]);
    expect(supabase.rpc).toHaveBeenCalledWith("get_unread_counts", {
      p_group_ids: ["g1", "g2"],
    });
  });

  it("returns counts from RPC rows", async () => {
    const supabase = mockSupabase({
      rpcRows: [
        { group_id: "g1", unread_count: 2 },
        { group_id: "g2", unread_count: 1 },
      ],
    });

    const result = await getUnreadCounts(supabase, ["g1", "g2"]);
    expect(result.get("g1")).toBe(2);
    expect(result.get("g2")).toBe(1);
  });

  it("returns empty map when RPC returns no rows (all read)", async () => {
    const supabase = mockSupabase({ rpcRows: [] });

    const result = await getUnreadCounts(supabase, ["g1"]);
    expect(result.has("g1")).toBe(false);
  });

  it("returns empty map when RPC returns null data", async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(), rpc: rpcMock } as unknown as Parameters<typeof getUnreadCounts>[0];

    const result = await getUnreadCounts(supabase, ["g1"]);
    expect(result.size).toBe(0);
  });
});

describe("getTotalUnreadCount", () => {
  it("returns 0 when no DM pairs exist", async () => {
    const supabase = mockSupabase({ dmPairs: [] });
    const result = await getTotalUnreadCount(supabase);
    expect(result).toBe(0);
  });

  it("sums unread counts across all DM groups", async () => {
    const supabase = mockSupabase({
      dmPairs: [{ group_id: "g1" }, { group_id: "g2" }],
      rpcRows: [
        { group_id: "g1", unread_count: 2 },
        { group_id: "g2", unread_count: 1 },
      ],
    });

    const result = await getTotalUnreadCount(supabase);
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
