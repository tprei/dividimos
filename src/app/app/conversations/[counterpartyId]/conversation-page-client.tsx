"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import toast from "react-hot-toast";
import { ConversationHeader } from "@/components/chat/conversation-header";
import { ConversationPayButton } from "@/components/chat/conversation-pay-button";
import { ConversationQuickActions } from "@/components/chat/conversation-quick-actions";
import { QuickChargeSheet, type QuickChargeStatus } from "@/components/chat/quick-charge-sheet";
import { QuickSplitSheet, type QuickSplitStatus, type QuickSplitResult } from "@/components/chat/quick-split-sheet";
import { ChatThread } from "@/components/chat/chat-thread";
import { ChatAiInput } from "@/components/chat/chat-ai-input";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { useRealtimeChat } from "@/hooks/use-realtime-chat";
import {
  loadConversationMessages,
  sendChatMessage,
  type ConversationThread,
} from "@/lib/supabase/chat-actions";
import { confirmChatDraft } from "@/lib/supabase/chat-draft-confirm";
import { notifyDmTextMessage, notifyExpenseActivated } from "@/lib/push/push-notify";
import { markConversationRead } from "@/lib/supabase/unread-actions";
import { createClient } from "@/lib/supabase/client";
import {
  expenseRowToExpense,
  settlementRowToSettlement,
} from "@/lib/supabase/expense-mappers";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import type { MemberContext } from "@/hooks/use-ai-expense-parse";
import type { ChatMessageWithSender, Expense, Settlement, UserProfile } from "@/types";
import type { Database } from "@/types/database";

type DmMemberStatus = "accepted" | "invited" | "declined";

export interface SerializableThread {
  messages: ChatMessageWithSender[];
  expenses: [string, Expense][];
  settlements: [string, Settlement][];
  profiles: [string, UserProfile][];
}

export interface ConversationInitialData {
  counterpartyId: string;
  currentUser: UserProfile;
  groupId: string | null;
  counterparty: UserProfile | null;
  thread: SerializableThread | null;
  hasMore: boolean;
  callerStatus: DmMemberStatus;
  counterpartyStatus: DmMemberStatus;
  error: string | null;
}

function hydrateThread(serialized: SerializableThread): ConversationThread {
  return {
    messages: serialized.messages,
    expenses: new Map(serialized.expenses),
    settlements: new Map(serialized.settlements),
    profiles: new Map(serialized.profiles),
  };
}

const PAGE_SIZE = 50;

