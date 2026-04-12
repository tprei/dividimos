"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { chatMessageRowToChatMessage } from "@/lib/supabase/chat-actions";
import type { ChatMessage } from "@/types";
import type { Database } from "@/types/database";

type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];

export type ChatMessageEvent =
  | { type: "inserted"; message: ChatMessage }
  | { type: "updated"; message: ChatMessage }
  | { type: "deleted"; messageId: string };

/**
 * Subscribe to realtime changes on the `chat_messages` table for a group.
 * Reports new messages (INSERT), edits (UPDATE), and deletions (DELETE)
 * so the conversation thread can patch locally without a full reload.
 */
export function useRealtimeChat(
  groupId: string | undefined,
  onChatEvent: (event: ChatMessageEvent) => void,
) {
  const callbackRef = useRef(onChatEvent);
  useEffect(() => {
    callbackRef.current = onChatEvent;
  });

  useEffect(() => {
    if (!groupId || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`chat_messages:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          callbackRef.current({
            type: "inserted",
            message: chatMessageRowToChatMessage(payload.new as ChatMessageRow),
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          callbackRef.current({
            type: "updated",
            message: chatMessageRowToChatMessage(payload.new as ChatMessageRow),
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "chat_messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          callbackRef.current({
            type: "deleted",
            messageId: (payload.old as { id: string }).id,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);
}
