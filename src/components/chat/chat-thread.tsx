"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import { ChatRailRow, formatChatTime, type ChatRailMarker, type RailPerson } from "@/components/chat/chat-rail-row";
import { displayNames } from "@/lib/people";
import { ChatDateSeparator, shouldShowDateSeparator } from "@/components/chat/chat-date-separator";
import { EventCard } from "@/components/chat/event-card";
import { RoomOpenedEvent } from "@/components/chat/room-opened-event";
import type { OpenableGroupRoom } from "@/hooks/use-open-group-room";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import type { ChatMessage, EventKind, ExpenseSummary, GroupEvent, Settlement, SettlementStatus, UserProfile } from "@/types/ledger";

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

function eventPeopleIds(event: GroupEvent): string[] {
  const ids: string[] = [];
  const push = (id: string | null | undefined) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  if (event.kind === "member_invited") {
    push(event.actorId);
    if (Array.isArray(event.payload.userIds)) {
      for (const id of event.payload.userIds) {
        if (typeof id === "string") push(id);
      }
    }
    push(event.subjectUserId);
  } else if (event.kind === "member_removed" || event.kind === "nudge") {
    push(event.actorId);
    push(event.subjectUserId);
  } else {
    push(event.subjectUserId ?? event.actorId);
  }
  return ids;
}

function eventMarker(
  event: GroupEvent,
  peopleMarker: (ids: string[]) => ChatRailMarker,
): ChatRailMarker {
  if (event.kind.startsWith("expense_")) return { kind: "expense" };
  if (event.kind.startsWith("settlement_")) return { kind: "payment" };
  return peopleMarker(eventPeopleIds(event));
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
  /** Resolves full profiles for people an event names but the thread payload does not carry. */
  profileOf?: (userId: string) => UserProfile | undefined;
  /** Server-confirmed contiguous boundary this thread may acknowledge. */
  acknowledgeThroughId?: string | null;
  /** Fires once that boundary is actually present in the rendered timeline. */
  onRenderedThrough?: (messageId: string) => void;
  onLoadMore?: () => void;
  pendingRoomId?: string | null;
  onOpenRoom?: (room: OpenableGroupRoom) => void;
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
  profileOf,
  acknowledgeThroughId,
  onRenderedThrough,
  onLoadMore,
  pendingRoomId = null,
  onOpenRoom,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevItemCount = useRef(messages.length + events.length);

  const items = mergeTimeline(messages, events);
  const senderNames = displayNames([...messages.map(({ sender }) => sender), ...events.flatMap(({ actor }) => actor ? [actor] : [])], { style: "short", viewerId: meId });
  const peopleMarker = (ids: string[]): ChatRailMarker => {
    const people: RailPerson[] = ids.map((id) => {
      const profile = profileOf?.(id) ?? events.find((event) => event.actor?.id === id)?.actor;
      return {
        id,
        name: profile?.name ?? nameOf(id),
        avatarUrl: profile?.avatarUrl ?? null,
        isBot: profile?.isBot ?? false,
      };
    });
    return people.length > 0 ? { kind: "people", people } : { kind: "system" };
  };

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
        const memberIds: string[] = [];
        if (membershipEvent) {
          for (let cursor = index; cursor < items.length; cursor += 1) {
            const candidate = items[cursor];
            if (candidate.kind !== "event" || candidate.event.kind !== item.event.kind || shouldShowDateSeparator(candidate.at, item.at)) break;
            const id = candidate.event.subjectUserId ?? candidate.event.actorId;
            if (id && !memberIds.includes(id)) memberIds.push(id);
          }
        }
        const continuesRun = item.kind === "message" && isSameRun(previous, item.message);
        const spaced = !showSeparator && previous !== undefined && !continuesRun;
        if (item.kind === "event" && item.event.kind === "assignment_room_opened") {
          if (!onOpenRoom) return null;
          const actorId = item.event.actorId;
          return (
            <div key={`event-${item.event.id}`}>
              {showSeparator && <ChatDateSeparator date={item.at} />}
              <RoomOpenedEvent
                event={item.event}
                meId={meId}
                actorName={actorId ? senderNames.get(actorId) ?? nameOf(actorId) : "Alguém"}
                spaced={spaced}
                pendingRoomId={pendingRoomId}
                onOpenRoom={onOpenRoom}
              />
            </div>
          );
        }
        const settlementId = item.kind === "event" ? item.event.settlementId : null;
        const settlement = settlementId ? settlements.find((s) => s.id === settlementId) ?? null : null;
        const latestStatus = settlementId ? latestSettlementStatus.get(settlementId) ?? null : null;
        let marker: ChatRailMarker;
        if (item.kind === "event") {
          marker = memberIds.length > 1 ? peopleMarker(memberIds) : eventMarker(item.event, peopleMarker);
          if (marker.kind === "payment" && (item.event.kind === "settlement_voided" || (settlement?.status ?? latestStatus) === "voided")) {
            marker = { kind: "message" };
          }
        } else if (item.message.senderId !== meId && !continuesRun) {
          marker = { kind: "people", people: [item.message.sender] };
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
                    showSenderNames && marker.kind === "people"
                      ? senderNames.get(item.message.senderId)
                      : undefined
                  }
                />
              ) : membershipEvent && memberIds.length > 1 ? (
                <div className="flex min-h-6 items-baseline gap-2">
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {new Intl.ListFormat("pt-BR").format(memberIds.map((id) => senderNames.get(id) ?? nameOf(id)))} {item.event.kind === "member_joined" ? "entraram" : "saíram"}
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
                  settlement={settlement}
                  latestStatus={latestStatus}
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