export function ConversationPageClient({
  initialData,
}: {
  initialData: ConversationInitialData;
}) {
  const router = useRouter();

  const [counterparty, setCounterparty] = useState<UserProfile | null>(initialData.counterparty);
  const [groupId, setGroupId] = useState<string | null>(initialData.groupId);
  const [thread, setThread] = useState<ConversationThread | null>(
    initialData.thread ? hydrateThread(initialData.thread) : null,
  );
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialData.hasMore);
  const [error, setError] = useState<string | null>(initialData.error);
  const [callerStatus, setCallerStatus] = useState<DmMemberStatus>(initialData.callerStatus);
  const [counterpartyStatus, setCounterpartyStatus] = useState<DmMemberStatus>(initialData.counterpartyStatus);

  const user = initialData.currentUser;
  const counterpartyId = initialData.counterpartyId;

  const refetch = useCallback(async () => {
    if (!groupId) return;

    setLoading(true);
    setError(null);

    const supabase = createClient();

    const [messagesResult, membersResult] = await Promise.all([
      loadConversationMessages(groupId, { limit: PAGE_SIZE }),
      supabase
        .from("group_members")
        .select("user_id, status")
        .eq("group_id", groupId)
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

    markConversationRead(createClient(), user.id, groupId).catch(() => {});

    setLoading(false);
  }, [groupId, user.id, counterpartyId]);

  useEffect(() => {
    const handleRefresh = () => refetch();
    window.addEventListener("app-refresh", handleRefresh);
    return () => window.removeEventListener("app-refresh", handleRefresh);
  }, [refetch]);

  const handleRealtimeMessage = useCallback(async (newMessage: ChatMessageWithSender) => {
    const supabase = createClient();

    let expense: Expense | undefined;
    let settlement: Settlement | undefined;

    if (newMessage.expenseId) {
      const { data } = await supabase
        .from("expenses")
        .select("*")
        .eq("id", newMessage.expenseId)
        .single();
      if (data) {
        expense = expenseRowToExpense(data as Database["public"]["Tables"]["expenses"]["Row"]);
      }
    }

    if (newMessage.settlementId) {
      const { data } = await supabase
        .from("settlements")
        .select("*")
        .eq("id", newMessage.settlementId)
        .single();
      if (data) {
        settlement = settlementRowToSettlement(
          data as Database["public"]["Tables"]["settlements"]["Row"],
        );
      }
    }

    setThread((prev) => {
      if (!prev) return null;
      if (prev.messages.some((m) => m.id === newMessage.id)) return prev;
      const nextExpenses = expense
        ? new Map([...prev.expenses, [expense.id, expense]])
        : prev.expenses;
      const nextSettlements = settlement
        ? new Map([...prev.settlements, [settlement.id, settlement]])
        : prev.settlements;
      return {
        ...prev,
        messages: [...prev.messages, newMessage],
        expenses: nextExpenses,
        settlements: nextSettlements,
      };
    });

    if (groupId) {
      const supabaseForReceipt = createClient();
      await markConversationRead(supabaseForReceipt, user.id, groupId);
      window.dispatchEvent(new CustomEvent("conversations-read"));
    }
  }, [user.id, groupId]);

  useRealtimeChat(groupId ?? undefined, handleRealtimeMessage);

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
      if (!groupId) return;

      const result = await sendChatMessage(groupId, content);
      if ("error" in result) return;

      notifyDmTextMessage(groupId, content).catch(() => {});

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

  const handleConfirmDraft = useCallback(
    async (result: ChatExpenseResult) => {
      if (!groupId || !counterparty) return;

      const members: UserProfile[] = [
        { id: user.id, handle: user.handle, name: user.name, avatarUrl: user.avatarUrl },
        counterparty,
      ];

      const confirmResult = await confirmChatDraft({
        result,
        groupId,
        currentUserId: user.id,
        members,
      });

      if ("error" in confirmResult) {
        toast.error(confirmResult.error);
        return confirmResult;
      }

      notifyExpenseActivated(confirmResult.expenseId).catch(() => {});

      return confirmResult;
    },
    [groupId, user, counterparty],
  );

  const handleEditDraft = useCallback(
    (result: ChatExpenseResult) => {
      if (!groupId) return;
      const params = new URLSearchParams({
        groupId,
        title: result.title,
        amount: String(result.amountCents),
      });
      router.push(`/app/bill/new?${params.toString()}`);
    },
    [groupId, router],
  );

  const aiMembers = useMemo<MemberContext[]>(() => {
    if (!counterparty) return [];
    return [
      { handle: user.handle, name: user.name },
      { handle: counterparty.handle, name: counterparty.name },
    ];
  }, [counterparty, user]);

  // --- Quick-action sheet state ---
  const [chargeSheetOpen, setChargeSheetOpen] = useState(false);
  const [splitSheetOpen, setSplitSheetOpen] = useState(false);
  const [chargeStatus, setChargeStatus] = useState<QuickChargeStatus>("idle");
  const [chargeError, setChargeError] = useState<string | undefined>();
  const [splitStatus, setSplitStatus] = useState<QuickSplitStatus>("idle");
  const [splitError, setSplitError] = useState<string | undefined>();
  const chargeResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splitResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOpenCharge = useCallback(() => {
    setSplitSheetOpen(false);
    setChargeStatus("idle");
    setChargeError(undefined);
    setChargeSheetOpen((prev) => !prev);
  }, []);

  const handleOpenSplit = useCallback(() => {
    setChargeSheetOpen(false);
    setSplitStatus("idle");
    setSplitError(undefined);
    setSplitSheetOpen((prev) => !prev);
  }, []);

  const handleDismissCharge = useCallback(() => {
    setChargeSheetOpen(false);
  }, []);

  const handleDismissSplit = useCallback(() => {
    setSplitSheetOpen(false);
  }, []);

  const handleQuickChargeConfirm = useCallback(
    async (result: ChatExpenseResult) => {
      setChargeStatus("confirming");
      setChargeError(undefined);
      const res = await handleConfirmDraft(result);
      if (res && "error" in res) {
        setChargeStatus("error");
        setChargeError(typeof res.error === "string" ? res.error : "Erro ao cobrar");
        return;
      }
      setChargeStatus("confirmed");
      window.dispatchEvent(new CustomEvent("app-refresh"));
      chargeResetTimer.current = setTimeout(() => {
        setChargeSheetOpen(false);
        setChargeStatus("idle");
      }, 1200);
    },
    [handleConfirmDraft],
  );

  const handleQuickChargeEdit = useCallback(
    (result: ChatExpenseResult) => {
      setChargeSheetOpen(false);
      handleEditDraft(result);
    },
    [handleEditDraft],
  );

  const handleQuickSplitConfirm = useCallback(
    async (result: QuickSplitResult) => {
      if (!groupId || !counterparty) return;
      setSplitStatus("confirming");
      setSplitError(undefined);

      const chatResult: ChatExpenseResult = {
        title: result.title,
        amountCents: result.amountCents,
        expenseType: "single_amount",
        splitType: result.splitType === "equal" ? "equal" : "custom",
        items: [],
        participants: [
          {
            spokenName: counterparty.handle,
            matchedHandle: counterparty.handle,
            confidence: "high",
          },
        ],
        payerHandle: result.payerId === user.id ? "SELF" : counterparty.handle,
        merchantName: null,
        confidence: "high",
      };

      const members: UserProfile[] = [
        { id: user.id, handle: user.handle, name: user.name, avatarUrl: user.avatarUrl },
        counterparty,
      ];

      const confirmResult = await confirmChatDraft({
        result: chatResult,
        groupId,
        currentUserId: user.id,
        members,
        precomputedShares: result.shares,
      });

      if ("error" in confirmResult) {
        setSplitStatus("error");
        setSplitError(confirmResult.error);
        return;
      }

      setSplitStatus("confirmed");
      window.dispatchEvent(new CustomEvent("app-refresh"));
      splitResetTimer.current = setTimeout(() => {
        setSplitSheetOpen(false);
        setSplitStatus("idle");
      }, 1200);
    },
    [groupId, user, counterparty],
  );

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (chargeResetTimer.current) clearTimeout(chargeResetTimer.current);
      if (splitResetTimer.current) clearTimeout(splitResetTimer.current);
    };
  }, []);

  const handleAccept = useCallback(async () => {
    if (!groupId) return;
    await createClient()
      .from("group_members")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .eq("user_id", user.id);
    setCallerStatus("accepted");
  }, [groupId, user.id]);

  const handleDecline = useCallback(async () => {
    if (!groupId) return;
    await createClient()
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", user.id);
    setCallerStatus("declined");
  }, [groupId, user.id]);

  if (loading) {
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

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <button
          onClick={refetch}
          className="text-sm text-primary underline"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!counterparty || !thread) return null;

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
      {!isCounterpartyPending && groupId && (
        <>
          <AnimatePresence>
            {chargeSheetOpen && (
              <div className="px-4 pb-2">
                <QuickChargeSheet
                  counterpartyName={counterparty.name}
                  counterpartyHandle={counterparty.handle}
                  currentUserHandle={user.handle}
                  onConfirm={handleQuickChargeConfirm}
                  onEdit={handleQuickChargeEdit}
                  onDismiss={handleDismissCharge}
                  status={chargeStatus}
                  errorMessage={chargeError}
                />
              </div>
            )}
          </AnimatePresence>
          <QuickSplitSheet
            open={splitSheetOpen}
            onClose={handleDismissSplit}
            currentUserId={user.id}
            counterparty={counterparty}
            onConfirm={handleQuickSplitConfirm}
            status={splitStatus}
            errorMessage={splitError}
          />
          <ConversationQuickActions
            onCharge={handleOpenCharge}
            onSplit={handleOpenSplit}
          />
          <ChatAiInput
            groupId={groupId}
            members={aiMembers}
            onSend={handleSend}
            onConfirmDraft={handleConfirmDraft}
            onEditDraft={handleEditDraft}
          />
        </>
      )}
    </div>
  );
}
