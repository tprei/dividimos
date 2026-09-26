import { beforeEach, describe, expect, it } from "vitest";
import type {
  BalanceRow,
  ExpenseSummary,
  GroupMember,
  GroupSnapshot,
  Me,
  MemberStatus,
} from "@/types/ledger";
import { useAppStore } from "./app-store";
import {
  formatOccurredOn,
  groupNameOf,
  selectConversationRows,
  selectDmMembership,
  selectExpenseList,
  selectHomeRecentBills,
  selectMyDebts,
  selectMyExpenseRows,
  selectPairEdgeCents,
  selectPendingInvitations,
  selectRecentBills,
  selectTransfers,
  selectUnreadTotal,
} from "./app-selectors";

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

function balance(participantId: string, netCents: number): BalanceRow {
  return { kind: "user", participantId, netCents };
}

function snapshot(groupId: string, overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
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
    expenseCount: 0,
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
    pairwiseEdges: [],
  };
  return { ...base, ...overrides, group: { ...base.group, ...overrides.group } };
}

function member(userId: string, status: MemberStatus, invitedBy: string | null = null): GroupMember {
  return {
    groupId: "g1",
    userId,
    status,
    invitedBy,
    acceptedAt: status === "accepted" ? "2026-01-02T00:00:00Z" : null,
    user: {
      id: userId,
      handle: `${userId}-handle`,
      name: `User ${userId}`,
      avatarUrl: null,
      isBot: false,
    },
  };
}

function summary(id: string, groupId: string): ExpenseSummary {
  return {
    id,
    groupId,
    creatorId: me.id,
    status: "active",
    occurredOn: "2026-01-01",
    createdAt: "2026-01-01T00:00:00Z",
    versionNo: 1,
    title: `Expense ${id}`,
    merchantName: null,
    expenseType: "single_amount",
    totalCents: 1000,
    myShareCents: 0,
    myPaidCents: 0,
    participantCount: 1,
  };
}

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("selectTransfers", () => {
  it("minimizes balances into transfers", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", { balances: [balance("user-1", -500), balance("user-2", 500)] }) },
      groupOrder: ["g1"],
    });
    expect(selectTransfers(useAppStore.getState(), "g1")).toEqual([
      { fromKind: "user", fromId: "user-1", toId: "user-2", amountCents: 500 },
    ]);
  });

  it("returns the same array identity while ledgerVersion and balances identity are unchanged", () => {
    const snapshotA = snapshot("g1", { balances: [balance("user-1", -500), balance("user-2", 500)] });
    useAppStore.setState({ me, groups: { g1: snapshotA }, groupOrder: ["g1"] });

    const first = selectTransfers(useAppStore.getState(), "g1");
    const second = selectTransfers(useAppStore.getState(), "g1");

    expect(second).toBe(first);
  });

  it("recomputes when the balances array identity changes without a ledgerVersion bump", () => {
    const balances = [balance("user-1", -500), balance("user-2", 500)];
    useAppStore.setState({ me, groups: { g1: snapshot("g1", { balances }) }, groupOrder: ["g1"] });
    const before = selectTransfers(useAppStore.getState(), "g1");

    useAppStore.setState({
      groups: { g1: snapshot("g1", { balances: [...balances, balance("user-3", 0)] }) },
    });
    const after = selectTransfers(useAppStore.getState(), "g1");

    expect(after).not.toBe(before);
    expect(after).toEqual(before);
  });
});

describe("selectPairEdgeCents", () => {
  it("returns the minimized edge amount in the requested direction", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", { balances: [balance("user-1", -500), balance("user-2", 500)] }) },
      groupOrder: ["g1"],
    });

    expect(selectPairEdgeCents(useAppStore.getState(), "g1", "user-1", "user-2")).toBe(500);
    expect(selectPairEdgeCents(useAppStore.getState(), "g1", "user-2", "user-1")).toBe(0);
  });

  it("returns 0 when a reroute dissolves the pair edge while the debt survives", () => {
    useAppStore.setState({
      me,
      groups: {
        g1: snapshot("g1", {
          balances: [
            balance("user-a", -50),
            balance("user-b", 150),
            balance("user-c", 50),
            balance("user-d", -150),
          ],
        }),
      },
      groupOrder: ["g1"],
    });

    // Greedy pairs D→B 150 and A→C 50; no A→B edge exists.
    expect(selectPairEdgeCents(useAppStore.getState(), "g1", "user-a", "user-b")).toBe(0);
    expect(selectPairEdgeCents(useAppStore.getState(), "g1", "user-d", "user-b")).toBe(150);
  });
});

