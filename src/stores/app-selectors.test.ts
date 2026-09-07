import { beforeEach, describe, expect, it } from "vitest";
import type { BalanceRow, ExpenseSummary, GroupSnapshot, Me } from "@/types/ledger";
import { useAppStore } from "./app-store";
import {
  selectExpenseList,
  selectMyDebts,
  selectPendingSettlementsForMe,
  selectTransfers,
  selectUnreadTotal,
} from "./app-selectors";

const me: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice",
  avatarUrl: null,
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
    pendingSettlements: [],
    recentExpenses: [],
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
  };
  return { ...base, ...overrides, group: { ...base.group, ...overrides.group } };
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
      expenseLists: { g1: { ids: ["e1", "e2", "e3"], oldestCursor: null, complete: false } },
    });

    expect(selectExpenseList(useAppStore.getState(), "g1").map((row) => row.id)).toEqual(["e1", "e3"]);
  });
});

describe("selectPendingSettlementsForMe", () => {
  it("collects pending settlements where I am the creditor, in groupOrder order", () => {
    const settlement = {
      id: "s1",
      operationId: "op-1",
      groupId: "g1",
      fromUserId: "user-2",
      toUserId: "user-1",
      amountCents: 500,
      status: "pending" as const,
      createdBy: "user-2",
      createdAt: "2026-01-02T00:00:00Z",
      confirmedAt: null,
      voidedAt: null,
      voidedBy: null,
    };
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", { pendingSettlements: [settlement] }) },
      groupOrder: ["g1"],
    });

    expect(selectPendingSettlementsForMe(useAppStore.getState())).toEqual([
      { groupId: "g1", settlement },
    ]);
  });
});
