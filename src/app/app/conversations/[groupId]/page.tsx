"use client";

import { ArrowLeft, MessageSquare, Plus, QrCode } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import {
  ChatDateSeparator,
  shouldShowDateSeparator,
} from "@/components/chat/chat-date-separator";
import { UserAvatar } from "@/components/shared/user-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeChat } from "@/hooks/use-realtime-chat";
import { useRealtimeBalances } from "@/hooks/use-realtime-balances";
import { loadThreadMessages, loadDmGroupInfo } from "@/lib/supabase/chat-actions";
import { queryBalanceBetween, recordSettlement } from "@/lib/supabase/settlement-actions";
import { formatBRL } from "@/lib/currency";
import type {
  Balance,
  ChatMessageWithSender,
  Expense,
  Settlement,
  UserProfile,
} from "@/types";

const PixQrModal = dynamic(
  () => import("@/components/settlement/pix-qr-modal").then((m) => ({ default: m.PixQrModal })),
  { ssr: false },
);

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
  const [pixModalOpen, setPixModalOpen] = useState(false);
  const [acting, setActing] = useState(false);

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

      // Load balance between users
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

  // Scroll to bottom when messages load or new message arrives
  useEffect(() => {
    if (!loading && messages.length > 0) {
      scrollToBottom();
    }
  }, [loading, messages.length, scrollToBottom]);

  // Realtime: new chat messages
  useRealtimeChat(groupId, (newMessage) => {
    setMessages((prev) => {
      // Deduplicate
      if (prev.some((m) => m.id === newMessage.id)) return prev;
      return [...prev, newMessage];
    });
  });

  // Realtime: balance updates
  useRealtimeBalances(groupId, (updatedBalance) => {
    setBalance(updatedBalance);
  });

  // Listen for app-refresh events (pull-to-refresh)
  useEffect(() => {
    const handler = () => {
      loadData();
    };
    window.addEventListener("app-refresh", handler);
    return () => window.removeEventListener("app-refresh", handler);
  }, [loadData]);

  const balanceDisplay = getBalanceDisplay(balance, currentUserId, counterparty);

  const iOwe = balanceDisplay?.description === "você deve";
  const amountOwed = balance ? Math.abs(balance.amountCents) : 0;

  const handleMarkPaid = useCallback(async (amountCents: number) => {
    if (!currentUserId || !counterparty) return;
    setActing(true);
    try {
      await recordSettlement(groupId, currentUserId, counterparty.id, amountCents);
      const refreshed = await queryBalanceBetween(groupId, currentUserId, counterparty.id);
      setBalance(refreshed);
    } finally {
      setActing(false);
      setPixModalOpen(false);
    }
  }, [groupId, currentUserId, counterparty]);

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
        className="flex-1 overflow-y-auto px-4 pb-3 pt-3"
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

      {/* Action bar */}
      <div className="sticky bottom-0 z-10 border-t bg-background/95 backdrop-blur-sm px-4 py-2 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 gap-1.5"
          onClick={() => router.push(`/app/bill/new?groupId=${groupId}`)}
        >
          <Plus className="h-4 w-4" />
          Nova conta
        </Button>
        {iOwe && amountOwed > 0 && (
          <Button
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => setPixModalOpen(true)}
            disabled={acting}
          >
            <QrCode className="h-4 w-4" />
            Pagar via Pix
          </Button>
        )}
      </div>

      {counterparty && pixModalOpen && (
        <PixQrModal
          open={pixModalOpen}
          onClose={() => setPixModalOpen(false)}
          recipientName={counterparty.name}
          amountCents={amountOwed}
          recipientUserId={counterparty.id}
          groupId={groupId}
          mode="pay"
          onMarkPaid={handleMarkPaid}
        />
      )}
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

  // Positive = userA owes userB; negative = userB owes userA
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
