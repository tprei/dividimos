"use client";

import { use, useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ConversationHeader } from "@/components/chat/conversation-header";
import { ConversationPayButton } from "@/components/chat/conversation-pay-button";
import { ChatThread } from "@/components/chat/chat-thread";
import { Skeleton } from "@/components/shared/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { getOrCreateDmGroup } from "@/lib/supabase/dm-actions";
import {
  loadConversationMessages,
  type ConversationThread,
} from "@/lib/supabase/chat-actions";
import { createClient } from "@/lib/supabase/client";
import { userProfileRowToUserProfile } from "@/lib/supabase/expense-mappers";
import type { Expense, Settlement, UserProfile } from "@/types";

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
      <ConversationHeader
        counterparty={counterparty}
        actions={
          <ConversationPayButton
            currentUserId={user.id}
            counterpartyId={counterpartyId}
            counterpartyName={counterparty.name}
          />
        }
      />
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
    </div>
  );
}
