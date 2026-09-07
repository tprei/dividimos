"use client";

import { motion } from "framer-motion";
import { Loader2, Mic, Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { ExpenseSummary, GroupMember } from "@/types/ledger";
import { useShallow } from "zustand/react/shallow";
import toast from "react-hot-toast";
import { VoiceExpenseButton } from "@/components/bill/voice-expense-button";
import { VoiceExpenseModal, type ResolvedParticipant } from "@/components/bill/voice-expense-modal";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/use-auth";
import { formatBRL } from "@/lib/currency";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { loadMoreExpenses } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import { useBillStore } from "@/stores/bill-store";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";

interface GroupExpensesSectionProps {
  groupId: string;
  members: GroupMember[];
}

export function GroupExpensesSection({ groupId, members }: GroupExpensesSectionProps) {
  const router = useRouter();
  const user = useUser();
  const [showVoiceInput, setShowVoiceInput] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceExpenseResult | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const list = useAppStore((s) => s.expenseLists[groupId]);
  const expensesMap = useAppStore((s) => s.expenses);
  const complete = list?.complete ?? true;
  const expenses = useMemo(() => {
    if (!list) return [];
    const summaries: ExpenseSummary[] = [];
    for (const id of list.ids) {
      const summary = expensesMap[id];
      if (summary) summaries.push(summary);
    }
    return summaries;
  }, [list, expensesMap]);

  const billStore = useBillStore(
    useShallow((s) => ({
      setCurrentUser: s.setCurrentUser,
      hydrateFromVoice: s.hydrateFromVoice,
      addParticipant: s.addParticipant,
      addGuest: s.addGuest,
    })),
  );

  const accepted = members.filter((m) => m.status === "accepted");
  const voiceMembers = accepted.map((m) => ({
    handle: m.user.handle,
    name: m.user.name,
  }));
  const modalMembers = accepted.map((m) => ({
    id: m.userId,
    handle: m.user.handle,
    name: m.user.name,
    avatarUrl: m.user.avatarUrl ?? undefined,
  }));

  const activeExpenses = expenses.filter((e) => e.status !== "deleted");

  const handleLoadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      await loadMoreExpenses(groupId);
    } catch (e) {
      toast.error(ledgerErrorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const handleVoiceResult = useCallback((result: VoiceExpenseResult) => {
    setVoiceResult(result);
    setShowVoiceInput(false);
    setVoiceError(null);
  }, []);

  const handleVoiceError = useCallback((message: string) => {
    setVoiceError(message);
  }, []);

  const handleVoiceConfirm = useCallback(
    (result: VoiceExpenseResult, resolvedParticipants: ResolvedParticipant[]) => {
      if (!user) return;
      billStore.setCurrentUser(user);
      billStore.hydrateFromVoice(result, groupId);

      for (const rp of resolvedParticipants) {
        if (rp.type === "member") {
          billStore.addParticipant({
            id: rp.userId,
            email: "",
            handle: rp.handle,
            name: rp.name,
            pixKeyType: "email",
            pixKeyHint: "",
            avatarUrl: rp.avatarUrl,
            onboarded: true,
            createdAt: "",
          });
        } else {
          billStore.addGuest(rp.name);
        }
      }

      setVoiceResult(null);
      setShowVoiceInput(false);
      router.push(`/app/bill/new?groupId=${groupId}&step=payer`);
    },
    [user, billStore, groupId, router],
  );

  const handleVoiceCancel = useCallback(() => {
    setVoiceResult(null);
  }, []);

  return (
    <section>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={() => router.push(`/app/bill/new?groupId=${groupId}`)}
          >
            <Plus className="h-4 w-4" />
            Nova conta
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setShowVoiceInput(!showVoiceInput)}
          >
            <Mic className="h-4 w-4" />
          </Button>
        </div>

        {voiceResult && (
          <VoiceExpenseModal
            result={voiceResult}
            groupMembers={modalMembers}
            onConfirm={handleVoiceConfirm}
            onCancel={handleVoiceCancel}
          />
        )}

        {showVoiceInput && (
          <div className="space-y-2">
            <VoiceExpenseButton
              members={voiceMembers}
              onResult={handleVoiceResult}
              onError={handleVoiceError}
            />
            {voiceError && (
              <p className="text-center text-sm text-destructive">{voiceError}</p>
            )}
          </div>
        )}

        {activeExpenses.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Nenhuma conta ainda"
            description="Adiciona uma conta pra dividir com o grupo. Pode ser um jantar, mercado, ou qualquer gasto compartilhado."
            actionLabel="Nova conta"
            onAction={() => router.push(`/app/bill/new?groupId=${groupId}`)}
          />
        ) : (
          activeExpenses.map((expense) => (
            <Link key={expense.id} href={`/app/bill/${expense.id}`}>
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                  <Receipt className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{expense.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(expense.occurredOn).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-semibold text-sm tabular-nums">
                    {formatBRL(expense.totalCents)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Sua parte {formatBRL(expense.myShareCents)}
                  </span>
                </div>
              </motion.div>
            </Link>
          ))
        )}

        {!complete && activeExpenses.length > 0 && (
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            Carregar mais
          </Button>
        )}
      </div>
    </section>
  );
}
