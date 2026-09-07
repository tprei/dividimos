"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import { ChatDateSeparator, shouldShowDateSeparator } from "@/components/chat/chat-date-separator";
import { EventCard } from "@/components/chat/event-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import type { ChatMessage, EventKind, GroupEvent, Settlement, SettlementStatus } from "@/types/ledger";

const STATUS_BY_EVENT_KIND: Partial<Record<EventKind, SettlementStatus>> = {
  settlement_recorded: "pending",
  settlement_confirmed: "confirmed",
  settlement_voided: "voided",
};

export type TimelineItem =
  | { kind: "message"; at: string; message: ChatMessage }
  | { kind: "event"; at: string; event: GroupEvent };

export function mergeTimeline(
  messages: ChatMessage[],
  events: GroupEvent[],
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...messages.map((message) => ({ kind: "message" as const, at: message.createdAt, message })),
    ...events.map((event) => ({ kind: "event" as const, at: event.createdAt, event })),
  ];
  items.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (a.kind === b.kind) return 0;
    return a.kind === "event" ? -1 : 1;
  });
  return items;
}

interface ChatThreadProps {
  groupId: string;
  meId: string;
  messages: ChatMessage[];
  events: GroupEvent[];
  settlements: Settlement[];
  nameOf: (userId: string) => string;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export function ChatThread({
  groupId,
  meId,
  messages,
  events,
  settlements,
  nameOf,
  loading,
  hasMore,
  onLoadMore,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevItemCount = useRef(messages.length + events.length);

  const items = mergeTimeline(messages, events);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    const count = messages.length + events.length;
    if (count > prevItemCount.current && isAtBottom) {
      scrollToBottom();
    }
    prevItemCount.current = count;
  }, [messages.length, events.length, isAtBottom, scrollToBottom]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
  }, []);

  if (!loading && items.length === 0) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="Nenhuma mensagem"
        description="Envie uma mensagem ou registre um pagamento para começar a conversa."
      />
    );
  }

  const latestSettlementStatus = new Map<string, SettlementStatus>();
  for (const event of events) {
    if (!event.settlementId) continue;
    const status = STATUS_BY_EVENT_KIND[event.kind];
    if (status) latestSettlementStatus.set(event.settlementId, status);
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex flex-1 flex-col overflow-y-auto px-4"
    >
      {hasMore && onLoadMore && (
        <div className="flex justify-center py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={loading}
            data-testid="chat-load-more"
          >
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Carregar anteriores
          </Button>
        </div>
      )}

      {items.map((item, index) => {
        const previous = index > 0 ? items[index - 1] : undefined;
        const showSeparator = shouldShowDateSeparator(item.at, previous?.at);
        return (
          <div key={item.kind === "message" ? item.message.id : `event-${item.event.id}`}>
            {showSeparator && <ChatDateSeparator date={item.at} />}
            {item.kind === "message" ? (
              <ChatMessageBubble
                message={item.message}
                isOwn={item.message.senderId === meId}
                showAvatar={item.message.senderId !== meId}
              />
            ) : (
              <div className="py-2">
                <EventCard
                  event={item.event}
                  groupId={groupId}
                  meId={meId}
                  settlement={
                    item.event.settlementId
                      ? settlements.find((s) => s.id === item.event.settlementId) ?? null
                      : null
                  }
                  latestStatus={
                    item.event.settlementId
                      ? latestSettlementStatus.get(item.event.settlementId) ?? null
                      : null
                  }
                  nameOf={nameOf}
                />
              </div>
            )}
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
