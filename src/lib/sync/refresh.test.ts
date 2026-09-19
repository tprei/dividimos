import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseDetail, GroupSnapshot, Me } from "@/types/ledger";
import {
  expensePageReadKey,
  expenseReadKey,
  groupReadKey,
  useAppStore,
} from "@/stores/app-store";
import { rpc } from "./client";
import {
  invalidateSyncReads,
  loadActivity,
  loadMoreExpenses,
  refreshExpense,
  refreshGroup,
} from "./refresh";
import { LedgerError } from "./errors";

const clientState = vi.hoisted(() => ({ authGeneration: 0 }));
vi.mock("./client", () => ({
  rpc: vi.fn(),
  getAuthGeneration: () => clientState.authGeneration,
}));

const ME: Me = {
  id: "user-me",
  handle: "me_user",
  name: "Eu Mesmo",
  avatarUrl: null,
  isBot: false,
  email: "me@example.com",
  pixKeyType: "email",
  pixKeyHint: "me@example.com",
  onboarded: true,
  notificationPreferences: { expenses: true, settlements: true, nudges: true },
};

function snapshot(groupId: string, ledgerVersion: number): GroupSnapshot {
  return {
    group: {
      id: groupId,
      kind: "group",
      name: "Viagem",
      creatorId: ME.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    members: [],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: ledgerVersion,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    pairwiseEdges: [],
  };
}

function expenseDetail(): ExpenseDetail {
  const current = {
    expenseId: "e1",
    versionNo: 1,
    authorId: ME.id,
    occurredOn: "2026-01-01",
    title: "Almoço",
    merchantName: null,
    expenseType: "single_amount" as const,
    totalCents: 100,
    serviceFeeBasisPoints: 0,
    fixedFeeCents: 0,
    payload: {
      items: [],
      participants: [{ kind: "user" as const, userId: ME.id }],
      shares: [100],
      payers: [{ participantIndex: 0, amountCents: 100 }],
      itemAssignments: null,
      splitMethod: "fixed" as const,
    },
    changeSummary: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
  return {
    expense: {
      id: "e1",
      groupId: "g1",
      creatorId: ME.id,
      status: "active",
      currentVersionNo: 1,
      occurredOn: "2026-01-01",
      createdAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
      deletedBy: null,
    },
    current,
    versions: [current],
    participants: [],
    group: { id: "g1", name: "Grupo", kind: "group" },
  };
}

type SnapshotResolver = (value: GroupSnapshot | PromiseLike<GroupSnapshot>) => void;

const resolvers: SnapshotResolver[] = [];

describe("refreshGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientState.authGeneration = 0;
    resolvers.length = 0;
    invalidateSyncReads();
    useAppStore.getState().reset();
    vi.mocked(rpc).mockImplementation(async () => {
      const { promise, resolve } = Promise.withResolvers<GroupSnapshot>();
      resolvers.push(resolve);
      return await promise;
    });
  });

  it("schedules one trailing-edge follow-up and returns its promise to later callers", async () => {
    useAppStore.getState().applyGroup(snapshot("g1", 6));

    const first = refreshGroup("g1");
    expect(rpc).toHaveBeenCalledTimes(1);

    const second = refreshGroup("g1");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);

    resolvers[0]?.(snapshot("g1", 5));
    await first;
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().groups.g1?.group.ledgerVersion).toBe(6);

    resolvers[1]?.(snapshot("g1", 7));
    await second;

    expect(useAppStore.getState().groups.g1?.group.ledgerVersion).toBe(7);
  });

  it("shares a single follow-up among callers arriving during the same flight", async () => {
    useAppStore.getState().applyGroup(snapshot("g1", 6));

    const first = refreshGroup("g1");
    const second = refreshGroup("g1");
    const third = refreshGroup("g1");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(second).toBe(third);

    resolvers[0]?.(snapshot("g1", 7));
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    expect(rpc).toHaveBeenCalledTimes(2);

    resolvers[1]?.(snapshot("g1", 8));
    await Promise.all([first, second, third]);

    expect(useAppStore.getState().groups.g1?.group.ledgerVersion).toBe(8);
  });
});


