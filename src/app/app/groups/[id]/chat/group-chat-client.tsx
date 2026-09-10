"use client";

import { Loader2, UsersRound } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatThread } from "@/components/chat/chat-thread";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { debtRowsForGroup } from "@/lib/ledger/debt-rows";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { markRead, sendMessage } from "@/lib/sync/mutations";
import { subscribeChat } from "@/lib/sync/realtime";
import { loadConversation } from "@/lib/sync/refresh";
import { selectGroup } from "@/stores/app-selectors";
import { useAppStore } from "@/stores/app-store";

export interface GroupChatClientProps {
  groupId: string;
}


export function GroupChatClient({ groupId }: GroupChatClientProps) {
  const me = useAppStore((state) => state.me);
  const snapshot = useAppStore((state) => selectGroup(state, groupId));
  const conversation = useAppStore((state) => state.conversations[groupId]);
  const [historyCompleteGroupId, setHistoryCompleteGroupId] = useState<string | null>(null);
  const loadedRef = useRef<Set<string>>(new Set());
  const historyComplete = historyCompleteGroupId === groupId;
  const myStatus = snapshot?.members.find((member) => member.userId === me?.id)?.status;

  const accepted = useMemo(
    () => snapshot?.members.filter((member) => member.status === "accepted") ?? [],
    [snapshot],
  );
  const debtRows = useMemo(
    () => (snapshot && me ? debtRowsForGroup(snapshot, me.id) : []),
    [me, snapshot],
  );
  const netCents = debtRows.reduce(
    (sum, row) => sum + (row.direction === "owed" ? row.amountCents : -row.amountCents),
    0,
  );
  const netLabel = netCents > 0 ? "Membros te devem" : "Você deve";
  const nameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const member of snapshot?.members ?? []) names.set(member.userId, member.user.name);
    return names;
  }, [snapshot]);
  const nameOf = useCallback(
    (userId: string) => nameById.get(userId) ?? "Alguém",
    [nameById],
  );

  useEffect(() => {
    return subscribeChat(groupId);
  }, [groupId]);

  useEffect(() => {
    if (loadedRef.current.has(groupId)) return;
    loadedRef.current.add(groupId);
    loadConversation(groupId).catch((error) => toast.error(ledgerErrorMessage(error)));
  }, [groupId]);

  useEffect(() => {
    if (!snapshot || !me || myStatus !== "accepted" || snapshot.unreadCount === 0) return;
    markRead(groupId).catch(() => undefined);
  }, [groupId, me, myStatus, snapshot]);

  const handleLoadMore = useCallback(() => {
    const cursor = useAppStore.getState().conversations[groupId]?.oldestCursor;
    if (!cursor) return;
    loadConversation(groupId, cursor)
      .then(() => {
        const next = useAppStore.getState().conversations[groupId];
        if (next?.oldestCursor === cursor) setHistoryCompleteGroupId(groupId);
      })
      .catch((error) => toast.error(ledgerErrorMessage(error)));
  }, [groupId]);

  const handleSend = useCallback(
    async (content: string) => {
      try {
        await sendMessage(groupId, content);
      } catch (error) {
        toast.error(ledgerErrorMessage(error));
        throw error;
      }
    },
    [groupId],
  );

  if (!me || !snapshot) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-border/50 px-3 py-2.5">
          <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-1">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }
  if (myStatus !== "accepted") {
    return (
      <div className="flex h-full flex-col">
        <ScreenHeader back title={snapshot.group.name} />
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-sm text-muted-foreground">
            Aceite o convite do grupo para participar da conversa.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScreenHeader
        back
        title={snapshot.group.name}
        eyebrow={`${accepted.length} membros`}
        action={
          <Link
            href={`/app/groups/${groupId}`}
            aria-label="Ver grupo"
            className="flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <UsersRound className="size-5" />
          </Link>
        }
      />
      {netCents !== 0 && (
        <div className="border-b bg-muted/30 px-4 py-1.5 text-center">
          <p
            className={`flex items-center justify-center gap-1 text-xs font-medium ${
              netCents > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {netLabel}
            <Money cents={netCents} />
          </p>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <ChatThread
          groupId={groupId}
          meId={me.id}
          messages={conversation?.messages ?? []}
          events={conversation?.events ?? []}
          settlements={snapshot.settlements}
          nameOf={nameOf}
          hasMore={Boolean(conversation?.oldestCursor) && !historyComplete}
          onLoadMore={handleLoadMore}
        />
      </div>
      <ChatInput onSend={handleSend} />
    </div>
  );
}

export function GroupChatPage() {
  const params = useParams<{ id: string }>();
  return <GroupChatClient groupId={params.id} />;
}
