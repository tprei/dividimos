import { describe, expect, it } from "vitest";
import type { GroupSnapshot, UserProfile } from "@/types/ledger";
import { canDeleteGroup, groupArchiveAction, isGroupArchived, myGroupNetCents } from "./group-lifecycle";

const me: UserProfile = { id: "user-1", handle: "alice", name: "Alice", avatarUrl: null, isBot: false };
const bob: UserProfile = { id: "user-2", handle: "bob", name: "Bob", avatarUrl: null, isBot: false };

function member(user: UserProfile, status: "accepted" | "invited") {
  return { groupId: "g1", userId: user.id, status, invitedBy: null, acceptedAt: null, user };
}

function snapshot(overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return {
    group: {
      id: "g1",
      kind: "group",
      name: "Viagem",
      creatorId: me.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [member(me, "accepted"), member(bob, "accepted")],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: null,
    pairwiseEdges: [],
    archivedAt: null,
    financialHistorySharedAt: null,
    formerMembers: [],
    ...overrides,
  };
}

describe("isGroupArchived", () => {
  it("reads the archive timestamp", () => {
    expect(isGroupArchived(snapshot())).toBe(false);
    expect(isGroupArchived(snapshot({ archivedAt: "2026-09-10T08:00:00.000Z" }))).toBe(true);
  });
});

describe("myGroupNetCents", () => {
  it("returns my own user balance and 0 without one", () => {
    expect(myGroupNetCents(snapshot({ balances: [{ kind: "user", participantId: me.id, netCents: -4143 }] }), me.id)).toBe(-4143);
    expect(myGroupNetCents(snapshot({ balances: [{ kind: "guest", participantId: "guest-1", netCents: 900 }] }), me.id)).toBe(0);
    expect(myGroupNetCents(snapshot({ balances: [] }), me.id)).toBe(0);
  });
});

describe("groupArchiveAction", () => {
  it("returns null when I am not an accepted member", () => {
    expect(groupArchiveAction(snapshot({ members: [] }), me.id)).toBeNull();
    expect(groupArchiveAction(snapshot({ members: [member(me, "invited")] }), me.id)).toBeNull();
  });

  it("offers unarchive for an accepted member of an archived group", () => {
    const archived = snapshot({
      archivedAt: "2026-09-10T08:00:00.000Z",
      balances: [{ kind: "user", participantId: me.id, netCents: 500 }],
    });
    expect(groupArchiveAction(archived, me.id)).toBe("unarchive");
  });

  it("offers archive only at zero balance and blocks otherwise", () => {
    expect(groupArchiveAction(snapshot(), me.id)).toBe("archive");
    expect(
      groupArchiveAction(
        snapshot({ balances: [{ kind: "user", participantId: me.id, netCents: 1 }] }),
        me.id,
      ),
    ).toBe("blocked_by_balance");
  });

  it("lets an accepted DM member archive", () => {
    const dm = snapshot({
      group: {
        id: "dm-1",
        kind: "dm",
        name: "",
        creatorId: me.id,
        dmUserA: me.id,
        dmUserB: bob.id,
        ledgerVersion: 1,
        createdAt: "2026-01-01T00:00:00Z",
      },
      members: [member(me, "accepted")],
    });
    expect(groupArchiveAction(dm, me.id)).toBe("archive");
  });
});

describe("canDeleteGroup", () => {
  it("is true for the creator while the history latch is unset", () => {
    expect(canDeleteGroup(snapshot(), me.id)).toBe(true);
  });

  it("is false once the history latch is set", () => {
    expect(canDeleteGroup(snapshot({ financialHistorySharedAt: "2026-09-09T08:00:00.000Z" }), me.id)).toBe(false);
  });

  it("is false for a non-creator", () => {
    expect(canDeleteGroup(snapshot(), bob.id)).toBe(false);
  });

  it("is false while any balance remains, including a guest's", () => {
    const guestOwes = snapshot({
      members: [member(me, "accepted")],
      balances: [
        { kind: "user", participantId: me.id, netCents: 900 },
        { kind: "guest", participantId: "guest-1", netCents: -900 },
      ],
    });
    expect(canDeleteGroup(guestOwes, me.id)).toBe(false);
  });
});
