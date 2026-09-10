"use client";

import { AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ChatAiInput } from "@/components/chat/chat-ai-input";
import { ChatThread } from "@/components/chat/chat-thread";
import { ConversationPayButton } from "@/components/chat/conversation-pay-button";
import { ConversationQuickActions } from "@/components/chat/conversation-quick-actions";
import {
  QuickChargeSheet,
  type QuickChargeStatus,
} from "@/components/chat/quick-charge-sheet";
import {
  QuickSplitSheet,
  type QuickSplitResult,
  type QuickSplitStatus,
} from "@/components/chat/quick-split-sheet";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { debtRowsForGroup } from "@/lib/ledger/debt-rows";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { createExpense, markRead, sendMessage } from "@/lib/sync/mutations";
import {
  acceptInvitation,
  declineInvitation,
  getOrCreateDm,
} from "@/lib/sync/mutations-group";
import { subscribeChat } from "@/lib/sync/realtime";
import { loadConversation } from "@/lib/sync/refresh";
import { findDmGroup } from "@/stores/app-selectors";
import { useAppStore } from "@/stores/app-store";
import type { ExpenseHeader, ExpensePayload, MutationAck, UserProfile } from "@/types/ledger";
import {
  dmExpenseHeader,
  dmExpensePayload,
  resolveDraftExpense,
  wizardUrl,
} from "./conversation-expense-builder";
import { ConversationInviteScreen } from "./conversation-invite-screen";
interface ConversationPageClientProps {
  counterpartyId: string;
}

