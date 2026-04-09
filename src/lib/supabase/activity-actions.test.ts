import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  return { mockFrom };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ from: mockFrom }),
}));

import { fetchActivityFeed } from "./activity-actions";

function mockFromSequence(responses: Array<{ data: unknown; error: null }>) {
  let idx = 0;
  mockFrom.mockImplementation(() => {
    const resp = responses[idx++] ?? { data: [], error: null };
    const innerChain: Record<string, unknown> = {};
    const methods = [
      "select", "eq", "neq", "not", "in", "lt", "order", "limit",
    ];
    for (const m of methods) {
      innerChain[m] = vi.fn().mockReturnValue(innerChain);
    }
    // Make the chain thenable so `await` resolves to the response
    innerChain.then = (resolve: (v: unknown) => void) => resolve(resp);
    return innerChain;
  });
}

describe("activity-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchActivityFeed", () => {
    it("returns empty array when user has no groups", async () => {
      mockFromSequence([{ data: [], error: null }]);
      const result = await fetchActivityFeed({ userId: "u1" });
      expect(result).toEqual([]);
    });

    it("merges expenses, settlements, and member joins sorted by timestamp desc", async () => {
      mockFromSequence([
        { data: [{ group_id: "g1" }], error: null },
        { data: [{ id: "e1", group_id: "g1", creator_id: "u2", title: "Almoço", total_amount: 5000, created_at: "2026-01-03T12:00:00Z" }], error: null },
        { data: [{ id: "s1", group_id: "g1", from_user_id: "u1", to_user_id: "u2", amount_cents: 2500, status: "confirmed", created_at: "2026-01-02T10:00:00Z", confirmed_at: "2026-01-02T11:00:00Z" }], error: null },
        { data: [{ group_id: "g1", user_id: "u3", accepted_at: "2026-01-01T09:00:00Z" }], error: null },
        { data: [{ id: "g1", name: "Amigos" }], error: null },
        { data: [{ id: "u1", handle: "alice", name: "Alice", avatar_url: null }, { id: "u2", handle: "bob", name: "Bob", avatar_url: null }, { id: "u3", handle: "carol", name: "Carol", avatar_url: null }], error: null },
      ]);

      const result = await fetchActivityFeed({ userId: "u1" });

      expect(result.length).toBe(4);
      expect(result[0].type).toBe("expense_activated");
      expect(result[0].timestamp).toBe("2026-01-03T12:00:00Z");
      expect(result[1].type).toBe("settlement_confirmed");
      expect(result[1].timestamp).toBe("2026-01-02T11:00:00Z");
      expect(result[2].type).toBe("settlement_recorded");
      expect(result[2].timestamp).toBe("2026-01-02T10:00:00Z");
      expect(result[3].type).toBe("member_joined");
      expect(result[3].timestamp).toBe("2026-01-01T09:00:00Z");
    });

    it("respects the limit option", async () => {
      mockFromSequence([
        { data: [{ group_id: "g1" }], error: null },
        { data: [
          { id: "e1", group_id: "g1", creator_id: "u2", title: "D1", total_amount: 1000, created_at: "2026-01-03T12:00:00Z" },
          { id: "e2", group_id: "g1", creator_id: "u2", title: "D2", total_amount: 2000, created_at: "2026-01-02T12:00:00Z" },
          { id: "e3", group_id: "g1", creator_id: "u2", title: "D3", total_amount: 3000, created_at: "2026-01-01T12:00:00Z" },
        ], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [{ id: "g1", name: "Amigos" }], error: null },
        { data: [{ id: "u2", handle: "bob", name: "Bob", avatar_url: null }], error: null },
      ]);

      const result = await fetchActivityFeed({ userId: "u1", limit: 2 });
      expect(result.length).toBe(2);
      expect(result[0].timestamp).toBe("2026-01-03T12:00:00Z");
      expect(result[1].timestamp).toBe("2026-01-02T12:00:00Z");
    });

    it("enriches activity items with group name and actor profile", async () => {
      mockFromSequence([
        { data: [{ group_id: "g1" }], error: null },
        { data: [{ id: "e1", group_id: "g1", creator_id: "u2", title: "Pizza", total_amount: 8000, created_at: "2026-01-01T12:00:00Z" }], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [{ id: "g1", name: "Trabalho" }], error: null },
        { data: [{ id: "u2", handle: "joao", name: "João", avatar_url: "https://example.com/joao.jpg" }], error: null },
      ]);

      const result = await fetchActivityFeed({ userId: "u1" });

      expect(result.length).toBe(1);
      const item = result[0];
      expect(item.groupName).toBe("Trabalho");
      expect(item.actor).toEqual({
        id: "u2",
        handle: "joao",
        name: "João",
        avatarUrl: "https://example.com/joao.jpg",
      });
      if (item.type === "expense_activated") {
        expect(item.expenseTitle).toBe("Pizza");
        expect(item.totalAmount).toBe(8000);
      }
    });

    it("falls back to default profile when user not found", async () => {
      mockFromSequence([
        { data: [{ group_id: "g1" }], error: null },
        { data: [{ id: "e1", group_id: "g1", creator_id: "unknown-user", title: "Test", total_amount: 100, created_at: "2026-01-01T12:00:00Z" }], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [{ id: "g1", name: "G" }], error: null },
        { data: [], error: null },
      ]);

      const result = await fetchActivityFeed({ userId: "u1" });

      expect(result.length).toBe(1);
      expect(result[0].actor.name).toBe("Usuário");
      expect(result[0].actor.id).toBe("unknown-user");
    });

    it("generates confirmed settlement activity with correct actor", async () => {
      mockFromSequence([
        { data: [{ group_id: "g1" }], error: null },
        { data: [], error: null },
        { data: [{ id: "s1", group_id: "g1", from_user_id: "u1", to_user_id: "u2", amount_cents: 3000, status: "confirmed", created_at: "2026-01-01T10:00:00Z", confirmed_at: "2026-01-01T11:00:00Z" }], error: null },
        { data: [], error: null },
        { data: [{ id: "g1", name: "G" }], error: null },
        { data: [{ id: "u1", handle: "a", name: "A", avatar_url: null }, { id: "u2", handle: "b", name: "B", avatar_url: null }], error: null },
      ]);

      const result = await fetchActivityFeed({ userId: "u1" });

      expect(result.length).toBe(2);

      const confirmed = result.find((i) => i.type === "settlement_confirmed");
      expect(confirmed).toBeDefined();
      expect(confirmed!.actorId).toBe("u2");
      if (confirmed!.type === "settlement_confirmed") {
        expect(confirmed!.fromUserId).toBe("u1");
        expect(confirmed!.fromUser.name).toBe("A");
      }

      const recorded = result.find((i) => i.type === "settlement_recorded");
      expect(recorded).toBeDefined();
      expect(recorded!.actorId).toBe("u1");
    });
  });
});
