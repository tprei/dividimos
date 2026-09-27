import { describe, expect, it } from "vitest";
import type { Me, WireGroupSnapshot } from "@/types/ledger";
import { decodeBootstrapOverviewV2, decodeGroupOverviewV2 } from "./decode-group-overview";

const me: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice",
  avatarUrl: null,
  isBot: false,
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: { expenses: true },
};

function wireSnapshot(groupId: string): WireGroupSnapshot {
  return {
    group: {
      id: groupId,
      kind: "group",
      name: "Trip",
      creatorId: "user-1",
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 3,
      createdAt: "2026-09-01T12:00:00.000Z",
    },
    members: [
      {
        groupId,
        userId: "user-1",
        status: "accepted",
        invitedBy: null,
        acceptedAt: "2026-09-01T12:00:00.000Z",
        user: { id: "user-1", handle: "alice", name: "Alice", avatarUrl: null, isBot: false },
      },
    ],
    balances: [{ kind: "user", participantId: "user-1", netCents: 1500 }],
    guests: [],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 42,
    unreadCount: 2,
    lastMessage: null,
    lastActivityAt: "2026-09-02T11:00:00.000Z",
    pairwiseEdges: [],
  };
}

function v2Entry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    snapshot: wireSnapshot("group-1"),
    overview: { avatar: { kind: "initials" }, spending: null },
    archivedAt: "2026-09-10T08:00:00.000Z",
    financialHistorySharedAt: "2026-09-09T08:00:00.000Z",
    formerMembers: [
      { id: "user-9", handle: "jennie", name: "Jennie", avatarUrl: null, isBot: false },
    ],
    ...overrides,
  };
}

describe("decodeGroupOverviewV2", () => {
  it("composes the store snapshot from the v1 snapshot and the lifecycle fields", () => {
    const result = decodeGroupOverviewV2(v2Entry());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.group.id).toBe("group-1");
    expect(result.value.overview).toEqual({ avatar: { kind: "initials" }, spending: null });
    expect(result.value.archivedAt).toBe("2026-09-10T08:00:00.000Z");
    expect(result.value.financialHistorySharedAt).toBe("2026-09-09T08:00:00.000Z");
    expect(result.value.formerMembers).toEqual([
      { id: "user-9", handle: "jennie", name: "Jennie", avatarUrl: null, isBot: false },
    ]);
  });

  it("accepts null lifecycle fields and empty former members", () => {
    const result = decodeGroupOverviewV2(
      v2Entry({ archivedAt: null, financialHistorySharedAt: null, formerMembers: [] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.archivedAt).toBeNull();
      expect(result.value.financialHistorySharedAt).toBeNull();
      expect(result.value.formerMembers).toEqual([]);
    }
  });

  it("rejects a v1 entry without the lifecycle keys", () => {
    const entry = v2Entry();
    delete (entry as Record<string, unknown>).archivedAt;
    const result = decodeGroupOverviewV2(entry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.path).toEqual(["archivedAt"]);
    }
  });

  it("rejects extra keys on the v2 entry", () => {
    const result = decodeGroupOverviewV2(v2Entry({ extra: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.path).toEqual(["extra"]);
    }
  });

  it("rejects a malformed former member profile", () => {
    const result = decodeGroupOverviewV2(
      v2Entry({ formerMembers: [{ id: "user-9" }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_wire");
      expect(result.issue.path).toEqual(["formerMembers", 0, "handle"]);
    }
  });
});

describe("decodeBootstrapOverviewV2", () => {
  it("decodes me, v2 group entries and serverTime", () => {
    const result = decodeBootstrapOverviewV2({
      me,
      groups: [v2Entry()],
      serverTime: "2026-09-05T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.me).toEqual(me);
    expect(result.value.serverTime).toBe("2026-09-05T00:00:00.000Z");
    expect(result.value.groups[0]?.archivedAt).toBe("2026-09-10T08:00:00.000Z");
    expect(result.value.groups[0]?.formerMembers).toHaveLength(1);
  });

  it("rejects an entry list that misses the lifecycle keys", () => {
    const entry = v2Entry();
    delete (entry as Record<string, unknown>).formerMembers;
    const result = decodeBootstrapOverviewV2({
      me,
      groups: [entry],
      serverTime: "2026-09-05T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.path).toEqual(["groups", 0, "formerMembers"]);
    }
  });
});
