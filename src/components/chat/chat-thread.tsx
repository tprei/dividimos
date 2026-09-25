"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import { ChatRailRow, formatChatTime, type ChatRailMarker } from "@/components/chat/chat-rail-row";
import { displayNames } from "@/lib/people";
import { ChatDateSeparator, shouldShowDateSeparator } from "@/components/chat/chat-date-separator";
import { EventCard } from "@/components/chat/event-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import type { ChatMessage, EventKind, ExpenseSummary, GroupEvent, Settlement, SettlementStatus } from "@/types/ledger";

const STATUS_BY_EVENT_KIND: Partial<Record<EventKind, SettlementStatus>> = {
  settlement_recorded: "confirmed",
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

const RUN_WINDOW_MS = 5 * 60 * 1000;

function isSameRun(
  previous: TimelineItem | undefined,
  message: ChatMessage,
): boolean {
  if (previous?.kind !== "message" || previous.message.senderId !== message.senderId) {
    return false;
  }
  return (
    new Date(message.createdAt).getTime() - new Date(previous.message.createdAt).getTime() <=
    RUN_WINDOW_MS
  );
}

function eventMarker(event: GroupEvent): ChatRailMarker {
  if (event.kind.startsWith("expense_")) return { kind: "expense" };
  if (event.kind.startsWith("settlement_")) return { kind: "payment" };
  return { kind: "system" };
}

interface ChatThreadProps {
  groupId: string;
  meId: string;
  messages: ChatMessage[];
  events: GroupEvent[];
  settlements: Settlement[];
  expenses?: ExpenseSummary[];
  nameOf: (userId: string) => string;
  showSenderNames?: boolean;
  loading?: boolean;
  hasMore?: boolean;
  /** Server-confirmed contiguous boundary this thread may acknowledge. */
  acknowledgeThroughId?: string | null;
  /** Fires once that boundary is actually present in the rendered timeline. */
  onRenderedThrough?: (messageId: string) => void;
  onLoadMore?: () => void;
}

export function ChatThread({
  groupId,
  meId,
  messages,
  events,
  settlements,
  expenses = [],
  nameOf,
  showSenderNames = true,
  loading,
  hasMore,
  acknowledgeThroughId,
  onRenderedThrough,
  onLoadMore,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevItemCount = useRef(messages.length + events.length);

  const items = mergeTimeline(messages, events);
  const senderNames = displayNames([...messages.map(({ sender }) => sender), ...events.flatMap(({ actor }) => actor ? [actor] : [])], { style: "short", viewerId: meId });

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
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

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (isAtBottom) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [isAtBottom, items.length]);

  useEffect(() => {
    // Reporting after render is what makes acknowledgement honest: a boundary
    // the user never had on screen must not count as read.
    if (!acknowledgeThroughId || !onRenderedThrough) return;
    if (!messages.some((message) => message.id === acknowledgeThroughId)) return;
    onRenderedThrough(acknowledgeThroughId);
  }, [acknowledgeThroughId, messages, onRenderedThrough]);

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
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-3"
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
        const membershipEvent = item.kind === "event" && (item.event.kind === "member_joined" || item.event.kind === "member_left");
        if (membershipEvent && previous?.kind === "event" && previous.event.kind === item.event.kind && !showSeparator) return null;
        const memberNames: string[] = [];
        if (membershipEvent) {
          for (let cursor = index; cursor < items.length; cursor += 1) {
            const candidate = items[cursor];
            if (candidate.kind !== "event" || candidate.event.kind !== item.event.kind || shouldShowDateSeparator(candidate.at, item.at)) break;
            const id = candidate.event.subjectUserId ?? candidate.event.actorId;
            if (id) memberNames.push(senderNames.get(id) ?? nameOf(id));
          }
        }
        const continuesRun = item.kind === "message" && isSameRun(previous, item.message);
        const spaced = !showSeparator && previous !== undefined && !continuesRun;
        let marker: ChatRailMarker;
        if (item.kind === "event") {
          marker = eventMarker(item.event);
        } else if (item.message.senderId !== meId && !continuesRun) {
          marker = {
            kind: "avatar",
            id: item.message.senderId,
            name: item.message.sender.name,
            avatarUrl: item.message.sender.avatarUrl,
            isBot: item.message.sender.isBot,
          };
        } else {
          marker = { kind: "message" };
        }
        return (
          <div key={item.kind === "message" ? item.message.id : `event-${item.event.id}`}>
            {showSeparator && <ChatDateSeparator date={item.at} />}
            <ChatRailRow marker={marker} spaced={spaced}>
              {item.kind === "message" ? (
                <ChatMessageBubble
                  message={item.message}
                  isOwn={item.message.senderId === meId}
                  senderLabel={
                    showSenderNames && marker.kind === "avatar"
                      ? senderNames.get(item.message.senderId)
                      : undefined
                  }
                />
              ) : membershipEvent && memberNames.length > 1 ? (
                <div className="flex min-h-6 max-w-80 items-baseline gap-2 pr-3">
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {new Intl.ListFormat("pt-BR").format(memberNames)} {item.event.kind === "member_joined" ? "entraram" : "saíram"}
                  </p>
                  <time dateTime={item.at} className="shrink-0 text-2xs leading-4 tabular-nums text-muted-foreground">
                    {formatChatTime(item.at)}
                  </time>
                </div>
              ) : (
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
                  myShareCents={expenses.find((expense) => expense.id === item.event.expenseId)?.myShareCents}
                />
              )}
            </ChatRailRow>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