export function ConversationPageClient({ counterpartyId }: ConversationPageClientProps) {
  const router = useRouter();
  const me = useAppStore((s) => s.me);
  const dm = useAppStore((s) => (me ? findDmGroup(s, me.id, counterpartyId) : null));
  const conversation = useAppStore((s) => (dm ? s.conversations[dm.group.id] : undefined));

  const [resolveError, setResolveError] = useState<string | null>(null);
  const resolving = !dm && !resolveError;
  const [chargeSheetOpen, setChargeSheetOpen] = useState(false);
  const [chargeStatus, setChargeStatus] = useState<QuickChargeStatus>("idle");
  const [chargeError, setChargeError] = useState<string | undefined>();
  const [splitSheetOpen, setSplitSheetOpen] = useState(false);
  const [splitStatus, setSplitStatus] = useState<QuickSplitStatus>("idle");
  const [splitError, setSplitError] = useState<string | undefined>();
  const [historyComplete, setHistoryComplete] = useState(false);
  const chargeResetTimer = useRef<number | undefined>(undefined);
  const splitResetTimer = useRef<number | undefined>(undefined);
  const chargeKey = useRef(crypto.randomUUID());
  const splitKey = useRef(crypto.randomUUID());
  const draftKey = useRef(crypto.randomUUID());
  const requestedRef = useRef(false);
  const loadedRef = useRef<Set<string>>(new Set());

  const groupId = dm?.group.id ?? null;
  const counterpartyMember = dm?.members.find((m) => m.userId === counterpartyId);
  const counterparty: UserProfile | null = counterpartyMember?.user ?? null;
  const myStatus = dm?.members.find((m) => m.userId === me?.id)?.status ?? "invited";
  const isCounterpartyPending = counterpartyMember?.status === "invited";

  const debtRows = useMemo(
    () => (dm && me ? debtRowsForGroup(dm, me.id) : []),
    [dm, me],
  );
  const netCents = debtRows.reduce(
    (sum, row) => sum + (row.direction === "owed" ? row.amountCents : -row.amountCents),
    0,
  );

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of dm?.members ?? []) map.set(member.userId, member.user.name);
    return map;
  }, [dm]);
  const nameOf = useCallback(
    (userId: string) => nameById.get(userId) ?? "Alguém",
    [nameById],
  );

  useEffect(() => {
    if (!me) return;
    if (dm) {
      requestedRef.current = true;
      return;
    }
    if (requestedRef.current) return;
    requestedRef.current = true;
    getOrCreateDm(counterpartyId).catch((error) => {
      requestedRef.current = false;
      setResolveError(ledgerErrorMessage(error));
    });
  }, [me, dm, counterpartyId]);

  useEffect(() => {
    return () => {
      clearTimeout(chargeResetTimer.current);
      clearTimeout(splitResetTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!groupId) return;
    return subscribeChat(groupId);
  }, [groupId]);

  useEffect(() => {
    if (!groupId || loadedRef.current.has(groupId)) return;
    loadedRef.current.add(groupId);
    loadConversation(groupId).catch((error) => toast.error(ledgerErrorMessage(error)));
  }, [groupId]);

  useEffect(() => {
    if (!groupId || !dm || dm.unreadCount === 0) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    markRead(groupId).catch(() => {});
  }, [groupId, dm]);


  const handleRetryResolve = useCallback(() => {
    setResolveError(null);
    requestedRef.current = false;
  }, []);

  const handleLoadMore = useCallback(() => {
    if (!groupId) return;
    const conv = useAppStore.getState().conversations[groupId];
    if (!conv?.oldestCursor) return;
    const cursor = conv.oldestCursor;
    loadConversation(groupId, cursor)
      .then(() => {
        const next = useAppStore.getState().conversations[groupId];
        if (next?.oldestCursor === cursor) setHistoryComplete(true);
      })
      .catch((error) => toast.error(ledgerErrorMessage(error)));
  }, [groupId]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!groupId) return;
      try {
        await sendMessage(groupId, content);
      } catch (error) {
        toast.error(ledgerErrorMessage(error));
        throw error;
      }
    },
    [groupId],
  );

  const handleAccept = useCallback(async () => {
    if (!groupId) return;
    try {
      await acceptInvitation(groupId);
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    }
  }, [groupId]);

  const handleDecline = useCallback(async () => {
    if (!groupId) return;
    try {
      await declineInvitation(groupId);
      router.replace("/app/conversations");
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    }
  }, [groupId, router]);

  const createDmExpense = useCallback(
    async (
      clientId: string,
      header: ExpenseHeader,
      payload: ExpensePayload,
    ): Promise<MutationAck> => {
      if (!groupId) throw new Error("no_group");
      return await createExpense({ groupId, clientId, header, payload });
    },
    [groupId],
  );

  const handleQuickChargeConfirm = useCallback(
    async (result: ChatExpenseResult) => {
      if (!me || !counterparty) return;
      setChargeStatus("confirming");
      setChargeError(undefined);
      const payerIsSelf = !result.payerHandle || result.payerHandle === "SELF";
      const header = dmExpenseHeader(result.title || "Cobrança", result.amountCents, null);
      const payload = dmExpensePayload(
        me,
        counterparty.id,
        payerIsSelf ? [0, result.amountCents] : [result.amountCents, 0],
        payerIsSelf ? 0 : 1,
        result.amountCents,
      );
      try {
        await createDmExpense(chargeKey.current, header, payload);
        setChargeStatus("confirmed");
        chargeKey.current = crypto.randomUUID();
        chargeResetTimer.current = window.setTimeout(() => {
          setChargeSheetOpen(false);
          setChargeStatus("idle");
        }, 1200);
      } catch (error) {
        setChargeStatus("error");
        setChargeError(ledgerErrorMessage(error));
      }
    },
    [me, counterparty, createDmExpense],
  );

  const handleQuickSplitConfirm = useCallback(
    async (result: QuickSplitResult) => {
      if (!me || !counterparty) return;
      setSplitStatus("confirming");
      setSplitError(undefined);
      const myShare =
        result.shares.find((s) => s.userId === me.id)?.shareAmountCents ?? 0;
      const otherShare =
        result.shares.find((s) => s.userId === counterparty.id)?.shareAmountCents ?? 0;
      const header = dmExpenseHeader(result.title, result.amountCents, null);
      const payload = dmExpensePayload(
        me,
        counterparty.id,
        [myShare, otherShare],
        result.payerId === me.id ? 0 : 1,
        result.amountCents,
      );
      try {
        await createDmExpense(splitKey.current, header, payload);
        setSplitStatus("confirmed");
        splitKey.current = crypto.randomUUID();
        splitResetTimer.current = window.setTimeout(() => {
          setSplitSheetOpen(false);
          setSplitStatus("idle");
        }, 1200);
      } catch (error) {
        setSplitStatus("error");
        setSplitError(ledgerErrorMessage(error));
      }
    },
    [me, counterparty, createDmExpense],
  );

  const handleEditDraft = useCallback(
    (result: ChatExpenseResult) => {
      if (!groupId) return;
      router.push(wizardUrl(groupId, result));
    },
    [groupId, router],
  );

  const handleConfirmDraft = useCallback(
    async (
      result: ChatExpenseResult,
    ): Promise<{ expenseId: string } | { error: string }> => {
      if (!groupId || !me || !counterparty) return { error: "Conversa não disponível." };
      const resolution = resolveDraftExpense(groupId, me, counterparty, result);
      if (resolution.kind === "wizard") {
        router.push(resolution.url);
        return { expenseId: "" };
      }
      if (resolution.kind === "error") {
        return { error: resolution.message };
      }
      try {
        const ack = await createDmExpense(draftKey.current, resolution.header, resolution.payload);
        draftKey.current = crypto.randomUUID();
        return { expenseId: ack.expenseId ?? "" };
      } catch (error) {
        return { error: ledgerErrorMessage(error) };
      }
    },
    [groupId, me, counterparty, createDmExpense, router],
  );

  if (!me || (resolving && !dm)) {
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

  if (resolveError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm text-destructive">{resolveError}</p>
        <button onClick={handleRetryResolve} className="text-sm text-primary underline">
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!dm || !counterparty) return null;

  if (myStatus === "invited") {
    return (
      <ConversationInviteScreen
        counterparty={counterparty}
        onAccept={() => void handleAccept()}
        onDecline={() => void handleDecline()}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        back
        title={counterparty.name}
        eyebrow={`@${counterparty.handle}`}
        action={
          !isCounterpartyPending ? (
            <ConversationPayButton
              groupId={dm.group.id}
              meId={me.id}
              counterpartyId={counterpartyId}
              counterpartyName={counterparty.name}
              rows={debtRows}
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
      {netCents !== 0 && (
        <div className="border-b bg-muted/30 px-4 py-1.5 text-center">
          <p
            className={`flex items-center justify-center gap-1 text-xs font-medium ${
              netCents > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {netCents > 0
              ? `${counterparty.name.split(" ")[0]} te deve`
              : "Você deve"}
            <Money cents={netCents} />
          </p>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <ChatThread
          groupId={dm.group.id}
          meId={me.id}
          messages={conversation?.messages ?? []}
          events={conversation?.events ?? []}
          settlements={dm.settlements}
          nameOf={nameOf}
          hasMore={Boolean(conversation?.oldestCursor) && !historyComplete}
          onLoadMore={handleLoadMore}
        />
      </div>
      {!isCounterpartyPending && groupId && (
        <>
          <AnimatePresence>
            {chargeSheetOpen && (
              <div className="px-4 pb-2">
                <QuickChargeSheet
                  counterpartyName={counterparty.name}
                  counterpartyHandle={counterparty.handle}
                  currentUserHandle={me.handle}
                  onConfirm={handleQuickChargeConfirm}
                  onEdit={handleEditDraft}
                  onDismiss={() => setChargeSheetOpen(false)}
                  status={chargeStatus}
                  errorMessage={chargeError}
                />
              </div>
            )}
          </AnimatePresence>
          <QuickSplitSheet
            open={splitSheetOpen}
            onClose={() => setSplitSheetOpen(false)}
            currentUserId={me.id}
            counterparty={counterparty}
            onConfirm={handleQuickSplitConfirm}
            status={splitStatus}
            errorMessage={splitError}
          />
          <ConversationQuickActions
            onCharge={() => {
              setSplitSheetOpen(false);
              setChargeStatus("idle");
              setChargeError(undefined);
              setChargeSheetOpen((prev) => !prev);
            }}
            onSplit={() => {
              setChargeSheetOpen(false);
              setSplitStatus("idle");
              setSplitError(undefined);
              setSplitSheetOpen((prev) => !prev);
            }}
          />
          <ChatAiInput
            groupId={dm.group.id}
            members={[
              { handle: me.handle, name: me.name },
              { handle: counterparty.handle, name: counterparty.name },
            ]}
            onSend={handleSend}
            onConfirmDraft={handleConfirmDraft}
            onEditDraft={handleEditDraft}
          />
        </>
      )}
    </div>
  );
}
