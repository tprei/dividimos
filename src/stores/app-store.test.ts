import { beforeEach, describe, expect, it } from "vitest";
import type {
  Bootstrap,
  ChatMessage,
  ExpenseDetail,
  ExpenseSummary,
  GroupEvent,
  GroupSnapshot,
  Me,
  VendorCharge,
} from "@/types/ledger";
import { migrateAppState, useAppStore } from "./app-store";

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

function summary(
  id: string,
  groupId: string,
  createdAt: string,
  overrides: Partial<ExpenseSummary> = {},
): ExpenseSummary {
  return {
    id,
    groupId,
    creatorId: me.id,
    status: "active",
    occurredOn: "2026-01-01",
    createdAt,
    versionNo: 1,
    title: `Expense ${id}`,
    merchantName: null,
    expenseType: "single_amount",
    totalCents: 1000,
    myShareCents: 1000,
    myPaidCents: 0,
    participantCount: 1,
    ...overrides,
  };
}

function recentExpenses(count: number, groupId: string): ExpenseSummary[] {
  return Array.from({ length: count }, (_, i) =>
    summary(`e${i + 1}`, groupId, `2026-01-01T00:00:${String(60 - i).padStart(2, "0")}Z`),
  );
}

function snapshot(
  groupId: string,
  recent: ExpenseSummary[],
  overrides: Partial<GroupSnapshot> = {},
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
    recentExpenses: recent,
    expenseCount: 0,
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
    pairwiseEdges: [],
  };
  return { ...base, ...overrides, group: { ...base.group, ...overrides.group } };
}

function message(id: string, clientId: string, createdAt: string): ChatMessage {
  return { id, clientId, groupId: "g1", senderId: me.id, content: `msg ${id}`, createdAt, sender: me };
}

function event(id: number, createdAt: string): GroupEvent {
  return {
    id,
    groupId: "g1",
    actorId: null,
    kind: "expense_created",
    expenseId: null,
    settlementId: null,
    subjectUserId: null,
    payload: {},
    createdAt,
    actor: null,
    expenseTitle: null,
  };
}

function detail(expenseId: string, groupId = "g1"): ExpenseDetail {
  const version = {
    expenseId,
    versionNo: 1,
    authorId: me.id,
    createdAt: "2026-01-01T00:00:00Z",
    occurredOn: "2026-01-01",
    title: "T",
    merchantName: null,
    expenseType: "single_amount" as const,
    totalCents: 1000,
    serviceFeeBasisPoints: 0,
    fixedFeeCents: 0,
    payload: { items: [], participants: [], shares: [], payers: [], itemAssignments: null },
    changeSummary: null,
  };
  return {
    expense: {
      id: expenseId,
      groupId,
      creatorId: me.id,
      status: "active",
      currentVersionNo: 1,
      occurredOn: "2026-01-01",
      createdAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
      deletedBy: null,
    },
    current: version,
    versions: [version],
    participants: [
      { participantIndex: 0, kind: "user", shareCents: 1000, paidCents: 0, user: me, guest: null },
    ],
    group: { id: groupId, name: "G", kind: "group" },
  };
}

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("applyBootstrap", () => {
  it("keeps unrelated expenseDetails and drops groups absent from the payload", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", []), g2: snapshot("g2", []) },
      groupOrder: ["g1", "g2"],
      expenseLists: {
        g1: { ids: ["e1"], oldestCursor: "2026-01-02T00:00:00Z", complete: true },
        g2: { ids: [], oldestCursor: null, complete: true },
      },
      conversations: {
        g1: { messages: [message("m1", "m1", "2026-01-02T00:00:00Z")], events: [], oldestCursor: "2026-01-02T00:00:00Z" },
        g2: { messages: [], events: [], oldestCursor: null },
      },
      expenseDetails: { e1: detail("e1", "g1"), e2: detail("e2", "g2") },
    });

    const payload: Bootstrap = {
      me,
      serverTime: "2026-01-03T00:00:00Z",
      groups: [snapshot("g2", [summary("e3", "g2", "2026-01-03T00:00:00Z")])],
    };
    useAppStore.getState().applyBootstrap(payload);

    const state = useAppStore.getState();
    expect(Object.keys(state.groups)).toEqual(["g2"]);
    expect(state.groupOrder).toEqual(["g2"]);
    expect(state.expenseLists.g1).toBeUndefined();
    expect(state.conversations.g1).toBeUndefined();
    expect(Object.keys(state.expenseDetails).sort()).toEqual(["e1", "e2"]);
    expect(state.me).toEqual(me);
    expect(state.lastBootstrapAt).not.toBeNull();
  });

  it("seeds complete=false when the snapshot has 20 recent expenses", () => {
    useAppStore.getState().applyBootstrap({
      me,
      serverTime: "2026-01-03T00:00:00Z",
      groups: [snapshot("g1", recentExpenses(20, "g1"))],
    });
    expect(useAppStore.getState().expenseLists.g1?.complete).toBe(false);
  });

  it("seeds complete=true when the snapshot has fewer than 20 recent expenses", () => {
    useAppStore.getState().applyBootstrap({
      me,
      serverTime: "2026-01-03T00:00:00Z",
      groups: [snapshot("g1", recentExpenses(3, "g1"))],
    });
    expect(useAppStore.getState().expenseLists.g1?.complete).toBe(true);
  });

  it("merges a re-seeded list: new head first, previous tail preserved, ids deduped", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", [summary("e2", "g1", "2026-01-01T00:00:02Z"), summary("e3", "g1", "2026-01-01T00:00:01Z")]) },
      expenseLists: { g1: { ids: ["e2", "e3", "e4"], oldestCursor: "2026-01-01T00:00:00Z", complete: true } },
    });

    useAppStore.getState().applyGroup(
      snapshot("g1", [summary("e1", "g1", "2026-01-01T00:00:03Z"), summary("e2", "g1", "2026-01-01T00:00:02Z")]),
    );

    expect(useAppStore.getState().expenseLists.g1?.ids).toEqual(["e1", "e2", "e3", "e4"]);
  });
});

