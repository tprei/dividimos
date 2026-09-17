import { beforeEach, describe, expect, it } from "vitest";
import type { ExpenseSummary, GroupSnapshot, Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import {
  formatOccurredOn,
  groupNameOf,
  selectHomeMode,
  selectRecentBills,
} from "./home-selectors";

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
  notificationPreferences: {},
};

const carol = { id: "user-2", handle: "carol", name: "Carol Souza", avatarUrl: null, isBot: false };

function snapshot(overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
  const base: GroupSnapshot = {
    group: {
      id: "g1",
      kind: "group",
      name: "Grupo 1",
      creatorId: me.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      { groupId: "g1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
      { groupId: "g1", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: null, user: carol },
    ],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
    pairwiseEdges: [],
  };
  return { ...base, ...overrides, group: { ...base.group, ...overrides.group } };
}

describe("selectHomeMode", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  it("returns first-use when the user has no groups and no loaded expenses", () => {
    useAppStore.setState({ hydrated: true, me, groups: {}, groupOrder: [] });
    expect(selectHomeMode(useAppStore.getState())).toBe("first-use");
  });

  it("returns first-use when groups map only contains pending invitations", () => {
    const inviteOnly = snapshot({
      members: [
        { groupId: "g1", userId: me.id, status: "invited", invitedBy: carol.id, acceptedAt: null, user: me },
      ],
    });
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { [inviteOnly.group.id]: inviteOnly },
      groupOrder: [inviteOnly.group.id],
    });
    expect(selectHomeMode(useAppStore.getState())).toBe("first-use");
  });

  it("returns first-use when groups map only contains DM groups without expenses", () => {
    const dmGroup = snapshot({
      group: {
        id: "dm1",
        kind: "dm",
        name: "Direct",
        creatorId: carol.id,
        dmUserA: carol.id,
        dmUserB: me.id,
        ledgerVersion: 1,
        createdAt: "2026-01-01T00:00:00Z",
      },
    });
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { [dmGroup.group.id]: dmGroup },
      groupOrder: [dmGroup.group.id],
    });
    expect(selectHomeMode(useAppStore.getState())).toBe("first-use");
  });

  it("returns settled when user has an accepted non-DM group membership but zero debts", () => {
    const acceptedGroup = snapshot();
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { [acceptedGroup.group.id]: acceptedGroup },
      groupOrder: [acceptedGroup.group.id],
    });
    expect(selectHomeMode(useAppStore.getState())).toBe("settled");
  });

  it("returns settled when user has loaded expenses even without accepted groups", () => {
    useAppStore.setState({
      hydrated: true,
      me,
      groups: {},
      groupOrder: [],
      myExpenses: { ids: ["exp-1"], cursor: null, complete: true, total: 1 },
    });
    expect(selectHomeMode(useAppStore.getState())).toBe("settled");
  });

  it("returns outstanding when debt rows exist", () => {
    const debtGroup = snapshot({
      balances: [
        { kind: "user", participantId: me.id, netCents: -1500 },
        { kind: "user", participantId: carol.id, netCents: 1500 },
      ],
    });
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { [debtGroup.group.id]: debtGroup },
      groupOrder: [debtGroup.group.id],
    });
    expect(selectHomeMode(useAppStore.getState())).toBe("outstanding");
  });
});

describe("formatOccurredOn", () => {
  it("formats yyyy-mm-dd as dd/mm/yyyy", () => {
    expect(formatOccurredOn("2026-09-17")).toBe("17/09/2026");
  });

  it("returns original string on invalid format", () => {
    expect(formatOccurredOn("invalid")).toBe("invalid");
  });
});

describe("groupNameOf", () => {
  it("returns empty string if snapshot undefined", () => {
    expect(groupNameOf(undefined, "u1")).toBe("");
  });

  it("returns other member name for DM group", () => {
    const dmGroup = snapshot({
      group: {
        id: "dm1",
        kind: "dm",
        name: "Direct",
        creatorId: carol.id,
        dmUserA: carol.id,
        dmUserB: me.id,
        ledgerVersion: 1,
        createdAt: "2026-01-01T00:00:00Z",
      },
    });
    expect(groupNameOf(dmGroup, me.id)).toBe("Carol Souza");
  });

  it("returns group name for regular group", () => {
    const regular = snapshot();
    expect(groupNameOf(regular, me.id)).toBe("Grupo 1");
  });
});

describe("selectRecentBills", () => {
  it("returns up to limit active expenses skipping deleted ones", () => {
    const regular = snapshot();
    const e1: ExpenseSummary = {
      id: "e1",
      groupId: regular.group.id,
      creatorId: me.id,
      status: "active",
      occurredOn: "2026-09-10",
      createdAt: "2026-09-10T00:00:00Z",
      versionNo: 1,
      title: "Churrasco",
      merchantName: null,
      expenseType: "single_amount",
      totalCents: 10000,
      myShareCents: 5000,
      myPaidCents: 10000,
      participantCount: 2,
    };
    const e2: ExpenseSummary = {
      ...e1,
      id: "e2",
      status: "deleted",
      title: "Cancelado",
    };
    const e3: ExpenseSummary = {
      ...e1,
      id: "e3",
      title: "Uber",
      totalCents: 4500,
    };
    const e4: ExpenseSummary = {
      ...e1,
      id: "e4",
      title: "Padaria",
      totalCents: 2000,
    };
    const e5: ExpenseSummary = {
      ...e1,
      id: "e5",
      title: "Cinema",
      totalCents: 6000,
    };

    useAppStore.setState({
      hydrated: true,
      me,
      groups: { [regular.group.id]: regular },
      expenses: { e1, e2, e3, e4, e5 },
      myExpenses: { ids: ["e1", "e2", "e3", "e4", "e5"], cursor: null, complete: true, total: 5 },
    });

    const recent = selectRecentBills(useAppStore.getState(), 3);
    expect(recent).toHaveLength(3);
    expect(recent.map((r) => r.title)).toEqual(["Churrasco", "Uber", "Padaria"]);
    expect(recent[0].occurredOn).toBe("10/09/2026");
    expect(recent[0].groupName).toBe("Grupo 1");
  });
});
