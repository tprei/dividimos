"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ConversationHeader } from "@/components/chat/conversation-header";
import { ChatThread } from "@/components/chat/chat-thread";
import { ChatInput } from "@/components/chat/chat-input";
import { Skeleton } from "@/components/shared/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { getOrCreateDmGroup } from "@/lib/supabase/dm-actions";
import {
  loadConversationMessages,
  type ConversationThread,
} from "@/lib/supabase/chat-actions";
import { createClient } from "@/lib/supabase/client";
import { userProfileRowToUserProfile } from "@/lib/supabase/expense-mappers";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import type {
  ChatMessageWithSender,
  Expense,
  Settlement,
  UserProfile,
} from "@/types";

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

  const PAGE_SIZE = 50;

  // Fetch counterparty profile and DM group in parallel
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

    const result = await loadConversationMessages(gId, { limit: PAGE_SIZE });
    if ("error" in result) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setThread(result);
    setHasMore(result.messages.length >= PAGE_SIZE);
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

      // Merge older messages at the front
      const mergedProfiles = new Map([
        ...prev.profiles,
        ...result.profiles,
      ]);
      const mergedExpenses = new Map<string, Expense>([
        ...prev.expenses,
        ...result.expenses,
      ]);
      const mergedSettlements = new Map<string, Settlement>([
        ...prev.settlements,
        ...result.settlements,
      ]);

      return {
        messages: [...result.messages, ...prev.messages],
        profiles: mergedProfiles,
        expenses: mergedExpenses,
        settlements: mergedSettlements,
      };
    });

    setHasMore(result.messages.length >= PAGE_SIZE);
    setLoadingMore(false);
  }, [groupId, thread, loadingMore, hasMore]);

  const router = useRouter();

  const members = useMemo(() => {
    if (!counterparty) return [];
    return [{ handle: counterparty.handle, name: counterparty.name }];
  }, [counterparty]);

  const handleSendText = useCallback(
    async (text: string) => {
      if (!groupId || !user || !thread) return;

      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from("chat_messages")
        .insert({
          group_id: groupId,
          sender_id: user.id,
          message_type: "text" as const,
          content: text,
        })
        .select()
        .single();

      if (insertError || !data) {
        console.error("[ConversationPage] send text error:", insertError);
        return;
      }

      const profile = thread.profiles.get(user.id);
      if (!profile) return;

      const newMessage: ChatMessageWithSender = {
        id: data.id,
        groupId: data.group_id,
        senderId: data.sender_id,
        messageType: data.message_type as ChatMessageWithSender["messageType"],
        content: data.content,
        createdAt: data.created_at,
        sender: profile,
      };

      setThread((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: [...prev.messages, newMessage],
        };
      });
    },
    [groupId, user, thread],
  );

  const handleAiResult = useCallback(
    (result: ChatExpenseResult, _originalText: string) => {
      if (!groupId) return;
      const params = new URLSearchParams({ groupId });
      params.set("aiTitle", result.title);
      if (result.amountCents > 0) {
        params.set("aiAmount", String(result.amountCents));
      }
      if (result.expenseType) {
        params.set("aiType", result.expenseType);
      }
      if (result.payerHandle) {
        params.set("aiPayer", result.payerHandle);
      }
      if (result.merchantName) {
        params.set("aiMerchant", result.merchantName);
      }
      if (result.splitType) {
        params.set("aiSplit", result.splitType);
      }
      router.push(`/app/bill/new?${params.toString()}`);
    },
    [groupId, router],
  );

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

  return (
    <div className="flex h-full flex-col">
      <ConversationHeader counterparty={counterparty} />
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
      {groupId && (
        <ChatInput
          groupId={groupId}
          members={members}
          onSendText={handleSendText}
          onAiResult={handleAiResult}
        />
      )}
    </div>
  );
}