describe("applyExpensePage", () => {
  it("appends deduped ids, moves the cursor to the page tail and honors complete", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", []) },
      expenseLists: { g1: { ids: ["e1"], oldestCursor: "2026-01-01T00:00:00Z", complete: false } },
    });

    useAppStore.getState().applyExpensePage("g1", [
      summary("e2", "g1", "2026-01-01T00:00:01Z"),
      summary("e3", "g1", "2026-01-01T00:00:02Z"),
    ], false);
    let list = useAppStore.getState().expenseLists.g1;
    expect(list?.ids).toEqual(["e1", "e2", "e3"]);
    expect(list?.oldestCursor).toBe("2026-01-01T00:00:02Z");
    expect(list?.complete).toBe(false);

    useAppStore.getState().applyExpensePage("g1", [summary("e3", "g1", "2026-01-01T00:00:02Z")], true);
    list = useAppStore.getState().expenseLists.g1;
    expect(list?.ids).toEqual(["e1", "e2", "e3"]);
    expect(list?.complete).toBe(true);
  });

  it("keeps the cursor unchanged when the page is empty", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", []) },
      expenseLists: { g1: { ids: ["e1"], oldestCursor: "2026-01-01T00:00:00Z", complete: false } },
    });

    useAppStore.getState().applyExpensePage("g1", [], true);

    const list = useAppStore.getState().expenseLists.g1;
    expect(list?.oldestCursor).toBe("2026-01-01T00:00:00Z");
    expect(list?.complete).toBe(true);
  });
});

describe("replaceExpenseId", () => {
  it("renames in expenses, expense list ids and expense details", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", []) },
      expenses: { old: summary("old", "g1", "2026-01-01T00:00:00Z") },
      expenseLists: { g1: { ids: ["old", "e9"], oldestCursor: null, complete: true } },
      expenseDetails: { old: detail("old") },
    });

    useAppStore.getState().replaceExpenseId("old", "new");

    const state = useAppStore.getState();
    expect(state.expenses.old).toBeUndefined();
    expect(state.expenses.new?.id).toBe("new");
    expect(state.expenseLists.g1?.ids).toEqual(["new", "e9"]);
    expect(state.expenseDetails.old).toBeUndefined();
    expect(state.expenseDetails.new?.expense.id).toBe("new");
    expect(state.expenseDetails.new?.current.expenseId).toBe("new");
    expect(state.expenseDetails.new?.versions[0]?.expenseId).toBe("new");
  });
});

describe("applyConversation", () => {
  it("dedupes by clientId, replaces the optimistic message on ack and keeps oldestCursor on append", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", []) },
      conversations: {},
    });

    useAppStore.getState().applyConversation(
      "g1",
      { messages: [message("optimistic", "client-1", "2026-01-02T10:00:00Z")], events: [] },
      false,
    );
    let conversation = useAppStore.getState().conversations.g1;
    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.oldestCursor).toBe("2026-01-02T10:00:00Z");

    useAppStore.getState().applyConversation(
      "g1",
      { messages: [message("srv-1", "client-1", "2026-01-02T10:00:00Z")], events: [] },
      false,
    );
    conversation = useAppStore.getState().conversations.g1;
    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.messages[0]?.id).toBe("srv-1");
    expect(conversation?.oldestCursor).toBe("2026-01-02T10:00:00Z");
  });

  it("dedupes events by id", () => {
    useAppStore.setState({
      me,
      groups: { g1: snapshot("g1", []) },
      conversations: {
        g1: { messages: [message("m1", "m1", "2026-01-02T10:00:00Z")], events: [], oldestCursor: "2026-01-02T10:00:00Z" },
      },
    });

    useAppStore.getState().applyConversation("g1", { messages: [], events: [event(1, "2026-01-02T10:00:01Z"), event(1, "2026-01-02T10:00:01Z")] }, false);

    expect(useAppStore.getState().conversations.g1?.events).toHaveLength(1);
  });
});

