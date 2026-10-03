import { beforeEach, describe, expect, it } from "vitest";
import type { OpenAssignmentRoom } from "@/types/assignment-room";
import type { GroupSnapshot, Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import {
  selectHomeMode,
  selectHomeRecentBills,
  selectOpenRoomsFromOthers,
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
const dave = { id: "user-3", handle: "dave", name: "Dave Lima", avatarUrl: null, isBot: false };

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
    dmCounterparty: null,
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
    archivedAt: null,
    financialHistorySharedAt: null,
    formerMembers: [],
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
    const acceptedGroup = snapshot({
      recentExpenses: [{
        id: "expense-1", groupId: "g1", creatorId: me.id, status: "active",
        occurredOn: "2026-09-23", createdAt: "2026-09-23T12:00:00Z", versionNo: 1,
        title: "Peixe e camarão", merchantName: null, expenseType: "single_amount",
        totalCents: 15000, myShareCents: 7500, myPaidCents: 15000, participantCount: 2,
      }],
    });
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { [acceptedGroup.group.id]: acceptedGroup },
      groupOrder: [acceptedGroup.group.id],
    });
    expect(selectHomeMode(useAppStore.getState())).toBe("settled");
    expect(selectHomeRecentBills(useAppStore.getState()).map((bill) => bill.title)).toEqual(["Peixe e camarão"]);
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

describe("selectHomeRecentBills", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  it("skips expenses of archived groups", () => {
    const archivedGroup = snapshot({
      archivedAt: "2026-01-03T00:00:00Z",
      recentExpenses: [{
        id: "expense-archived", groupId: "g1", creatorId: me.id, status: "active",
        occurredOn: "2026-09-23", createdAt: "2026-09-23T12:00:00Z", versionNo: 1,
        title: "Arquivada", merchantName: null, expenseType: "single_amount",
        totalCents: 15000, myShareCents: 7500, myPaidCents: 15000, participantCount: 2,
      }],
    });
    const activeGroup = snapshot({
      group: { id: "g2", kind: "group", name: "Active", creatorId: me.id, dmUserA: null, dmUserB: null, ledgerVersion: 1, createdAt: "2026-01-01T00:00:00Z" },
      recentExpenses: [{
        id: "expense-active", groupId: "g2", creatorId: me.id, status: "active",
        occurredOn: "2026-09-24", createdAt: "2026-09-24T12:00:00Z", versionNo: 1,
        title: "Ativa", merchantName: null, expenseType: "single_amount",
        totalCents: 9000, myShareCents: 4500, myPaidCents: 9000, participantCount: 2,
      }],
    });
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { g1: archivedGroup, g2: activeGroup },
      groupOrder: ["g1", "g2"],
    });

    expect(selectHomeRecentBills(useAppStore.getState()).map((bill) => bill.title)).toEqual([
      "Ativa",
    ]);
  });
});

function openRoomFixture(overrides: Partial<OpenAssignmentRoom> = {}): OpenAssignmentRoom {
  return {
    id: "room-1",
    groupId: "g1",
    status: "open",
    revision: 1,
    title: "Conta do churrasco",
    occurredOn: "2026-09-20",
    totalCents: 12000,
    host: carol,
    createdAt: "2026-09-20T12:00:00Z",
    itemCount: 4,
    ownedItemCount: 1,
    claimers: [],
    expenseId: null,
    joined: false,
    ...overrides,
  };
}

