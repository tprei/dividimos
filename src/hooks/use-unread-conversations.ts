"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getTotalUnreadCount } from "@/lib/supabase/unread-actions";
import { useUser } from "@/hooks/use-auth";
import { validateRealtimeRow } from "./realtime-payload";

/** Debounce window for coalescing bursts of incoming-message events. */
const UNREAD_REFRESH_DEBOUNCE_MS = 500;

/**
 * Returns the total unread message count across all DM conversations.
 * Refreshes on mount, on `app-refresh` events, and on realtime chat_messages INSERTs.
 */
export function useUnreadConversations(): number {
  const user = useUser();
  const [count, setCount] = useState(0);
  const supabaseRef = useRef(createClient());
  // Unique per instance so multiple badge mounts / HMR don't collide on one channel.
  const channelName = `unread-badge:${useId()}`;
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    const total = await getTotalUnreadCount(supabaseRef.current);
    setCount(total);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleRefresh = () => {
      refresh();
    };
    window.addEventListener("app-refresh", handleRefresh);
    window.addEventListener("conversations-read", handleRefresh);
    return () => {
      window.removeEventListener("app-refresh", handleRefresh);
      window.removeEventListener("conversations-read", handleRefresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!user) return;

    const supabase = supabaseRef.current;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
        },
        (payload) => {
          const row = validateRealtimeRow<{ sender_id: string }>(payload.new, [
            "sender_id",
          ]);
          // Skip our own messages; for others, re-fetch the authoritative count
          // (a debounced single query) rather than blindly incrementing — the
          // optimistic +1 double-counted the open conversation and cross groups.
          if (!row || row.sender_id === user.id) return;
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = setTimeout(
            () => refresh(),
            UNREAD_REFRESH_DEBOUNCE_MS,
          );
        },
      )
      .subscribe();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [user, refresh, channelName]);

  return count;
}
