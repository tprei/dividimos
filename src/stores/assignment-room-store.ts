"use client";

import { create } from "zustand";
import type { LedgerErrorCode } from "@/lib/sync/errors";
import type { AssignmentRoomView } from "@/types/assignment-room";

export type AssignmentRoomLoadStatus = "idle" | "loading" | "ready" | "error";

export interface AssignmentRoomEntry {
  view: AssignmentRoomView | null;
  status: AssignmentRoomLoadStatus;
  connected: boolean;
  pendingItemIds: string[];
  errorCode: LedgerErrorCode | null;
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
  remove(roomId: string): void;
  reset(): void;
}

const EMPTY_ENTRY: AssignmentRoomEntry = {
  view: null,
  status: "idle",
  connected: false,
  pendingItemIds: [],
  errorCode: null,
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
    const existing = get().rooms[roomId]?.view;
    if (existing && existing.room.revision > view.room.revision) return false;
    set((state) => ({
      rooms: {
        ...state.rooms,
        [roomId]: {
          ...entryFor(state.rooms, roomId),
          view: withoutTopic(view),
          status: "ready",
          errorCode: null,
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
    set((state) => ({
      rooms: {
        ...state.rooms,
        [roomId]: { ...entryFor(state.rooms, roomId), connected },
      },
    }));
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
