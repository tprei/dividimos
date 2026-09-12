"use client";

import { Banknote, Loader2, UsersRound } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatThread } from "@/components/chat/chat-thread";
import {
  GroupRegisterPaymentSheet,
  type GroupPaymentResult,
  type GroupPaymentStatus,
} from "@/components/chat/group-register-payment-sheet";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { debtRowsForGroup } from "@/lib/ledger/debt-rows";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { markRead, recordSettlement, sendMessage } from "@/lib/sync/mutations";
import type { ChatMessage } from "@/types/ledger";
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
  const paymentCounterparties = useMemo(() => {
    const owedByMe = new Map<string, number>();
    const owedToMe = new Map<string, number>();
    for (const row of debtRows) {
      if (row.counterpartyKind !== "user") continue;
      (row.direction === "owes" ? owedByMe : owedToMe).set(row.counterpartyId, row.amountCents);
    }
    return accepted
      .filter((member) => member.userId !== me?.id)
      .map((member) => ({
        id: member.userId,
        name: member.user.name,
        handle: member.user.handle,
        owedByMeCents: owedByMe.get(member.userId) ?? 0,
        owedToMeCents: owedToMe.get(member.userId) ?? 0,
      }));
  }, [accepted, debtRows, me?.id]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<GroupPaymentStatus>("idle");
  const [paymentError, setPaymentError] = useState<string | undefined>(undefined);
  const paymentKey = useRef(crypto.randomUUID());

  const handleRegisterPayment = useCallback(
    async (result: GroupPaymentResult) => {
      if (!me) return;
      setPaymentStatus("confirming");
      setPaymentError(undefined);
      try {
        await recordSettlement({
          operationId: paymentKey.current,
          groupId,
          fromUserId: result.payerIsSelf ? me.id : result.counterpartyId,
          toUserId: result.payerIsSelf ? result.counterpartyId : me.id,
          amountCents: result.amountCents,
          allowOverpay: result.allowOverpay,
        });
        paymentKey.current = crypto.randomUUID();
        setPaymentStatus("confirmed");
        window.setTimeout(() => {
          setPaymentOpen(false);
          setPaymentStatus("idle");
        }, 1200);
      } catch (error) {
        setPaymentStatus("error");
        setPaymentError(ledgerErrorMessage(error));
      }
    },
    [groupId, me],
  );

  useEffect(() => {
    return subscribeChat(groupId);
  }, [groupId]);

  useEffect(() => {
    if (loadedRef.current.has(groupId)) return;
    loadedRef.current.add(groupId);
    loadConversation(groupId).catch((error) => toast.error(ledgerErrorMessage(error)));
  }, [groupId]);

  // The read receipt is a watermark: acknowledge the newest incoming message
  // actually held, never a wall-clock timestamp.
  const lastIncomingMessageId = useMemo(() => {
    if (!me) return null;
    let latest: ChatMessage | null = null;
    for (const message of conversation?.messages ?? []) {
      if (message.senderId === me.id) continue;
      if (
        !latest ||
        message.createdAt > latest.createdAt ||
        (message.createdAt === latest.createdAt && message.id > latest.id)
      ) {
        latest = message;
      }
    }
    return latest?.id ?? null;
  }, [conversation, me]);

  useEffect(() => {
    if (!snapshot || !me || myStatus !== "accepted" || snapshot.unreadCount === 0) return;
    if (!lastIncomingMessageId) return;
    markRead(groupId, lastIncomingMessageId).catch(() => undefined);
  }, [groupId, me, myStatus, snapshot, lastIncomingMessageId]);

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
      {paymentOpen && paymentCounterparties.length > 0 && (
        <div className="px-4 pb-2">
          <GroupRegisterPaymentSheet
            currentUserHandle={me.handle}
            counterparties={paymentCounterparties}
            onConfirm={handleRegisterPayment}
            onDismiss={() => setPaymentOpen(false)}
            status={paymentStatus}
            errorMessage={paymentError}
          />
        </div>
      )}
      {paymentCounterparties.length > 0 && (
        <div className="flex px-4 pb-2">
          <button
            type="button"
            onClick={() => {
              setPaymentStatus("idle");
              setPaymentError(undefined);
              setPaymentOpen((prev) => !prev);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          >
            <Banknote className="h-3.5 w-3.5" />
            Registrar pagamento
          </button>
        </div>
      )}
      <ChatInput onSend={handleSend} />
    </div>
  );
}

export function GroupChatPage() {
  const params = useParams<{ id: string }>();
  return <GroupChatClient groupId={params.id} />;
}
