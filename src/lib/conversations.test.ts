import { describe, expect, it } from "vitest";
import { conversationRow, matchesFilter, matchesQuery } from "./conversations";
import type { GroupSnapshot, UserProfile } from "@/types/ledger";

const me: UserProfile = {
  id: "user-me",
  handle: "alice",
  name: "Alice Souza",
  avatarUrl: null,
};

const carol: UserProfile = {
  id: "user-carol",
  handle: "carol",
  name: "Carol Souza",
  avatarUrl: null,
};

const dan: UserProfile = {
  id: "user-dan",
  handle: "dan",
  name: "Dan Lima",
  avatarUrl: null,
};

function member(groupId: string, user: UserProfile) {
  return {
    groupId,
    userId: user.id,
    status: "accepted" as const,
    invitedBy: null,
    acceptedAt: null,
    user,
  };
}

function makeSnapshot(
  kind: "dm" | "group",
  overrides: Partial<GroupSnapshot> = {},
): GroupSnapshot {
  const groupId = kind === "dm" ? "dm-1" : "group-1";
  return {
    group: {
      id: groupId,
      kind,
      name: kind === "dm" ? carol.name : "Churrasco",
      creatorId: me.id,
      dmUserA: kind === "dm" ? me.id : null,
      dmUserB: kind === "dm" ? carol.id : null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: kind === "dm" ? [member(groupId, me), member(groupId, carol)] : [member(groupId, me), member(groupId, carol), member(groupId, dan)],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-01T00:00:00Z",
    expenseCount: 0,
    ...overrides,
  };
}

describe("conversationRow", () => {
  it("keeps the group identity independent from the last speaker", () => {
    const snapshot = makeSnapshot("group", {
      lastMessage: {
        content: "Comprei o carvão",
        senderId: carol.id,
        createdAt: "2026-01-01T10:00:00Z",
      },
    });

    const row = conversationRow(snapshot, me.id);

    expect(row).toMatchObject({
      kind: "group",
      title: "Churrasco",
      avatarName: "Churrasco",
      avatarUrl: null,
      speaker: carol,
      href: "/app/groups/group-1/chat",
    });
  });

  it("marks an own DM message without changing another sender's preview", () => {
    const ownSnapshot = makeSnapshot("dm", {
      lastMessage: {
        content: "Eu pago hoje",
        senderId: me.id,
        createdAt: "2026-01-01T10:00:00Z",
      },
    });
    const otherSnapshot = makeSnapshot("dm", {
      lastMessage: {
        content: "Pode deixar",
        senderId: carol.id,
        createdAt: "2026-01-01T10:00:00Z",
      },
    });

    expect(conversationRow(ownSnapshot, me.id)).toMatchObject({
      preview: "Eu pago hoje",
      previewIsMine: true,
      speaker: me,
    });
    expect(conversationRow(otherSnapshot, me.id)).toMatchObject({
      preview: "Pode deixar",
      previewIsMine: false,
      speaker: carol,
    });
  });

  it("derives the net balance from group balances", () => {
    const snapshot = makeSnapshot("dm", {
      balances: [
        { kind: "user", participantId: me.id, netCents: -1800 },
        { kind: "user", participantId: carol.id, netCents: 1800 },
      ],
    });

    expect(conversationRow(snapshot, me.id)?.netCents).toBe(-1800);
  });

  it("includes a group without a last message", () => {
    const row = conversationRow(makeSnapshot("group"), me.id);

    expect(row).toMatchObject({ preview: "Sem mensagens", lastMessageAt: null });
  });

  it("excludes groups where the viewer is still invited", () => {
    const invitedMember = { ...member("group-1", me), status: "invited" as const };
    const snapshot = makeSnapshot("group", {
      members: [invitedMember, member("group-1", carol), member("group-1", dan)],
      lastMessage: {
        content: "Bem-vindo",
        senderId: carol.id,
        createdAt: "2026-01-01T10:00:00Z",
      },
    });

    expect(conversationRow(snapshot, me.id)).toBeNull();
  });
});

describe("conversation filters", () => {
  const row = conversationRow(
    makeSnapshot("dm", {
      balances: [
        { kind: "user", participantId: me.id, netCents: -1000 },
        { kind: "user", participantId: carol.id, netCents: 1000 },
      ],
    }),
    me.id,
  )!;

  it("matches all balance filters by net sign", () => {
    expect(matchesFilter("all", row.netCents)).toBe(true);
    expect(matchesFilter("owes", row.netCents)).toBe(true);
    expect(matchesFilter("owed", row.netCents)).toBe(false);
    expect(matchesFilter("none", row.netCents)).toBe(false);
    expect(matchesFilter("none", 0)).toBe(true);
  });

  it("composes query and filter predicates", () => {
    expect(matchesQuery(" car ", row)).toBe(true);
    expect(matchesQuery("dan", row)).toBe(false);
    expect(matchesFilter("owes", row.netCents) && matchesQuery("car", row)).toBe(true);
    expect(matchesFilter("owed", row.netCents) && matchesQuery("car", row)).toBe(false);
  });
});
