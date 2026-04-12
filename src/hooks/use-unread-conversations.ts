"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getTotalUnreadCount } from "@/lib/supabase/unread-actions";
import { useUser } from "@/hooks/use-auth";

/**
 * Returns the total unread message count across all DM conversations.
 * Refreshes on mount, on `app-refresh` events, and on realtime chat_messages INSERTs.
 */
export function useUnreadConversations(): number {
  const user = useUser();
  const [count, setCount] = useState(0);
  const supabaseRef = useRef(createClient());

  const refresh = useCallback(async () => {
    if (!user) return;
    const total = await getTotalUnreadCount(supabaseRef.current, user.id);
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
    return () => window.removeEventListener("app-refresh", handleRefresh);
  }, [refresh]);

  useEffect(() => {
    if (!user) return;

    const channel = supabaseRef.current
      .channel("unread-badge")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
        },
        (payload) => {
          if (payload.new && (payload.new as { sender_id: string }).sender_id !== user.id) {
            setCount((prev) => prev + 1);
          }
        },
      )
      .subscribe();

    return () => {
      supabaseRef.current.removeChannel(channel);
    };
  }, [user]);

  return count;
}