describe("selectMyDebts", () => {
  it("filters to groups where I owe or am owed, in groupOrder order", () => {
    useAppStore.setState({
      me,
      groups: {
        g1: snapshot("g1", { balances: [balance("user-1", -500), balance("user-2", 500)] }),
        g2: snapshot("g2", { balances: [balance("user-2", -200), balance("user-3", 200)] }),
        g3: snapshot("g3", { balances: [balance("user-1", 300), balance("user-4", -300)] }),
      },
      groupOrder: ["g1", "g2", "g3"],
    });

    const debts = selectMyDebts(useAppStore.getState());

    expect(debts.map((row) => row.groupId)).toEqual(["g1", "g3"]);
    expect(debts[0]?.owes).toEqual([{ fromKind: "user", fromId: "user-1", toId: "user-2", amountCents: 500 }]);
    expect(debts[0]?.owed).toEqual([]);
    expect(debts[1]?.owes).toEqual([]);
    expect(debts[1]?.owed).toEqual([{ fromKind: "user", fromId: "user-4", toId: "user-1", amountCents: 300 }]);
  });

  it("returns the cached array while groups and me are unchanged", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", { balances: [balance("user-1", -500), balance("user-2", 500)] }) },
      groupOrder: ["g1"],
    });

    const first = selectMyDebts(useAppStore.getState());
    expect(selectMyDebts(useAppStore.getState())).toBe(first);
  });
});

describe("selectUnreadTotal", () => {
  it("sums unreadCount across groups", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", { unreadCount: 2 }), g2: snapshot("g2", { unreadCount: 5 }) },
    });

    expect(selectUnreadTotal(useAppStore.getState())).toBe(7);
  });
});

describe("selectExpenseList", () => {
  it("maps ids to summaries in list order, skipping missing ones", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1") },
      expenses: { e1: summary("e1", "g1"), e3: summary("e3", "g1") },
      expenseLists: { g1: { ids: ["e1", "e2", "e3"], cursor: null, complete: false, total: null } },
    });

    expect(selectExpenseList(useAppStore.getState(), "g1").map((row) => row.id)).toEqual(["e1", "e3"]);
  });
});

describe("selectPendingInvitations", () => {
  it("returns groups where the viewer is invited, in groupOrder order", () => {
    useAppStore.setState({
      me,
      groups: {
        g1: snapshot("g1", {
          members: [member("user-2", "accepted"), member("user-1", "invited", "user-2")],
        }),
        g2: snapshot("g2", { members: [member("user-2", "accepted")] }),
        g3: snapshot("g3", {
          members: [member("user-1", "invited", "user-2"), member("user-2", "accepted")],
        }),
      },
      groupOrder: ["g1", "g2", "g3"],
    });

    expect(
      selectPendingInvitations(useAppStore.getState()).map((s) => s.group.id),
    ).toEqual(["g1", "g3"]);
  });

  it("excludes DMs even when the viewer is invited", () => {
    useAppStore.setState({
      me,
      groups: {
        dm1: snapshot("dm1", {
          members: [member("user-1", "invited", "user-2"), member("user-2", "accepted")],
          group: {
            id: "dm1",
            kind: "dm",
            name: "DM",
            creatorId: "user-2",
            dmUserA: "user-1",
            dmUserB: "user-2",
            ledgerVersion: 1,
            createdAt: "2026-01-01T00:00:00Z",
          },
        }),
      },
      groupOrder: ["dm1"],
    });

    expect(selectPendingInvitations(useAppStore.getState())).toEqual([]);
  });

  it("excludes groups where the viewer already accepted", () => {
    useAppStore.setState({
      me,
      groups: {
        g1: snapshot("g1", {
          members: [member("user-1", "accepted"), member("user-2", "accepted")],
        }),
      },
      groupOrder: ["g1"],
    });

    expect(selectPendingInvitations(useAppStore.getState())).toEqual([]);
  });

  it("returns an empty list when there is no viewer", () => {
    useAppStore.setState({
      me: null,
      groups: { g1: snapshot("g1", { members: [member("user-1", "invited", "user-2")] }) },
      groupOrder: ["g1"],
    });

    expect(selectPendingInvitations(useAppStore.getState())).toEqual([]);
  });

  it("returns the cached array while groups identity is unchanged and recomputes on change", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", { members: [member("user-1", "invited", "user-2")] }) },
      groupOrder: ["g1"],
    });

    const first = selectPendingInvitations(useAppStore.getState());
    expect(selectPendingInvitations(useAppStore.getState())).toBe(first);

    useAppStore.setState({
      groups: {
        g1: snapshot("g1", {
          members: [member("user-1", "accepted"), member("user-2", "accepted")],
        }),
      },
    });

    const second = selectPendingInvitations(useAppStore.getState());
    expect(second).not.toBe(first);
    expect(second).toEqual([]);
  });
});

