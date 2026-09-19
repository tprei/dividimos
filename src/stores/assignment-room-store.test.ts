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
});
