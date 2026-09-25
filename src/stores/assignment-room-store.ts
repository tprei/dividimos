"use client";

import { create } from "zustand";
import type {
  AssignmentRoomActivity,
  AssignmentRoomSnapshot,
  AssignmentRoomView,
} from "@/types/assignment-room";

import type { LedgerErrorCode } from "@/lib/sync/errors";
export type AssignmentRoomLoadStatus = "idle" | "loading" | "ready" | "error";

export interface AssignmentRoomEntry {
  view: AssignmentRoomView | null;
  status: AssignmentRoomLoadStatus;
  connected: boolean;
  pendingItemIds: string[];
  errorCode: LedgerErrorCode | null;
  latestActivity: AssignmentRoomActivity | null;
}

export interface AssignmentRoomAttempt {
  epoch: number;
  generation: number;
}

interface AssignmentRoomState {
  rooms: Record<string, AssignmentRoomEntry>;
  generations: Record<string, number>;
  epoch: number;
  beginRead(roomId: string): AssignmentRoomAttempt;
  capture(roomId: string): AssignmentRoomAttempt;
  isCurrent(roomId: string, attempt: AssignmentRoomAttempt): boolean;
  install(view: AssignmentRoomView, attempt?: AssignmentRoomAttempt): boolean;
  fail(roomId: string, code: LedgerErrorCode, attempt: AssignmentRoomAttempt): boolean;
  setConnected(roomId: string, connected: boolean): void;
  beginItemMutation(roomId: string, itemId: string): boolean;
  endItemMutation(roomId: string, itemId: string): void;
  invalidate(roomId: string): void;
  remove(roomId: string): void;
  reset(): void;
}

const EMPTY_ENTRY: AssignmentRoomEntry = {
  view: null,
  status: "idle",
  connected: false,
  pendingItemIds: [],
  errorCode: null,
  latestActivity: null,
};

function entryFor(
  rooms: Record<string, AssignmentRoomEntry>,
  roomId: string
): AssignmentRoomEntry {
  return rooms[roomId] ?? EMPTY_ENTRY;
}

function withoutTopic(view: AssignmentRoomView): AssignmentRoomView {
  return { ...view, room: { ...view.room, topic: null } };
}

function sameRoomIdentity(
  previous: AssignmentRoomView,
  next: AssignmentRoomView,
): boolean {
  return (
    previous.role === next.role &&
    previous.room.id === next.room.id &&
    previous.room.selfParticipantId === next.room.selfParticipantId
  );
}

function participantOrder(snapshot: AssignmentRoomSnapshot): Map<string, number> {
  return new Map(
    snapshot.participants
      .map((participant, index) => ({ participant, index }))
      .sort((left, right) =>
        left.participant.ordinal === right.participant.ordinal
          ? left.index - right.index
          : left.participant.ordinal - right.participant.ordinal,
      )
      .map(({ participant }, index) => [participant.id, index]),
  );
}

function itemOrder(snapshot: AssignmentRoomSnapshot): Map<string, number> {
  return new Map(
    snapshot.items
      .map((item, index) => ({ item, index }))
      .sort((left, right) =>
        left.item.ordinal === right.item.ordinal
          ? left.index - right.index
          : left.item.ordinal - right.item.ordinal,
      )
      .map(({ item }, index) => [item.id, index]),
  );
}

function deriveAssignmentRoomActivity(
  previous: AssignmentRoomSnapshot,
  next: AssignmentRoomSnapshot,
  latest: AssignmentRoomActivity | null,
  observedAt: number,
): AssignmentRoomActivity | null {
  const previousParticipants = new Map(
    previous.participants.map((participant) => [participant.id, participant]),
  );
  const joined = next.participants
    .filter(
      (participant) =>
        !participant.removed &&
        !previousParticipants.has(participant.id),
    )
    .map((participant) => participant.id);
  const removed = next.participants
    .filter(
      (participant) =>
        participant.removed &&
        previousParticipants.get(participant.id)?.removed === false,
    )
    .map((participant) => participant.id);

  if (previous.status !== next.status) {
    return { kind: "status", status: next.status, revision: next.revision, observedAt };
  }

  const previousClaims = new Map(
    previous.claims.map((claim) => [`${claim.itemId}\u0000${claim.participantId}`, claim.ticks]),
  );
  const nextClaims = new Map(
    next.claims.map((claim) => [`${claim.itemId}\u0000${claim.participantId}`, claim.ticks]),
  );
  const itemPositions = new Map([...itemOrder(previous), ...itemOrder(next)]);
  const participantPositions = new Map([
    ...participantOrder(previous),
    ...participantOrder(next),
  ]);
  const keys = new Set([...previousClaims.keys(), ...nextClaims.keys()]);
  const changes = [...keys]
    .map((key) => {
      const [itemId, participantId] = key.split("\u0000");
      const beforeTicks = previousClaims.get(key) ?? 0;
      const afterTicks = nextClaims.get(key) ?? 0;
      return { itemId, participantId, beforeTicks, afterTicks };
    })
    .filter((change) => change.beforeTicks !== change.afterTicks)
    .sort(
      (left, right) =>
        (itemPositions.get(left.itemId) ?? Number.MAX_SAFE_INTEGER) -
          (itemPositions.get(right.itemId) ?? Number.MAX_SAFE_INTEGER) ||
        (participantPositions.get(left.participantId) ?? Number.MAX_SAFE_INTEGER) -
          (participantPositions.get(right.participantId) ?? Number.MAX_SAFE_INTEGER),
    );
  const removedIds = new Set(removed);
  const removalOnly =
    changes.length === 0 ||
    changes.every(
      (change) =>
        removedIds.has(change.participantId) &&
        change.beforeTicks > 0 &&
        change.afterTicks === 0,
    );
  if (removed.length > 0 && joined.length === 0 && removalOnly) {
    return { kind: "removed", participantIds: removed, revision: next.revision, observedAt };
  }

  if (joined.length > 0 && removed.length === 0 && changes.length === 0) {
    if (
      latest?.kind === "joined" &&
      observedAt - latest.burstStartedAt <= 1_500
    ) {
      return {
        kind: "joined",
        participantIds: [...new Set([...latest.participantIds, ...joined])],
        burstStartedAt: latest.burstStartedAt,
        revision: next.revision,
        observedAt,
      };
    }
    return {
      kind: "joined",
      participantIds: joined,
      burstStartedAt: observedAt,
      revision: next.revision,
      observedAt,
    };
  }
  if (changes.length > 0 && joined.length === 0 && removed.length === 0) {
    return { kind: "claims", changes, revision: next.revision, observedAt };
  }
  if (joined.length > 0 || removed.length > 0 || changes.length > 0) {
    return { kind: "updated", revision: next.revision, observedAt };
  }
  return latest;
}

