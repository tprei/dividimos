"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import {
  SystemMessageCard,
  type SystemMessageData,
} from "@/components/chat/system-message-card";
import { EmptyState } from "@/components/shared/empty-state";
import type {
  ChatMessageWithSender,
  Expense,
  Settlement,
  UserProfile,
} from "@/types";

interface ChatThreadProps {
  messages: ChatMessageWithSender[];
  expenses: Map<string, Expense>;
  settlements: Map<string, Settlement>;
  profiles: Map<string, UserProfile>;
  currentUserId: string;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

function groupMessagesByDate(
  messages: ChatMessageWithSender[],
): { date: string; messages: ChatMessageWithSender[] }[] {
  const groups: { date: string; messages: ChatMessageWithSender[] }[] = [];
  let currentDate = "";

  for (const msg of messages) {
    const date = new Date(msg.createdAt).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    if (date !== currentDate) {
      currentDate = date;
      groups.push({ date, messages: [] });
    }
    groups[groups.length - 1].messages.push(msg);
  }

  return groups;
}

export function ChatThread({
  messages,
  expenses,
  settlements,
  profiles,
  currentUserId,
  loading,
  hasMore,
  onLoadMore,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevMessageCount = useRef(messages.length);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Auto-scroll when new messages arrive and user is at the bottom
  useEffect(() => {
    if (messages.length > prevMessageCount.current && isAtBottom) {
      scrollToBottom();
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, isAtBottom, scrollToBottom]);

  // Initial scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const threshold = 100;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setIsAtBottom(atBottom);

    // Load more when scrolled near the top
    if (el.scrollTop < 100 && hasMore && onLoadMore) {
      onLoadMore();
    }
  }, [hasMore, onLoadMore]);

  if (!loading && messages.length === 0) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="Nenhuma mensagem"
        description="Crie uma conta ou faça um pagamento para começar a conversa."
      />
    );
  }

  const dateGroups = groupMessagesByDate(messages);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex flex-1 flex-col overflow-y-auto px-4"
    >
      {loading && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {dateGroups.map((group) => (
        <div key={group.date}>
          <div className="sticky top-0 z-10 flex justify-center py-3">
            <span className="rounded-full bg-muted/80 px-3 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur-sm">
              {group.date}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {group.messages.map((msg) => {
              const isOwn = msg.senderId === currentUserId;

              if (msg.messageType === "system_expense" && msg.expenseId) {
                const expense = expenses.get(msg.expenseId);
                const creator = profiles.get(msg.senderId);
                if (!expense || !creator) return null;

                const data: SystemMessageData = {
                  type: "system_expense",
                  expense: { expense, creator },
                };

                return (
                  <div key={msg.id} className="py-2">
                    <SystemMessageCard
                      messageType={msg.messageType}
                      data={data}
                    />
                  </div>
                );
              }

              if (
                msg.messageType === "system_settlement" &&
                msg.settlementId
              ) {
                const settlement = settlements.get(msg.settlementId);
                if (!settlement) return null;

                const fromUser = profiles.get(settlement.fromUserId);
                const toUser = profiles.get(settlement.toUserId);
                if (!fromUser || !toUser) return null;

                const data: SystemMessageData = {
                  type: "system_settlement",
                  settlement: { settlement, fromUser, toUser },
                };

                return (
                  <div key={msg.id} className="py-2">
                    <SystemMessageCard
                      messageType={msg.messageType}
                      data={data}
                    />
                  </div>
                );
              }

              return (
                <ChatMessageBubble
                  key={msg.id}
                  message={msg}
                  isOwn={isOwn}
                />
              );
            })}
          </div>
        </div>
      ))}

      <div ref={bottomRef} />
    </div>
  );
}
