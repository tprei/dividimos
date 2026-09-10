import { describe, it, expect } from "vitest";
import type { GroupSnapshot } from "@/types/ledger";
import { hasUnreadActivity, newestActivityAt } from "./activity-badge";

function group(id: string, lastActivityAt: string): GroupSnapshot {
  return {
    group: {
      id,
      kind: "group",
      name: id,
      creatorId: "u1",
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    members: [],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    lastEventId: 1,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt,
    expenseCount: 0,
    pairwiseEdges: [],
  };
}

describe("newestActivityAt", () => {
  it("is null without groups and otherwise the latest across them", () => {
    expect(newestActivityAt({})).toBeNull();
    expect(
      newestActivityAt({
        a: group("a", "2026-01-02T10:00:00.000Z"),
        b: group("b", "2026-01-05T10:00:00.000Z"),
        c: group("c", "2026-01-03T10:00:00.000Z"),
      }),
    ).toBe("2026-01-05T10:00:00.000Z");
  });
});

describe("hasUnreadActivity", () => {
  it("is false when there is no activity at all", () => {
    expect(hasUnreadActivity(null, undefined)).toBe(false);
    expect(hasUnreadActivity(null, "2026-01-01T00:00:00.000Z")).toBe(false);
  });

  it("treats an account that has never viewed activity as having unread", () => {
    expect(hasUnreadActivity("2026-01-02T10:00:00.000Z", undefined)).toBe(true);
  });

  it("compares against what this account actually saw", () => {
    expect(hasUnreadActivity("2026-01-02T10:00:00.000Z", "2026-01-02T10:00:00.000Z")).toBe(false);
    expect(hasUnreadActivity("2026-01-03T10:00:00.000Z", "2026-01-02T10:00:00.000Z")).toBe(true);
    // A view recorded later than the newest row leaves nothing unread.
    expect(hasUnreadActivity("2026-01-01T10:00:00.000Z", "2026-01-02T10:00:00.000Z")).toBe(false);
  });
});
