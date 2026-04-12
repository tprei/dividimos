"use client";

import { use, useCallback, useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { ConversationHeader } from "@/components/chat/conversation-header";
import { ConversationPayButton } from "@/components/chat/conversation-pay-button";
import { ChatThread } from "@/components/chat/chat-thread";
import { ChatInput } from "@/components/chat/chat-input";
import { Skeleton } from "@/components/shared/skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { getOrCreateDmGroup } from "@/lib/supabase/dm-actions";
import {
  loadConversationMessages,
  sendChatMessage,
  type ConversationThread,
} from "@/lib/supabase/chat-actions";
import { createClient } from "@/lib/supabase/client";
import { userProfileRowToUserProfile } from "@/lib/supabase/expense-mappers";
import type { ChatMessageWithSender, Expense, Settlement, UserProfile } from "@/types";

type DmMemberStatus = "accepted" | "invited" | "declined";

export default function ConversationPage({
  params,
}: {
  params: Promise<{ counterpartyId: string }>;
}) {
  const { counterpartyId } = use(params);
  const { user } = useAuth();

  const [counterparty, setCounterparty] = useState<UserProfile | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [thread, setThread] = useState<ConversationThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callerStatus, setCallerStatus] = useState<DmMemberStatus>("accepted");
  const [counterpartyStatus, setCounterpartyStatus] = useState<DmMemberStatus>("accepted");

  const PAGE_SIZE = 50;

  const initialize = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    const supabase = createClient();

    const [profileResult, dmResult] = await Promise.all([
      supabase
        .from("user_profiles")
        .select("*")
        .eq("id", counterpartyId)
        .single(),
      getOrCreateDmGroup(counterpartyId),
    ]);

    if (profileResult.error || !profileResult.data) {
      setError("Usuário não encontrado");
      setLoading(false);
      return;
    }

    setCounterparty(userProfileRowToUserProfile(profileResult.data));

    if ("error" in dmResult) {
      setError(dmResult.error);
      setLoading(false);
      return;
    }

    const gId = dmResult.groupId;
    setGroupId(gId);

    const [messagesResult, membersResult] = await Promise.all([
      loadConversationMessages(gId, { limit: PAGE_SIZE }),
      supabase
        .from("group_members")
        .select("user_id, status")
        .eq("group_id", gId)
        .in("user_id", [user.id, counterpartyId]),
    ]);

    if ("error" in messagesResult) {
      setError(messagesResult.error);
      setLoading(false);
      return;
    }

    const memberRows = (membersResult.data ?? []) as { user_id: string; status: string }[];
    const callerRow = memberRows.find((m) => m.user_id === user.id);
    const counterpartyRow = memberRows.find((m) => m.user_id === counterpartyId);
    setCallerStatus((callerRow?.status ?? "accepted") as DmMemberStatus);
    setCounterpartyStatus((counterpartyRow?.status ?? "invited") as DmMemberStatus);

    setThread(messagesResult);
    setHasMore(messagesResult.messages.length >= PAGE_SIZE);
    setLoading(false);
  }, [user, counterpartyId]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleLoadMore = useCallback(async () => {
    if (!groupId || !thread || loadingMore || !hasMore) return;

    const oldestMessage = thread.messages[0];
    if (!oldestMessage) return;

    setLoadingMore(true);

    const result = await loadConversationMessages(groupId, {
      limit: PAGE_SIZE,
      before: oldestMessage.createdAt,
    });

    if ("error" in result) {
      setLoadingMore(false);
      return;
    }

    setThread((prev) => {
      if (!prev) return result;

      return {
        messages: [...result.messages, ...prev.messages],
        profiles: new Map([...prev.profiles, ...result.profiles]),
        expenses: new Map<string, Expense>([...prev.expenses, ...result.expenses]),
        settlements: new Map<string, Settlement>([...prev.settlements, ...result.settlements]),
      };
    });

    setHasMore(result.messages.length >= PAGE_SIZE);
    setLoadingMore(false);
  }, [groupId, thread, loadingMore, hasMore]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!groupId || !user) return;

      const result = await sendChatMessage(groupId, content);
      if ("error" in result) return;

      const senderProfile: UserProfile = {
        id: user.id,
        handle: user.handle,
        name: user.name,
        avatarUrl: user.avatarUrl,
      };

      const messageWithSender: ChatMessageWithSender = {
        ...result,
        sender: senderProfile,
      };

      setThread((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          messages: [...prev.messages, messageWithSender],
        };
      });
    },
    [groupId, user],
  );

  const handleAccept = useCallback(async () => {
    if (!groupId || !user) return;
    await createClient()
      .from("group_members")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .eq("user_id", user.id);
    setCallerStatus("accepted");
  }, [groupId, user]);

  const handleDecline = useCallback(async () => {
    if (!groupId || !user) return;
    await createClient()
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", user.id);
    setCallerStatus("declined");
  }, [groupId, user]);

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-border/50 px-3 py-2.5">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <button
          onClick={initialize}
          className="text-sm text-primary underline"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!counterparty || !thread || !user) return null;

  if (callerStatus === "declined") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm text-muted-foreground">Você recusou este convite.</p>
      </div>
    );
  }

  if (callerStatus === "invited") {
    return (
      <div className="flex h-full flex-col">
        <ConversationHeader counterparty={counterparty} />
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
          <UserAvatar name={counterparty.name} avatarUrl={counterparty.avatarUrl} size="lg" />
          <div className="space-y-1">
            <p className="font-semibold">{counterparty.name}</p>
            <p className="text-sm text-muted-foreground">
              Esta conversa está pendente. @{counterparty.handle} convidou você a conversar.
            </p>
          </div>
          <div className="flex w-full max-w-xs flex-col gap-3">
            <Button onClick={handleAccept} className="w-full gap-2">
              <Check className="h-4 w-4" />
              Aceitar convite
            </Button>
            <Button variant="outline" onClick={handleDecline} className="w-full gap-2">
              <X className="h-4 w-4" />
              Recusar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isCounterpartyPending = counterpartyStatus === "invited";

  return (
    <div className="flex h-full flex-col">
      <ConversationHeader
        counterparty={counterparty}
        actions={
          !isCounterpartyPending ? (
            <ConversationPayButton
              currentUserId={user.id}
              counterpartyId={counterpartyId}
              counterpartyName={counterparty.name}
            />
          ) : undefined
        }
      />
      {isCounterpartyPending && (
        <div className="border-b bg-muted/50 px-4 py-2.5">
          <p className="text-center text-xs text-muted-foreground">
            Aguardando @{counterparty.handle} aceitar o convite
          </p>
        </div>
      )}
      <ChatThread
        messages={thread.messages}
        expenses={thread.expenses}
        settlements={thread.settlements}
        profiles={thread.profiles}
        currentUserId={user.id}
        loading={loadingMore}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
      />
      {!isCounterpartyPending && <ChatInput onSend={handleSend} />}
    </div>
  );
}
