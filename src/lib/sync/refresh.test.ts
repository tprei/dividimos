import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupSnapshot, Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import { rpc } from "./client";
import { refreshGroup } from "./refresh";

vi.mock("./client", () => ({ rpc: vi.fn() }));

const ME: Me = {
  id: "user-me",
  handle: "me_user",
  name: "Eu Mesmo",
  avatarUrl: null,
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
    pendingSettlements: [],
    recentExpenses: [],
    lastEventId: ledgerVersion,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-01T00:00:00.000Z",
  };
}

type SnapshotResolver = (value: GroupSnapshot | PromiseLike<GroupSnapshot>) => void;

const resolvers: SnapshotResolver[] = [];

/** Drains microtasks until the mock has recorded `count` rpc calls; the follow-up's own RPC is the awaited signal. */
async function untilRpcCalls(count: number): Promise<void> {
  while (resolvers.length < count) {
    await Promise.resolve();
  }
}

describe("refreshGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvers.length = 0;
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
    await untilRpcCalls(2);

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
    await untilRpcCalls(2);
    expect(rpc).toHaveBeenCalledTimes(2);

    resolvers[1]?.(snapshot("g1", 8));
    await Promise.all([first, second, third]);

    expect(useAppStore.getState().groups.g1?.group.ledgerVersion).toBe(8);
  });
});