describe("refreshExpense", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientState.authGeneration = 0;
    invalidateSyncReads();
    useAppStore.getState().reset();
  });

  it("installs detail and room metadata from one contextual RPC", async () => {
    vi.mocked(rpc).mockResolvedValueOnce({
      detail: expenseDetail(),
      assignmentRoom: { id: "room-1", hostUserId: ME.id },
    } as never);

    await refreshExpense("e1");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "get_expense_context",
      { p_expense_id: "e1" },
      expect.any(Function),
    );
    expect(useAppStore.getState().expenseDetails.e1).toBeDefined();
    expect(useAppStore.getState().assignmentRoomsByExpenseId.e1).toEqual({
      id: "room-1",
      hostUserId: ME.id,
    });
    expect(useAppStore.getState().reads[expenseReadKey("e1")]).toEqual({
      status: "ready",
    });
  });
});
describe("loadActivity", () => {
  beforeEach(() => {
    clientState.authGeneration = 0;
    useAppStore.getState().reset();
  });

  it("publishes rows and marks completeness only from a successful short page", async () => {
    vi.mocked(rpc).mockResolvedValueOnce([] as never);

    await loadActivity();

    const activity = useAppStore.getState().activity;
    expect(activity.read).toEqual({ status: "ready" });
    expect(activity.complete).toBe(true);
  });

  it("records the failure code and keeps existing rows", async () => {
    vi.mocked(rpc).mockResolvedValueOnce([
      {
        id: 7,
        groupId: "g1",
        actorId: null,
        kind: "nudge",
        expenseId: null,
        settlementId: null,
        subjectUserId: null,
        payload: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        actor: null,
        expenseTitle: null,
      },
    ] as never);
    await loadActivity();

    vi.mocked(rpc).mockRejectedValueOnce(new LedgerError("network"));
    await expect(loadActivity()).rejects.toThrow();

    const activity = useAppStore.getState().activity;
    expect(activity.read).toEqual({ status: "error", code: "network" });
    expect(activity.items).toHaveLength(1);
  });

  it("ignores a result from the previous auth generation", async () => {
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    vi.mocked(rpc)
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);

    const oldRead = loadActivity();
    clientState.authGeneration = 1;
    const currentRead = loadActivity();

    first.reject(new LedgerError("network"));
    await expect(oldRead).resolves.toBeUndefined();
    expect(useAppStore.getState().activity.read).toEqual({ status: "loading" });

    second.resolve([]);
    await currentRead;
    expect(useAppStore.getState().activity.read).toEqual({ status: "ready" });
  });
});

describe("resource read state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientState.authGeneration = 0;
    resolvers.length = 0;
    invalidateSyncReads();
    useAppStore.getState().reset();
    vi.mocked(rpc).mockImplementation(async () => {
      const { promise, resolve } = Promise.withResolvers<GroupSnapshot>();
      resolvers.push(resolve);
      return await promise;
    });
  });

  it("lets a newer read own the state when an older one settles late", async () => {
    useAppStore.getState().applyGroup(snapshot("g1", 1));

    const first = refreshGroup("g1");
    // The follow-up is the newer attempt for this resource.
    const second = refreshGroup("g1");

    resolvers[0]?.(snapshot("g1", 2));
    await first;
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));

    // While the newer read is in flight the resource is loading, even though
    // the older one just finished successfully.
    expect(useAppStore.getState().reads[groupReadKey("g1")]).toEqual({ status: "loading" });

    resolvers[1]?.(snapshot("g1", 3));
    await second;
    expect(useAppStore.getState().reads[groupReadKey("g1")]).toEqual({ status: "ready" });
  });

  it("keeps the cursor and rows when an older expense page fails", async () => {
    useAppStore.setState({
      expenseLists: {
        g1: { ids: ["e1"], cursor: { createdAt: "2026-01-02T00:00:00Z", id: "e1" }, complete: false, total: null },
      },
    });

    vi.mocked(rpc).mockRejectedValueOnce(new LedgerError("network"));
    await expect(loadMoreExpenses("g1")).rejects.toThrow();

    const list = useAppStore.getState().expenseLists.g1;
    expect(list?.ids).toEqual(["e1"]);
    expect(list?.cursor).toEqual({ createdAt: "2026-01-02T00:00:00Z", id: "e1" });
    expect(list?.complete).toBe(false);
    expect(useAppStore.getState().reads[expensePageReadKey("g1")]).toEqual({
      status: "error",
      code: "network",
    });
  });
});
