import { beforeEach, describe, expect, it } from "vitest";
import type { AssignmentRoomSummary, OpenAssignmentRoom } from "@/types/assignment-room";
import type { GroupSnapshot, Me } from "@/types/ledger";
import { useAppStore } from "./app-store";
import { selectAssignmentRoomAccess, selectAssignmentRoomSummary } from "./assignment-room-selectors";

const me: Me = {
  id: "user-me",
  handle: "eu",
  name: "Eu",
  avatarUrl: null,
  isBot: false,
  email: "eu@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

function group(id: string): GroupSnapshot {
  return {
    group: {
      id,
      kind: "group",
      name: "Viagem",
      creatorId: me.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    members: [],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 1,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-09-01T00:00:00.000Z",
    pairwiseEdges: [],
  };
}

function summary(overrides: Partial<AssignmentRoomSummary> = {}): AssignmentRoomSummary {
  return {
    id: "room-1",
    groupId: "g1",
    status: "open",
    revision: 2,
    title: "Bar do Zé",
    occurredOn: "2026-09-25",
    totalCents: 18260,
    host: { id: "user-host", handle: "bruno", name: "Bruno", avatarUrl: null, isBot: false },
    createdAt: "2026-09-25T20:00:00.000Z",
    itemCount: 3,
    ownedItemCount: 0,
    claimers: [],
    expenseId: null,
    ...overrides,
  };
}

function listed(overrides: Partial<OpenAssignmentRoom> = {}): OpenAssignmentRoom {
  return { ...summary(), joined: false, ...overrides };
}

const anaClaim = { participantId: "p-ana", userId: "user-ana", name: "Ana", avatarUrl: null };
const myClaim = { participantId: "p-me", userId: me.id, name: "Eu", avatarUrl: null };

beforeEach(() => {
  useAppStore.getState().reset();
  useAppStore.setState({ me, groups: { g1: group("g1") } });
});

describe("applyAssignmentRoomSummaries", () => {
  it("ignores a summary that is not newer than the cached one", () => {
    const store = useAppStore.getState();
    store.applyAssignmentRoomSummaries([summary({ revision: 5, ownedItemCount: 2 })]);
    store.applyAssignmentRoomSummaries([summary({ revision: 4, ownedItemCount: 1 })]);
    store.applyAssignmentRoomSummaries([summary({ revision: 5, ownedItemCount: 0 })]);

    expect(useAppStore.getState().assignmentRoomSummaries["room-1"]?.ownedItemCount).toBe(2);
  });

  it("patches a listed open room and keeps joined", () => {
    useAppStore.setState({ openAssignmentRoomsByGroupId: { g1: [listed({ joined: true })] } });

    useAppStore.getState().applyAssignmentRoomSummaries([
      summary({ revision: 3, ownedItemCount: 1, claimers: [anaClaim] }),
    ]);

    expect(useAppStore.getState().openAssignmentRoomsByGroupId.g1).toEqual([
      listed({ revision: 3, ownedItemCount: 1, claimers: [anaClaim], joined: true }),
    ]);
  });

  it("marks the room joined when the viewer shows up among the claimers", () => {
    useAppStore.setState({ openAssignmentRoomsByGroupId: { g1: [listed()] } });

    useAppStore.getState().applyAssignmentRoomSummaries([
      summary({ revision: 3, claimers: [myClaim] }),
    ]);

    expect(useAppStore.getState().openAssignmentRoomsByGroupId.g1?.[0]?.joined).toBe(true);
  });

  it("never adds a room the viewer's list read left out", () => {
    useAppStore.getState().applyOpenAssignmentRooms("g1", []);

    useAppStore.getState().applyAssignmentRoomSummaries([
      summary({ revision: 4, claimers: [anaClaim] }),
    ]);

    expect(useAppStore.getState().openAssignmentRoomsByGroupId.g1).toEqual([]);
  });

  it("creates no list for a group whose rooms were never read", () => {
    useAppStore.getState().applyAssignmentRoomSummaries([summary()]);

    expect(useAppStore.getState().openAssignmentRoomsByGroupId.g1).toBeUndefined();
  });

  it("drops a room from the open list once it leaves the open status", () => {
    useAppStore.setState({ openAssignmentRoomsByGroupId: { g1: [listed()] } });

    useAppStore.getState().applyAssignmentRoomSummaries([
      summary({ revision: 9, status: "finalized", expenseId: "expense-1" }),
    ]);

    expect(useAppStore.getState().openAssignmentRoomsByGroupId.g1).toEqual([]);
    expect(useAppStore.getState().assignmentRoomSummaries["room-1"]?.status).toBe("finalized");
  });

  it("keeps the summary but touches no list for an uncached group", () => {
    useAppStore.getState().applyAssignmentRoomSummaries([summary({ groupId: "g-other" })]);

    expect(useAppStore.getState().assignmentRoomSummaries["room-1"]?.groupId).toBe("g-other");
    expect(useAppStore.getState().openAssignmentRoomsByGroupId["g-other"]).toBeUndefined();
  });
});

describe("applyOpenAssignmentRooms with live summaries", () => {
  it("does not regress a newer live summary with an older list read", () => {
    const store = useAppStore.getState();
    store.applyAssignmentRoomSummaries([summary({ revision: 7, claimers: [anaClaim] })]);
    store.applyOpenAssignmentRooms("g1", [listed({ revision: 6, joined: true })]);

    expect(useAppStore.getState().openAssignmentRoomsByGroupId.g1).toEqual([
      listed({ revision: 7, claimers: [anaClaim], joined: true }),
    ]);
  });

  it("drops a listed room the live summary already closed", () => {
    const store = useAppStore.getState();
    store.applyAssignmentRoomSummaries([summary({ revision: 7, status: "cancelled" })]);
    store.applyOpenAssignmentRooms("g1", [listed({ revision: 6 })]);

    expect(useAppStore.getState().openAssignmentRoomsByGroupId.g1).toEqual([]);
  });
});

describe("assignment room selectors", () => {
  it("prefers the newer of the cached and embedded summaries", () => {
    useAppStore.getState().applyAssignmentRoomSummaries([summary({ revision: 4 })]);
    const state = useAppStore.getState();

    expect(selectAssignmentRoomSummary(state, "room-1", summary({ revision: 3 }))?.revision).toBe(4);
    expect(selectAssignmentRoomSummary(state, "room-1", summary({ revision: 6 }))?.revision).toBe(6);
    expect(selectAssignmentRoomSummary(state, "room-9", null)).toBeNull();
  });

  it("resolves access from live state, the list, own claims, then the read", () => {
    useAppStore.setState({ openAssignmentRoomsByGroupId: { g1: [listed({ joined: true })] } });
    let state = useAppStore.getState();

    expect(selectAssignmentRoomAccess(state, summary(), me.id, undefined)).toBe("joined");
    expect(selectAssignmentRoomAccess(state, summary({ id: "room-2" }), me.id, undefined)).toBe("none");
    expect(
      selectAssignmentRoomAccess(state, summary({ id: "room-2", claimers: [myClaim] }), me.id, undefined),
    ).toBe("joined");
    expect(selectAssignmentRoomAccess(state, summary({ id: "room-2" }), me.id, "removed")).toBe("removed");

    useAppStore.getState().setAssignmentRoomAccess([{ roomId: "room-1", access: "removed" }]);
    state = useAppStore.getState();
    expect(selectAssignmentRoomAccess(state, summary(), me.id, "joined")).toBe("removed");
  });

  it("keeps a joined viewer joined after the room leaves the open list", () => {
    const store = useAppStore.getState();
    store.applyOpenAssignmentRooms("g1", [listed()]);
    store.markOpenAssignmentRoomJoined("g1", "room-1");
    store.applyAssignmentRoomSummaries([summary({ revision: 8, status: "closed" })]);

    const state = useAppStore.getState();
    expect(state.openAssignmentRoomsByGroupId.g1).toEqual([]);
    expect(selectAssignmentRoomAccess(state, summary({ status: "closed" }), me.id, undefined)).toBe("joined");
  });
});

describe("removeGroup", () => {
  it("forgets the group's room summaries and access", () => {
    const store = useAppStore.getState();
    store.applyAssignmentRoomSummaries([summary(), summary({ id: "room-x", groupId: "g2" })]);
    store.setAssignmentRoomAccess([
      { roomId: "room-1", access: "joined" },
      { roomId: "room-x", access: "joined" },
    ]);

    useAppStore.getState().removeGroup("g1");

    const state = useAppStore.getState();
    expect(Object.keys(state.assignmentRoomSummaries)).toEqual(["room-x"]);
    expect(state.assignmentRoomAccess).toEqual({ "room-x": "joined" });
  });
});