describe("selectDmMembership", () => {
  const meId = "user-me";
  const dm = (status: string | null): GroupSnapshot => ({
    group: {
      id: "dm-1",
      kind: "dm",
      name: "DM",
      creatorId: "user-other",
      dmUserA: meId,
      dmUserB: "user-other",
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    members:
      status === null
        ? []
        : [
            {
              groupId: "dm-1",
              userId: meId,
              status: status as "invited" | "accepted",
              invitedBy: "user-other",
              acceptedAt: null,
              user: { id: meId, handle: "me", name: "Eu", avatarUrl: null, isBot: false },
            },
          ],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    lastEventId: 1,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    expenseCount: 0,
    pairwiseEdges: [],
  });

  it("does not call an unread group absent until a read finished", () => {
    expect(selectDmMembership(undefined, meId, { status: "idle" })).toEqual({
      status: "loading",
    });
    expect(selectDmMembership(undefined, meId, { status: "loading" })).toEqual({
      status: "loading",
    });
    expect(selectDmMembership(undefined, meId, { status: "ready" })).toEqual({
      status: "absent",
    });
    expect(
      selectDmMembership(undefined, meId, { status: "error", code: "network" }),
    ).toEqual({ status: "error", code: "network" });
  });

  it("reports the caller's own membership", () => {
    expect(selectDmMembership(dm("accepted"), meId, { status: "ready" })).toEqual({
      status: "accepted",
    });
    expect(selectDmMembership(dm("invited"), meId, { status: "ready" })).toEqual({
      status: "invited",
      invitedBy: "user-other",
    });
  });

  it("never treats missing or malformed membership as accepted", () => {
    expect(selectDmMembership(dm(null), meId, { status: "ready" })).toEqual({
      status: "absent",
    });
    expect(selectDmMembership(dm("bogus"), meId, { status: "ready" })).toEqual({
      status: "absent",
    });
    // Another member's row must not stand in for the caller's.
    expect(selectDmMembership(dm("accepted"), "someone-else", { status: "ready" })).toEqual({
      status: "absent",
    });
  });
});

function dmSnapshot(groupId: string): GroupSnapshot {
  return snapshot(groupId, {
    group: {
      id: groupId,
      kind: "dm",
      name: "",
      creatorId: "user-2",
      dmUserA: me.id,
      dmUserB: "user-2",
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [member(me.id, "accepted"), member("user-2", "accepted")],
  });
}

describe("selectMyExpenseRows", () => {
  it("maps history ids to rows in server order, naming a DM by the counterparty", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1"), dm1: dmSnapshot("dm1") },
      expenses: { e1: summary("e1", "g1"), e2: summary("e2", "dm1") },
      myExpenses: {
        ids: ["e1", "e2"],
        cursor: { createdAt: "2026-01-01T00:00:00Z", id: "e2" },
        complete: false,
        total: 2,
      },
    });

    const rows = selectMyExpenseRows(useAppStore.getState());

    expect(rows.map((row) => row.id)).toEqual(["e1", "e2"]);
    expect(rows[0]?.groupName).toBe("Group g1");
    expect(rows[1]?.groupName).toBe("User user-2");
    expect(rows[0]?.deleted).toBe(false);
  });

  it("keeps the previous array when an unrelated group is patched", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1"), g2: snapshot("g2") },
      expenses: { e1: summary("e1", "g1") },
      myExpenses: { ids: ["e1"], cursor: null, complete: true, total: 1 },
    });
    const before = selectMyExpenseRows(useAppStore.getState());

    // What applyGroup produces for a refresh of g2: a new record, a new g2
    // snapshot, and a reordered groupOrder. Nothing g1's rows render changed.
    useAppStore.setState({
      groups: {
        g2: { ...snapshot("g2"), lastActivityAt: "2026-02-02T00:00:00Z" },
        g1: useAppStore.getState().groups.g1,
      },
      groupOrder: ["g2", "g1"],
    });

    expect(selectMyExpenseRows(useAppStore.getState())).toBe(before);
  });

  it("recomputes a row when its own expense or group changes", () => {
    const original = snapshot("g1");
    useAppStore.setState({
      me,
      groups: { g1: original },
      expenses: { e1: summary("e1", "g1") },
      myExpenses: { ids: ["e1"], cursor: null, complete: true, total: 1 },
    });
    const before = selectMyExpenseRows(useAppStore.getState());

    useAppStore.setState({
      groups: { g1: { ...original, group: { ...original.group, name: "Renamed" } } },
    });
    const renamed = selectMyExpenseRows(useAppStore.getState());
    expect(renamed).not.toBe(before);
    expect(renamed[0]?.groupName).toBe("Renamed");

    useAppStore.setState({ expenses: { e1: { ...summary("e1", "g1"), title: "Novo título" } } });
    const retitled = selectMyExpenseRows(useAppStore.getState());
    expect(retitled).not.toBe(renamed);
    expect(retitled[0]?.title).toBe("Novo título");
  });
});

