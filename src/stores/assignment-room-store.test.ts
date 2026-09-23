import { beforeEach, describe, expect, it } from "vitest";
import type { AssignmentRoomView } from "@/types/assignment-room";
import { useAssignmentRoomStore } from "./assignment-room-store";

const ROOM_ID = "00000000-0000-4000-8000-000000000001";

function view(revision: number): AssignmentRoomView {
  return {
    role: "participant",
    room: {
      id: ROOM_ID,
      revision,
      status: "open",
      title: "Almoço",
      occurredOn: "2026-09-19",
      serviceFeeBasisPoints: 0,
      fixedFeeCents: 0,
      totalCents: 100,
      selfParticipantId: "participant-1",
      items: [],
      participants: [],
      claims: [],
      topic: `assignment:${ROOM_ID}:${"A".repeat(43)}`,
      currentBill: null,
    },
  };
}

describe("assignment room store", () => {
  beforeEach(() => {
    useAssignmentRoomStore.getState().reset();
  });

  it("installs only monotone revisions and strips the transport topic", () => {
    const store = useAssignmentRoomStore.getState();
    expect(store.install(view(4))).toBe(true);
    expect(store.install(view(3))).toBe(false);

    const entry = useAssignmentRoomStore.getState().rooms[ROOM_ID];
    expect(entry.view?.room.revision).toBe(4);
    expect(entry.view?.room.topic).toBeNull();
    expect(entry.status).toBe("ready");
  });

  it("drops a read response after a newer read starts", () => {
    const store = useAssignmentRoomStore.getState();
    const first = store.beginRead(ROOM_ID);
    const second = useAssignmentRoomStore.getState().beginRead(ROOM_ID);

    expect(useAssignmentRoomStore.getState().install(view(2), first)).toBe(false);
    expect(useAssignmentRoomStore.getState().install(view(3), second)).toBe(true);
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID].view?.room.revision).toBe(3);
  });

  it("drops every late response after reset", () => {
    const attempt = useAssignmentRoomStore.getState().beginRead(ROOM_ID);
    useAssignmentRoomStore.getState().reset();

    expect(useAssignmentRoomStore.getState().install(view(1), attempt)).toBe(false);
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID]).toBeUndefined();
  });

  it("does not recreate a removed room when connection cleanup finishes", () => {
    useAssignmentRoomStore.getState().install(view(1));
    useAssignmentRoomStore.getState().remove(ROOM_ID);

    useAssignmentRoomStore.getState().setConnected(ROOM_ID, false);

    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID]).toBeUndefined();
  });

  it("blocks only a duplicate mutation for the same item", () => {
    const store = useAssignmentRoomStore.getState();
    expect(store.beginItemMutation(ROOM_ID, "item-1")).toBe(true);
    expect(useAssignmentRoomStore.getState().beginItemMutation(ROOM_ID, "item-1")).toBe(
      false
    );
    expect(useAssignmentRoomStore.getState().beginItemMutation(ROOM_ID, "item-2")).toBe(
      true
    );

    useAssignmentRoomStore.getState().endItemMutation(ROOM_ID, "item-1");
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID].pendingItemIds).toEqual([
      "item-2",
    ]);
  });

  it("invalidates one room without changing another", () => {
    const other = {
      ...view(1),
      room: { ...view(1).room, id: "room-2" },
    } satisfies AssignmentRoomView;
    const firstAttempt = useAssignmentRoomStore.getState().beginRead(ROOM_ID);
    useAssignmentRoomStore.getState().install(other);
    useAssignmentRoomStore.getState().remove(ROOM_ID);

    expect(useAssignmentRoomStore.getState().install(view(2), firstAttempt)).toBe(false);
    expect(useAssignmentRoomStore.getState().rooms["room-2"].view).toEqual({
      ...other,
      room: { ...other.room, topic: null },
    });
  });
  it("derives claim activity only from a newer accepted snapshot", () => {
    const initial = {
      ...view(1),
      room: {
        ...view(1).room,
        items: [
          {
            id: "item-1",
            ordinal: 0,
            revision: 1,
            description: "Batata",
            quantityMilliunits: 1_000,
            unitPriceCents: 100,
            totalPriceCents: 100,
          },
        ],
        participants: [
          {
            id: "participant-1",
            ordinal: 0,
            displayName: "Ana",
            avatarUrl: null,
            isGuest: false,
            removed: false,
          },
        ],
        claims: [{ itemId: "item-1", participantId: "participant-1", ticks: 0 }],
      },
    } satisfies AssignmentRoomView;
    const updated = {
      ...initial,
      room: {
        ...initial.room,
        revision: 2,
        claims: [{ itemId: "item-1", participantId: "participant-1", ticks: 60 }],
      },
    };

    const store = useAssignmentRoomStore.getState();
    store.install(initial);
    store.install(updated);
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID].latestActivity).toMatchObject({
      kind: "claims",
      revision: 2,
      changes: [
        {
          itemId: "item-1",
          participantId: "participant-1",
          beforeTicks: 0,
          afterTicks: 60,
        },
      ],
    });

    store.install({ ...updated, room: { ...updated.room, revision: 2, claims: [] } });
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID].latestActivity).toMatchObject({
      kind: "claims",
      revision: 2,
    });
  });

  it("coalesces nearby joins into one visible burst", () => {
    const initial = view(1);
    const firstJoin = {
      ...initial,
      room: {
        ...initial.room,
        revision: 2,
        participants: [
          {
            id: "participant-1",
            ordinal: 0,
            displayName: "Ana",
            avatarUrl: null,
            isGuest: false,
            removed: false,
          },
        ],
      },
    } satisfies AssignmentRoomView;
    const secondJoin = {
      ...firstJoin,
      room: {
        ...firstJoin.room,
        revision: 3,
        participants: [
          ...firstJoin.room.participants,
          {
            id: "participant-2",
            ordinal: 1,
            displayName: "Bia",
            avatarUrl: null,
            isGuest: true,
            removed: false,
          },
        ],
      },
    };
    const store = useAssignmentRoomStore.getState();
    store.install(initial);
    store.install(firstJoin);
    store.install(secondJoin);
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID].latestActivity).toMatchObject({
      kind: "joined",
      participantIds: ["participant-1", "participant-2"],
      revision: 3,
    });
  });
  it("uses a neutral activity for independent join and removal deltas", () => {
    const initial = {
      ...view(1),
      room: {
        ...view(1).room,
        participants: [
          {
            id: "participant-1",
            ordinal: 0,
            displayName: "Ana",
            avatarUrl: null,
            isGuest: false,
            removed: false,
          },
          {
            id: "participant-2",
            ordinal: 1,
            displayName: "Bia",
            avatarUrl: null,
            isGuest: true,
            removed: false,
          },
        ],
      },
    } satisfies AssignmentRoomView;
    const mixed = {
      ...initial,
      room: {
        ...initial.room,
        revision: 2,
        participants: [
          initial.room.participants[0],
          { ...initial.room.participants[1], removed: true },
          {
            id: "participant-3",
            ordinal: 2,
            displayName: "Caio",
            avatarUrl: null,
            isGuest: true,
            removed: false,
          },
        ],
      },
    };

    const store = useAssignmentRoomStore.getState();
    store.install(initial);
    store.install(mixed);

    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID].latestActivity).toMatchObject({
      kind: "updated",
      revision: 2,
    });
  });
});