describe("applyGroup", () => {
  it("drops snapshots strictly older than the stored ledgerVersion", () => {
    const v6 = snapshot("g1", []);
    v6.group.ledgerVersion = 6;
    useAppStore.getState().applyGroup(v6);

    const v5 = snapshot("g1", recentExpenses(1, "g1"), { lastEventId: 99 });
    v5.group.ledgerVersion = 5;
    useAppStore.getState().applyGroup(v5);

    expect(useAppStore.getState().groups.g1).toBe(v6);
    expect(useAppStore.getState().groups.g1?.group.ledgerVersion).toBe(6);
  });

  it("applies snapshots at the same ledgerVersion", () => {
    const v6 = snapshot("g1", []);
    v6.group.ledgerVersion = 6;
    useAppStore.getState().applyGroup(v6);

    const v6b = snapshot("g1", recentExpenses(1, "g1"), { lastEventId: 42 });
    v6b.group.ledgerVersion = 6;
    useAppStore.getState().applyGroup(v6b);

    expect(useAppStore.getState().groups.g1).toBe(v6b);
    expect(useAppStore.getState().groups.g1?.recentExpenses).toHaveLength(1);
  });
});

describe("reset", () => {
  it("restores the initial state, keeps hydrated and clears persisted storage", () => {
    useAppStore.getState().applyBootstrap({
      me,
      serverTime: "2026-01-03T00:00:00Z",
      groups: [snapshot("g1", recentExpenses(2, "g1"))],
    });
    expect(useAppStore.getState().me).not.toBeNull();

    useAppStore.getState().reset();

    const state = useAppStore.getState();
    expect(state.me).toBeNull();
    expect(state.groups).toEqual({});
    expect(state.groupOrder).toEqual([]);
    expect(state.expenseLists).toEqual({});
    expect(state.expenses).toEqual({});
    expect(state.expenseDetails).toEqual({});
    expect(state.conversations).toEqual({});
    expect(state.vendorCharges).toEqual([]);
    expect(state.activity).toEqual({ items: [], oldestId: null });
    expect(state.lastBootstrapAt).toBeNull();
    expect(state.hydrated).toBe(true);
  });
});

describe("vendor charges", () => {
  const charge1: VendorCharge = {
    id: "vc-1",
    userId: "user-1",
    amountCents: 1500,
    description: "Taxa de entrega",
    status: "pending",
    createdAt: "2026-01-01T10:00:00Z",
    confirmedAt: null,
  };

  const charge2: VendorCharge = {
    id: "vc-2",
    userId: "user-1",
    amountCents: 3200,
    description: "Lanche",
    status: "received",
    createdAt: "2026-01-01T11:00:00Z",
    confirmedAt: "2026-01-01T11:05:00Z",
  };

  it("applies a list of vendor charges", () => {
    useAppStore.getState().applyVendorCharges([charge1, charge2]);
    expect(useAppStore.getState().vendorCharges).toEqual([charge1, charge2]);

    useAppStore.getState().applyVendorCharges([charge1]);
    expect(useAppStore.getState().vendorCharges).toEqual([charge1]);
  });

  it("upserts a new vendor charge at the beginning", () => {
    useAppStore.getState().applyVendorCharges([charge1]);
    useAppStore.getState().upsertVendorCharge(charge2);
    expect(useAppStore.getState().vendorCharges).toEqual([charge2, charge1]);
  });

  it("updates an existing vendor charge in place", () => {
    useAppStore.getState().applyVendorCharges([charge1, charge2]);
    const updatedCharge1: VendorCharge = {
      ...charge1,
      status: "received",
      confirmedAt: "2026-01-01T10:15:00Z",
    };
    useAppStore.getState().upsertVendorCharge(updatedCharge1);
    expect(useAppStore.getState().vendorCharges).toEqual([updatedCharge1, charge2]);
  });
});

describe("migrateAppState", () => {
  it("backfills expenseCount and pairwiseEdges on snapshots persisted before the fields existed", () => {
    const legacyGroup: Record<string, unknown> = { ...snapshot("g1", []) };
    delete legacyGroup.expenseCount;
    delete legacyGroup.pairwiseEdges;

    const migrated = migrateAppState({
      groups: { g1: legacyGroup },
      groupOrder: ["g1"],
    });

    expect(migrated.groups.g1?.expenseCount).toBe(0);
    expect(migrated.groups.g1?.pairwiseEdges).toEqual([]);
    expect(migrated.groups.g1?.group.id).toBe("g1");
    expect(migrated.groupOrder).toEqual(["g1"]);
  });

  it("keeps the persisted authoritative count when present", () => {
    const migrated = migrateAppState({
      groups: { g1: snapshot("g1", [], { expenseCount: 4 }) },
      groupOrder: ["g1"],
    });

    expect(migrated.groups.g1?.expenseCount).toBe(4);
  });

  it("fills missing persisted fields with initial data", () => {
    const migrated = migrateAppState({});

    expect(migrated.groups).toEqual({});
    expect(migrated.me).toBeNull();
    expect(migrated.vendorCharges).toEqual([]);
  });
});