describe("selectConversationRows", () => {
  it("builds one row per conversable group in groupOrder order", () => {
    useAppStore.setState({
      me,
      groups: {
        g1: snapshot("g1", { members: [member(me.id, "accepted")] }),
        dm1: dmSnapshot("dm1"),
      },
      groupOrder: ["dm1", "g1"],
    });

    const rows = selectConversationRows(useAppStore.getState(), me.id);

    expect(rows.map((row) => row.groupId)).toEqual(["dm1", "g1"]);
    expect(rows[0]?.kind).toBe("dm");
    expect(rows[0]?.title).toBe("User user-2");
    expect(rows[1]?.kind).toBe("group");
    expect(rows[1]?.title).toBe("Group g1");
  });

  it("returns no rows without a viewer", () => {
    useAppStore.setState({
      me: null,
      groups: { g1: snapshot("g1") },
      groupOrder: ["g1"],
    });

    expect(selectConversationRows(useAppStore.getState(), null)).toEqual([]);
  });

  it("keeps the array when a store write touches no group snapshot", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", { members: [member(me.id, "accepted")] }) },
      groupOrder: ["g1"],
    });
    const before = selectConversationRows(useAppStore.getState(), me.id);
    expect(before).toHaveLength(1);

    useAppStore.setState({ reads: { charges: { status: "ready" } } });

    expect(selectConversationRows(useAppStore.getState(), me.id)).toBe(before);
  });

  it("keeps the array when groupOrder is rebuilt with identical snapshots", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", { members: [member(me.id, "accepted")] }) },
      groupOrder: ["g1"],
    });
    const before = selectConversationRows(useAppStore.getState(), me.id);

    const state = useAppStore.getState();
    useAppStore.setState({ groups: { ...state.groups }, groupOrder: ["g1"] });

    expect(selectConversationRows(useAppStore.getState(), me.id)).toBe(before);
  });

  it("rebuilds only the changed conversation's row", () => {
    const original = snapshot("g1", { members: [member(me.id, "accepted")] });
    const other = snapshot("g2", { members: [member(me.id, "accepted")] });
    useAppStore.setState({
      me,
      groups: { g1: original, g2: other },
      groupOrder: ["g1", "g2"],
    });
    const before = selectConversationRows(useAppStore.getState(), me.id);

    useAppStore.setState({
      groups: {
        g1: { ...original, unreadCount: 7 },
        g2: useAppStore.getState().groups.g2,
      },
    });
    const after = selectConversationRows(useAppStore.getState(), me.id);

    expect(after).not.toBe(before);
    expect(after[0]?.unreadCount).toBe(7);
    expect(after[1]).toBe(before[1]);
  });
});