export const useAssignmentRoomStore = create<AssignmentRoomState>((set, get) => ({
  rooms: {},
  generations: {},
  epoch: 0,

  beginRead(roomId) {
    const generation = (get().generations[roomId] ?? 0) + 1;
    set((state) => ({
      generations: { ...state.generations, [roomId]: generation },
      rooms: {
        ...state.rooms,
        [roomId]: {
          ...entryFor(state.rooms, roomId),
          status: "loading",
          errorCode: null,
        },
      },
    }));
    return { epoch: get().epoch, generation };
  },

  capture(roomId) {
    return {
      epoch: get().epoch,
      generation: get().generations[roomId] ?? 0,
    };
  },

  isCurrent(roomId, attempt) {
    const state = get();
    return (
      state.epoch === attempt.epoch &&
      (state.generations[roomId] ?? 0) === attempt.generation
    );
  },

  install(view, attempt) {
    const roomId = view.room.id;
    if (attempt && !get().isCurrent(roomId, attempt)) return false;
    const currentEntry = entryFor(get().rooms, roomId);
    const existing = currentEntry.view;
    if (existing && existing.room.revision > view.room.revision) return false;

    let latestActivity: AssignmentRoomActivity | null = null;
    if (existing && sameRoomIdentity(existing, view)) {
      latestActivity = currentEntry.latestActivity;
      if (view.room.revision > existing.room.revision) {
        latestActivity = deriveAssignmentRoomActivity(
          existing.room,
          view.room,
          latestActivity,
          Date.now(),
        );
      }
    }

    set((state) => ({
      rooms: {
        ...state.rooms,
        [roomId]: {
          ...entryFor(state.rooms, roomId),
          view: withoutTopic(view),
          status: "ready",
          errorCode: null,
          latestActivity,
        },
      },
    }));
    return true;
  },

  fail(roomId, code, attempt) {
    if (!get().isCurrent(roomId, attempt)) return false;
    set((state) => ({
      rooms: {
        ...state.rooms,
        [roomId]: {
          ...entryFor(state.rooms, roomId),
          status: "error",
          errorCode: code,
        },
      },
    }));
    return true;
  },

  setConnected(roomId, connected) {
    set((state) => {
      const entry = state.rooms[roomId];
      if (!entry) return state;
      return {
        rooms: {
          ...state.rooms,
          [roomId]: { ...entry, connected },
        },
      };
    });
  },

  beginItemMutation(roomId, itemId) {
    const entry = entryFor(get().rooms, roomId);
    if (entry.pendingItemIds.includes(itemId)) return false;
    set((state) => ({
      rooms: {
        ...state.rooms,
        [roomId]: {
          ...entryFor(state.rooms, roomId),
          pendingItemIds: [...entryFor(state.rooms, roomId).pendingItemIds, itemId],
        },
      },
    }));
    return true;
  },

  endItemMutation(roomId, itemId) {
    set((state) => {
      const entry = state.rooms[roomId];
      if (!entry) return state;
      return {
        rooms: {
          ...state.rooms,
          [roomId]: {
            ...entry,
            pendingItemIds: entry.pendingItemIds.filter(
              (pendingId) => pendingId !== itemId
            ),
          },
        },
      };
    });
  },

  invalidate(roomId) {
    set((state) => ({
      generations: {
        ...state.generations,
        [roomId]: (state.generations[roomId] ?? 0) + 1,
      },
    }));
  },

  remove(roomId) {
    set((state) => {
      const rooms = { ...state.rooms };
      delete rooms[roomId];
      return {
        rooms,
        generations: {
          ...state.generations,
          [roomId]: (state.generations[roomId] ?? 0) + 1,
        },
      };
    });
  },

  reset() {
    set((state) => ({ rooms: {}, generations: {}, epoch: state.epoch + 1 }));
  },
}));
