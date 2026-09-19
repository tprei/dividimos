import type { RealtimeChannel } from "@supabase/supabase-js";
import { useAssignmentRoomStore } from "@/stores/assignment-room-store";
import {
  clearAssignmentRoomAccess,
  getAssignmentRoomMemberToken,
  getAssignmentRoomTopic,
  refreshAssignmentRoom,
  refreshAssignmentRoomMember,
} from "./assignment-rooms";
import { getSupabase } from "./client";
import { LedgerError } from "./errors";

interface AssignmentInvalidation {
  revision: number;
}

function parseInvalidation(raw: unknown): AssignmentInvalidation | null {
  if (typeof raw !== "object" || raw === null || !("revision" in raw)) return null;
  const revision = raw.revision;
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 1
    ? { revision }
    : null;
}

const activeSubscriptions = new Set<() => void>();

export function stopAllAssignmentRoomRealtime(): void {
  for (const stop of [...activeSubscriptions]) stop();
}

export function startAssignmentRoomRealtime(roomId: string): () => void {
  let disposed = false;
  let channel: RealtimeChannel | null = null;
  let channelTopic: string | null = null;
  let refreshInFlight: Promise<void> | null = null;
  let refreshPending = false;
  let initialGuestHydration = getAssignmentRoomMemberToken(roomId) !== null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const setConnected = (connected: boolean) => {
    if (!disposed) useAssignmentRoomStore.getState().setConnected(roomId, connected);
  };

  const removeChannel = () => {
    const current = channel;
    channel = null;
    channelTopic = null;
    if (current) void getSupabase().removeChannel(current);
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return;
    const delay = Math.min(250 * 2 ** reconnectAttempt, 4_000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!disposed) scheduleRefresh();
    }, delay);
  };

  const subscribe = () => {
    if (disposed) return;
    const topic = getAssignmentRoomTopic(roomId);
    if (!topic) return;
    if (channel && channelTopic === topic) return;
    removeChannel();
    channelTopic = topic;
    channel = getSupabase()
      .channel(topic, { config: { private: true } })
      .on("broadcast", { event: "assignment" }, ({ payload }) => {
        const parsed = parseInvalidation(payload);
        const revision =
          useAssignmentRoomStore.getState().rooms[roomId]?.view?.room.revision ?? 0;
        if (parsed && parsed.revision > revision) scheduleRefresh();
      })
      .on("broadcast", { event: "access_changed" }, () => {
        setConnected(false);
        scheduleRefresh();
      })
      .subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          scheduleRefresh();
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnected(false);
          removeChannel();
          scheduleRefresh();
          scheduleReconnect();
        }
      });
  };

  const executeRefresh = async () => {
    try {
      if (initialGuestHydration) {
        initialGuestHydration = false;
        await refreshAssignmentRoomMember(roomId);
      } else {
        await refreshAssignmentRoom(roomId);
      }
      if (disposed) return;
      reconnectAttempt = 0;
      clearTimeout(reconnectTimer ?? undefined);
      reconnectTimer = null;
      setConnected(true);
      subscribe();
    } catch (error) {
      if (disposed) return;
      setConnected(false);
      if (error instanceof LedgerError && error.code === "invalid_token") {
        clearAssignmentRoomAccess(roomId);
        dispose();
        return;
      }
      scheduleReconnect();
    }
  };

  const runRefresh = () => {
    const task = executeRefresh().finally(() => {
      if (refreshInFlight !== task) return;
      refreshInFlight = null;
      if (refreshPending && !disposed) {
        refreshPending = false;
        runRefresh();
      }
    });
    refreshInFlight = task;
  };

  const scheduleRefresh = () => {
    if (disposed) return;
    if (!refreshInFlight) {
      runRefresh();
      return;
    }
    refreshPending = true;
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible") scheduleRefresh();
  };
  const handleOnline = () => scheduleRefresh();

  function dispose(): void {
    if (disposed) return;
    useAssignmentRoomStore.getState().setConnected(roomId, false);
    activeSubscriptions.delete(dispose);
    disposed = true;
    clearTimeout(reconnectTimer ?? undefined);
    reconnectTimer = null;
    refreshPending = false;
    removeChannel();
    useAssignmentRoomStore.getState().invalidate(roomId);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibility);
    }
    if (typeof window !== "undefined") window.removeEventListener("online", handleOnline);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibility);
  }
  if (typeof window !== "undefined") window.addEventListener("online", handleOnline);
  setConnected(false);
  activeSubscriptions.add(dispose);
  scheduleRefresh();
  return dispose;
}