describe("selectOpenRoomsFromOthers", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  it("keeps only open rooms hosted by someone else", () => {
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { g1: snapshot() },
      groupOrder: ["g1"],
      openAssignmentRoomsByGroupId: {
        g1: [
          openRoomFixture({ id: "room-mine", host: me }),
          openRoomFixture({ id: "room-closed", status: "closed" }),
          openRoomFixture({ id: "room-open" }),
        ],
      },
    });

    expect(selectOpenRoomsFromOthers(useAppStore.getState()).map((item) => item.room.id)).toEqual([
      "room-open",
    ]);
  });

  it("labels DM rows with the other person and group rows with the group name", () => {
    const dm = snapshot({
      group: { id: "dm-1", kind: "dm", name: "", dmUserA: me.id, dmUserB: carol.id, creatorId: me.id, ledgerVersion: 1, createdAt: "2026-01-01T00:00:00Z" },
      members: [
        { groupId: "dm-1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
        { groupId: "dm-1", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: null, user: carol },
      ],
    });
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { g1: snapshot(), "dm-1": dm },
      groupOrder: ["g1", "dm-1"],
      openAssignmentRoomsByGroupId: {
        g1: [openRoomFixture({ id: "room-group", groupId: "g1" })],
        "dm-1": [openRoomFixture({ id: "room-dm", groupId: "dm-1" })],
      },
    });

    const labels = selectOpenRoomsFromOthers(useAppStore.getState()).map(
      (item) => item.placeLabel,
    );
    expect(labels).toContain("Grupo 1");
    expect(labels).toContain("Carol Souza");
  });

  it("orders by createdAt desc then id desc", () => {
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { g1: snapshot() },
      groupOrder: ["g1"],
      openAssignmentRoomsByGroupId: {
        g1: [
          openRoomFixture({ id: "room-a", createdAt: "2026-09-20T12:00:00Z" }),
          openRoomFixture({ id: "room-z", createdAt: "2026-09-21T12:00:00Z" }),
          openRoomFixture({ id: "room-b", createdAt: "2026-09-20T12:00:00Z" }),
        ],
      },
    });

    expect(selectOpenRoomsFromOthers(useAppStore.getState()).map((item) => item.room.id)).toEqual([
      "room-z",
      "room-b",
      "room-a",
    ]);
  });

  it("returns the same array while inputs are unchanged", () => {
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { g1: snapshot() },
      groupOrder: ["g1"],
      openAssignmentRoomsByGroupId: { g1: [openRoomFixture()] },
    });
    const state = useAppStore.getState();

    expect(selectOpenRoomsFromOthers(state)).toBe(selectOpenRoomsFromOthers(state));
  });

  it("returns a new array after openAssignmentRoomsByGroupId changes", () => {
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { g1: snapshot() },
      groupOrder: ["g1"],
      openAssignmentRoomsByGroupId: { g1: [openRoomFixture()] },
    });
    const before = selectOpenRoomsFromOthers(useAppStore.getState());

    useAppStore.setState({
      openAssignmentRoomsByGroupId: {
        g1: [openRoomFixture(), openRoomFixture({ id: "room-2" })],
      },
    });

    const after = selectOpenRoomsFromOthers(useAppStore.getState());
    expect(after).not.toBe(before);
    expect(after.map((item) => item.room.id)).toEqual(["room-2", "room-1"]);
  });

  it("returns an empty array when signed out", () => {
    useAppStore.setState({
      hydrated: true,
      me: null,
      groups: { g1: snapshot() },
      groupOrder: ["g1"],
      openAssignmentRoomsByGroupId: { g1: [openRoomFixture()] },
    });

    expect(selectOpenRoomsFromOthers(useAppStore.getState())).toEqual([]);
  });

  it("skips rooms of archived groups", () => {
    const archived = snapshot({ archivedAt: "2026-01-03T00:00:00Z" });
    const active = snapshot({
      group: { id: "g2", kind: "group", name: "Ativo", creatorId: me.id, dmUserA: null, dmUserB: null, ledgerVersion: 1, createdAt: "2026-01-01T00:00:00Z" },
    });
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { g1: archived, g2: active },
      groupOrder: ["g1", "g2"],
      openAssignmentRoomsByGroupId: {
        g1: [openRoomFixture({ id: "room-archived", groupId: "g1", createdAt: "2026-09-25T12:00:00Z" })],
        g2: [openRoomFixture({ id: "room-active", groupId: "g2" })],
      },
    });

    expect(selectOpenRoomsFromOthers(useAppStore.getState()).map((item) => item.room.id)).toEqual([
      "room-active",
    ]);
  });

  it("hides unjoined rooms from blocked hosts but keeps joined ones", () => {
    useAppStore.setState({
      hydrated: true,
      me,
      blockedUsers: [carol],
      groups: { g1: snapshot() },
      groupOrder: ["g1"],
      openAssignmentRoomsByGroupId: {
        g1: [
          openRoomFixture({ id: "room-blocked" }),
          openRoomFixture({ id: "room-joined", joined: true, createdAt: "2026-09-21T12:00:00Z" }),
          openRoomFixture({ id: "room-other", host: dave }),
        ],
      },
    });

    expect(selectOpenRoomsFromOthers(useAppStore.getState()).map((item) => item.room.id)).toEqual([
      "room-joined",
      "room-other",
    ]);
  });

  it("recomputes when blockedUsers changes", () => {
    useAppStore.setState({
      hydrated: true,
      me,
      blockedUsers: [carol],
      groups: { g1: snapshot() },
      groupOrder: ["g1"],
      openAssignmentRoomsByGroupId: { g1: [openRoomFixture()] },
    });
    const before = selectOpenRoomsFromOthers(useAppStore.getState());
    expect(before).toEqual([]);

    useAppStore.setState({ blockedUsers: [] });
    const after = selectOpenRoomsFromOthers(useAppStore.getState());

    expect(after).not.toBe(before);
    expect(after.map((item) => item.room.id)).toEqual(["room-1"]);
  });
});
