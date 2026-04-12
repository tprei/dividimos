"use client";

import { ArrowLeft, MessageSquare } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import { ChatAiInput } from "@/components/chat/chat-ai-input";
import {
  ChatDateSeparator,
  shouldShowDateSeparator,
} from "@/components/chat/chat-date-separator";
import { UserAvatar } from "@/components/shared/user-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/shared/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeChat } from "@/hooks/use-realtime-chat";
import { useRealtimeBalances } from "@/hooks/use-realtime-balances";
import { loadThreadMessages, loadDmGroupInfo } from "@/lib/supabase/chat-actions";
import { queryBalanceBetween } from "@/lib/supabase/settlement-actions";
import { formatBRL } from "@/lib/currency";
import type {
  Balance,
  ChatMessageWithSender,
  Expense,
  Settlement,
  UserProfile,
} from "@/types";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

export default function ConversationThreadPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  useAuth();
  const router = useRouter();

  const [counterparty, setCounterparty] = useState<UserProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessageWithSender[]>([]);
  const [expenses, setExpenses] = useState<Map<string, Expense>>(new Map());
  const [settlements, setSettlements] = useState<
    Map<string, { settlement: Settlement; fromUser: UserProfile; toUser: UserProfile }>
  >(new Map());
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [groupInfo, thread] = await Promise.all([
        loadDmGroupInfo(groupId),
        loadThreadMessages(groupId),
      ]);

      setCounterparty(groupInfo.counterparty);
      setCurrentUserId(groupInfo.currentUserId);
      setMessages(thread.messages);
      setExpenses(thread.expenses);
      setSettlements(thread.settlements);

      if (groupInfo.currentUserId && groupInfo.counterparty) {
        const bal = await queryBalanceBetween(
          groupId,
          groupInfo.currentUserId,
          groupInfo.counterparty.id,
        );
        setBalance(bal);
      }
    } catch {
      // Error loading data - show empty state
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!loading && messages.length > 0) {
      scrollToBottom();
    }
  }, [loading, messages.length, scrollToBottom]);

  useRealtimeChat(groupId, (newMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === newMessage.id)) return prev;
      return [...prev, newMessage];
    });
  });

  useRealtimeBalances(groupId, (updatedBalance) => {
    setBalance(updatedBalance);
  });

  useEffect(() => {
    const handler = () => {
      loadData();
    };
    window.addEventListener("app-refresh", handler);
    return () => window.removeEventListener("app-refresh", handler);
  }, [loadData]);

  const handleConfirmDraft = useCallback(
    (result: ChatExpenseResult) => {
      const qs = new URLSearchParams({ groupId });
      if (result.title) qs.set("title", result.title);
      if (result.amountCents > 0) qs.set("amount", String(result.amountCents));
      router.push(`/app/bill/new?${qs.toString()}`);
    },
    [groupId, router],
  );

  const handleEditDraft = useCallback(() => {
    router.push(`/app/bill/new?groupId=${groupId}`);
  }, [groupId, router]);

  const aiMembers = counterparty
    ? [{ handle: counterparty.handle, name: counterparty.name }]
    : [];

  const balanceDisplay = getBalanceDisplay(balance, currentUserId, counterparty);

  if (loading) {
    return <ThreadSkeleton />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link
            href="/app/conversations"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          {counterparty && (
            <>
              <UserAvatar
                name={counterparty.name}
                avatarUrl={counterparty.avatarUrl}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {counterparty.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  @{counterparty.handle}
                </p>
              </div>
            </>
          )}
          {balanceDisplay && (
            <div className="shrink-0 text-right">
              <p
                className={`text-sm font-semibold tabular-nums ${balanceDisplay.color}`}
              >
                {balanceDisplay.label}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {balanceDisplay.description}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="Nenhuma atividade"
            description="Crie uma conta entre vocês para começar a conversa"
          />
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.02 } },
            }}
            className="space-y-1"
          >
            {messages.map((message, index) => {
              const prevMessage = index > 0 ? messages[index - 1] : undefined;
              const showDate = shouldShowDateSeparator(
                message.createdAt,
                prevMessage?.createdAt,
              );
              const showAvatar =
                !prevMessage || prevMessage.senderId !== message.senderId;

              return (
                <div key={message.id}>
                  {showDate && (
                    <ChatDateSeparator date={message.createdAt} />
                  )}
                  <ChatMessageBubble
                    message={message}
                    isOwn={message.senderId === currentUserId}
                    expenses={expenses}
                    settlements={settlements}
                    showAvatar={showAvatar}
                  />
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </motion.div>
        )}
      </div>

      <div className="border-t bg-background px-3 py-2">
        <ChatAiInput
          groupId={groupId}
          members={aiMembers}
          onConfirmDraft={handleConfirmDraft}
          onEditDraft={handleEditDraft}
        />
      </div>
    </div>
  );
}

// --- Helpers ---

interface BalanceDisplayInfo {
  label: string;
  description: string;
  color: string;
}

function getBalanceDisplay(
  balance: Balance | null,
  currentUserId: string | null,
  counterparty: UserProfile | null,
): BalanceDisplayInfo | null {
  if (!balance || !currentUserId || !counterparty || balance.amountCents === 0)
    return null;

  const currentIsA = currentUserId === balance.userA;
  const iOwe = currentIsA
    ? balance.amountCents > 0
    : balance.amountCents < 0;
  const absAmount = Math.abs(balance.amountCents);

  if (iOwe) {
    return {
      label: formatBRL(absAmount),
      description: "você deve",
      color: "text-destructive",
    };
  }

  return {
    label: formatBRL(absAmount),
    description: "te devem",
    color: "text-success",
  };
}

function ThreadSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-3 p-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}
          >
            <Skeleton
              className={`h-10 rounded-2xl ${i % 3 === 0 ? "w-48" : "w-36"}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
