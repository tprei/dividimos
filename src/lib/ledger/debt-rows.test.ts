import { beforeEach, describe, expect, it } from "vitest";
import type { BalanceRow, GroupSnapshot, Me, UserProfile } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import { debtRowsForGroup, selectDebtRows } from "./debt-rows";

const me: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice",
  avatarUrl: "https://example.com/alice.png",
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

function profile(id: string, name: string, avatarUrl: string | null): UserProfile {
  return { id, handle: name.toLowerCase(), name, avatarUrl };
}

function balance(kind: BalanceRow["kind"], participantId: string, netCents: number): BalanceRow {
  return { kind, participantId, netCents };
}

function snapshot(
  groupId: string,
  overrides: Partial<Omit<GroupSnapshot, "group">> & { group?: Partial<GroupSnapshot["group"]> } = {},
): GroupSnapshot {
  const base: GroupSnapshot = {
    group: {
      id: groupId,
      kind: "group",
      name: `Group ${groupId}`,
      creatorId: me.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
  };
  return { ...base, ...overrides, group: { ...base.group, ...overrides.group } };
}

const carol: UserProfile = profile("user-2", "Carol Souza", "https://example.com/carol.png");
const dave: UserProfile = profile("user-3", "Dave Lima", null);

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("debtRowsForGroup", () => {
  it("builds rows for me from minimized transfers, resolving users and guests", () => {
    const group = snapshot("g1", {
      members: [
        { groupId: "g1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
        { groupId: "g1", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: null, user: carol },
      ],
      balances: [
        balance("user", me.id, -8000),
        balance("user", carol.id, 5000),
        balance("guest", "guest-1", 3000),
      ],
      guests: [{ id: "guest-1", displayName: "Bruno Convidado", expenseId: "e1" }],
    });

    const rows = debtRowsForGroup(group, me.id);

    expect(rows).toEqual([
      {
        groupId: "g1",
        groupName: "Group g1",
        isDm: false,
        counterpartyKind: "user",
        counterpartyId: carol.id,
        counterpartyName: "Carol Souza",
        counterpartyAvatarUrl: carol.avatarUrl,
        amountCents: 5000,
        direction: "owes",
      },
      {
        groupId: "g1",
        groupName: "Group g1",
        isDm: false,
        counterpartyKind: "guest",
        counterpartyId: "guest-1",
        counterpartyName: "Bruno Convidado",
        counterpartyAvatarUrl: null,
        amountCents: 3000,
        direction: "owes",
      },
    ]);
  });

  it("marks rows owed when the counterparty pays me", () => {
    const group = snapshot("g2", {
      members: [
        { groupId: "g2", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
        { groupId: "g2", userId: dave.id, status: "accepted", invitedBy: null, acceptedAt: null, user: dave },
      ],
      balances: [balance("user", me.id, 2000), balance("user", dave.id, -2000)],
    });

    expect(debtRowsForGroup(group, me.id)).toEqual([
      {
        groupId: "g2",
        groupName: "Group g2",
        isDm: false,
        counterpartyKind: "user",
        counterpartyId: dave.id,
        counterpartyName: "Dave Lima",
        counterpartyAvatarUrl: null,
        amountCents: 2000,
        direction: "owed",
      },
    ]);
  });

  it("names a DM row after the counterparty", () => {
    const group = snapshot("dm-1", {
      group: { kind: "dm", name: "", dmUserA: me.id, dmUserB: carol.id },
      members: [
        { groupId: "dm-1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
        { groupId: "dm-1", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: null, user: carol },
      ],
      balances: [balance("user", me.id, -1000), balance("user", carol.id, 1000)],
    });

    const rows = debtRowsForGroup(group, me.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.groupName).toBe("Carol Souza");
    expect(rows[0]?.isDm).toBe(true);
  });

  it("returns no rows for transfers that do not involve me", () => {
    const group = snapshot("g3", {
      members: [
        { groupId: "g3", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: null, user: carol },
        { groupId: "g3", userId: dave.id, status: "accepted", invitedBy: null, acceptedAt: null, user: dave },
      ],
      balances: [balance("user", carol.id, -700), balance("user", dave.id, 700)],
    });

    expect(debtRowsForGroup(group, me.id)).toEqual([]);
  });
});

describe("selectDebtRows", () => {
  it("collects rows across groupOrder and returns the cached array while groups are unchanged", () => {
    const g1 = snapshot("g1", {
      members: [
        { groupId: "g1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
        { groupId: "g1", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: null, user: carol },
      ],
      balances: [balance("user", me.id, -500), balance("user", carol.id, 500)],
    });
    const g2 = snapshot("g2", {
      members: [
        { groupId: "g2", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
        { groupId: "g2", userId: dave.id, status: "accepted", invitedBy: null, acceptedAt: null, user: dave },
      ],
      balances: [balance("user", me.id, 300), balance("user", dave.id, -300)],
    });
    useAppStore.setState({ me, groups: { g1, g2 }, groupOrder: ["g1", "g2"] });

    const rows = selectDebtRows(useAppStore.getState());

    expect(rows.map((row) => [row.groupId, row.direction, row.amountCents])).toEqual([
      ["g1", "owes", 500],
      ["g2", "owed", 300],
    ]);
    expect(selectDebtRows(useAppStore.getState())).toBe(rows);

    useAppStore.setState({
      groups: {
        g1: snapshot("g1", {
          members: [
            { groupId: "g1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
            { groupId: "g1", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: null, user: carol },
          ],
          balances: [balance("user", me.id, -100), balance("user", carol.id, 100)],
        }),
      },
      groupOrder: ["g1"],
    });
    expect(selectDebtRows(useAppStore.getState())).toEqual([
      expect.objectContaining({ groupId: "g1", amountCents: 100, direction: "owes" }),
    ]);
  });
});
