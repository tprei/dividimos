"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { chatMessageRowToMessage } from "@/lib/supabase/chat-actions";
import {
  userProfileRowToUserProfile,
} from "@/lib/supabase/expense-mappers";
import type { ChatMessageWithSender } from "@/types";
import type { Database } from "@/types/database";

type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];
type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

/**
 * Subscribe to realtime INSERT events on `chat_messages` for a specific group.
 * Resolves the sender profile before calling `onNewMessage` so the consumer
 * can patch state directly (no full reload).
 */
export function useRealtimeChat(
  groupId: string | undefined,
  onNewMessage: (message: ChatMessageWithSender) => void,
) {
  const callbackRef = useRef(onNewMessage);
  useEffect(() => {
    callbackRef.current = onNewMessage;
  });

  // Cache profiles we've already resolved to avoid repeated lookups
  const profileCacheRef = useRef(new Map<string, UserProfileRow>());

  useEffect(() => {
    if (!groupId || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`chat:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `group_id=eq.${groupId}`,
        },
        async (payload) => {
          const row = payload.new as ChatMessageRow;
          const message = chatMessageRowToMessage(row);

          // Resolve sender profile
          let profileRow = profileCacheRef.current.get(row.sender_id);
          if (!profileRow) {
            const { data } = await supabase
              .from("user_profiles")
              .select("*")
              .eq("id", row.sender_id)
              .single();
            if (data) {
              profileRow = data as UserProfileRow;
              profileCacheRef.current.set(row.sender_id, profileRow);
            }
          }

          const sender = profileRow
            ? userProfileRowToUserProfile(profileRow)
            : { id: row.sender_id, handle: "", name: "Usuário", avatarUrl: undefined };

          callbackRef.current({ ...message, sender });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);
}
