import { describe, expect, it } from "vitest";
import {
  filterConversations,
  type ConversationEntry,
} from "./conversations-list-content";

function entry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
  return {
    groupId: overrides.groupId ?? "g1",
    counterparty: overrides.counterparty ?? {
      id: "u1",
      handle: "user",
      name: "User Name",
    },
    lastMessageContent: overrides.lastMessageContent ?? null,
    lastMessageAt: overrides.lastMessageAt ?? null,
    netBalanceCents: overrides.netBalanceCents ?? 0,
  };
}

describe("filterConversations", () => {
  const entries: ConversationEntry[] = [
    entry({
      groupId: "g1",
      counterparty: { id: "u1", handle: "maria", name: "Maria Silva" },
      lastMessageContent: "Oi, tudo bem?",
    }),
    entry({
      groupId: "g2",
      counterparty: { id: "u2", handle: "joao", name: "João Santos" },
      lastMessageContent: "Vamos dividir a conta",
    }),
    entry({
      groupId: "g3",
      counterparty: { id: "u3", handle: "ana_luz", name: "Ana Luz" },
      lastMessageContent: null,
    }),
  ];

  it("returns all entries for empty query", () => {
    expect(filterConversations(entries, "")).toEqual(entries);
  });

  it("returns all entries for single character query", () => {
    expect(filterConversations(entries, "M")).toEqual(entries);
  });

  it("returns all entries for whitespace-only query", () => {
    expect(filterConversations(entries, "   ")).toEqual(entries);
  });

  it("filters by name", () => {
    const result = filterConversations(entries, "Maria");
    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe("g1");
  });

  it("filters by handle", () => {
    const result = filterConversations(entries, "joao");
    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe("g2");
  });

  it("filters by handle with underscore", () => {
    const result = filterConversations(entries, "ana_luz");
    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe("g3");
  });

  it("filters by last message content", () => {
    const result = filterConversations(entries, "dividir");
    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe("g2");
  });

  it("is case insensitive", () => {
    const result = filterConversations(entries, "MARIA");
    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe("g1");
  });

  it("returns empty array when nothing matches", () => {
    expect(filterConversations(entries, "zzzzz")).toEqual([]);
  });

  it("matches partial strings", () => {
    const result = filterConversations(entries, "Ma");
    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe("g1");
  });

  it("trims whitespace from query", () => {
    const result = filterConversations(entries, "  Maria  ");
    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe("g1");
  });

  it("matches multiple entries with shared term", () => {
    const result = filterConversations(entries, "an");
    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.groupId);
    expect(ids).toContain("g2");
    expect(ids).toContain("g3");
  });
});