describe("selectHomeRecentBills", () => {
  it("returns the first non-deleted bills with formatted dates and dm names", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1"), dm1: dmSnapshot("dm1") },
      expenses: {
        e1: summary("e1", "g1"),
        e2: summary("e2", "dm1"),
        e3: { ...summary("e3", "g1"), status: "deleted" as const },
      },
      myExpenses: { ids: ["e3", "e1", "e2"], cursor: null, complete: true, total: 3 },
    });

    const bills = selectHomeRecentBills(useAppStore.getState());

    expect(bills.map((bill) => bill.id)).toEqual(["e1", "e2"]);
    expect(bills[0]).toMatchObject({ title: "Expense e1", occurredOn: "01/01/2026", groupName: "Group g1" });
    expect(bills[1]?.groupName).toBe("User user-2");
  });

  it("keeps the array across store writes it does not read", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1") },
      expenses: { e1: summary("e1", "g1") },
      myExpenses: { ids: ["e1"], cursor: null, complete: true, total: 1 },
    });
    const before = selectHomeRecentBills(useAppStore.getState());

    useAppStore.setState({ activityViewedAt: { [me.id]: "2026-02-01T00:00:00Z" } });

    expect(selectHomeRecentBills(useAppStore.getState())).toBe(before);
  });

  it("recomputes when the history or its expenses change", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1") },
      expenses: { e1: summary("e1", "g1") },
      myExpenses: { ids: ["e1"], cursor: null, complete: true, total: 1 },
    });
    const before = selectHomeRecentBills(useAppStore.getState());

    useAppStore.setState({
      expenses: { e1: summary("e1", "g1"), e2: summary("e2", "g1") },
      myExpenses: { ids: ["e2", "e1"], cursor: null, complete: true, total: 2 },
    });
    const after = selectHomeRecentBills(useAppStore.getState());

    expect(after).not.toBe(before);
    expect(after.map((bill) => bill.id)).toEqual(["e2", "e1"]);
  });
});

describe("formatOccurredOn", () => {
  it("formats yyyy-mm-dd as dd/mm/yyyy", () => {
    expect(formatOccurredOn("2026-09-17")).toBe("17/09/2026");
  });

  it("returns the original string when it is not a calendar date", () => {
    expect(formatOccurredOn("invalid")).toBe("invalid");
  });
});

describe("groupNameOf", () => {
  it("returns an empty string without a snapshot", () => {
    expect(groupNameOf(undefined, me.id)).toBe("");
  });

  it("names a DM by the counterparty and a group by its own name", () => {
    expect(groupNameOf(dmSnapshot("dm1"), me.id)).toBe("User user-2");
    expect(groupNameOf(snapshot("g1"), me.id)).toBe("Group g1");
  });
});

describe("selectRecentBills", () => {
  it("returns up to the limit of active expenses, skipping deleted ones", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1") },
      expenses: {
        e1: summary("e1", "g1"),
        e2: { ...summary("e2", "g1"), status: "deleted" as const },
        e3: summary("e3", "g1"),
        e4: summary("e4", "g1"),
        e5: summary("e5", "g1"),
      },
      myExpenses: { ids: ["e1", "e2", "e3", "e4", "e5"], cursor: null, complete: true, total: 5 },
    });

    const recent = selectRecentBills(useAppStore.getState(), 3);

    expect(recent.map((bill) => bill.title)).toEqual([
      "Expense e1",
      "Expense e3",
      "Expense e4",
    ]);
    expect(recent[0]?.occurredOn).toBe("01/01/2026");
    expect(recent[0]?.groupName).toBe("Group g1");
  });

  it("returns nothing without a viewer", () => {
    useAppStore.setState({
      me: null,
      groups: { g1: snapshot("g1") },
      expenses: { e1: summary("e1", "g1") },
      myExpenses: { ids: ["e1"], cursor: null, complete: true, total: 1 },
    });

    expect(selectRecentBills(useAppStore.getState(), 3)).toEqual([]);
  });
});
