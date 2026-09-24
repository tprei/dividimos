"use client";

import { Loader2, Mic, Plus, Receipt } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { GroupMember } from "@/types/ledger";
import { useShallow } from "zustand/react/shallow";
import toast from "react-hot-toast";
import { VoiceExpenseButton } from "@/components/bill/voice-expense-button";
import { VoiceExpenseModal, type ResolvedParticipant } from "@/components/bill/voice-expense-modal";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/use-auth";
import { Money } from "@/components/shared/money";
import { ListRow } from "@/components/ui/list-row";
import { haptics } from "@/hooks/use-haptics";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { loadMoreExpenses } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import { selectExpenseList } from "@/stores/app-selectors";
import { useBillStore } from "@/stores/bill-store";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import { hasMeaningfulDraft } from "@/lib/bill-draft";
import { DiscardDraftDialog } from "@/components/bill/wizard/discard-draft-dialog";
import { writeDraftIntent } from "@/lib/draft-intent";

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
  const [pendingVoice, setPendingVoice] = useState<{
    result: VoiceExpenseResult;
    resolvedParticipants: ResolvedParticipant[];
  } | null>(null);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [draftSnapshot, setDraftSnapshot] = useState<{
    title: string;
    itemCount: number;
    totalCents: number;
    isItemized: boolean;
  } | null>(null);

  const expenses = useAppStore(useShallow((s) => selectExpenseList(s, groupId)));
  const complete = useAppStore((s) => s.expenseLists[groupId]?.complete ?? true);

  const billStore = useBillStore(
    useShallow((s) => ({
      setCurrentUser: s.setCurrentUser,
      hydrateFromVoice: s.hydrateFromVoice,
      addParticipant: s.addParticipant,
      addGuest: s.addGuest,
    })),
  );

  const { voiceMembers, modalMembers } = useMemo(() => {
    const acceptedMembers = members.filter((m) => m.status === "accepted");
    return {
      voiceMembers: acceptedMembers.map((m) => ({
        handle: m.user.handle,
        name: m.user.name,
      })),
      modalMembers: acceptedMembers.map((m) => ({
        id: m.userId,
        handle: m.user.handle,
        name: m.user.name,
        avatarUrl: m.user.avatarUrl ?? undefined,
      })),
    };
  }, [members]);

  const today = new Date().toLocaleDateString("en-CA");
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toLocaleDateString("en-CA");
  const days = Map.groupBy(
    [...expenses].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)),
    (expense) => expense.occurredOn.slice(0, 10),
  );

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

  const commitVoiceExpense = useCallback(
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

      writeDraftIntent({ kind: "create", draftKey: useBillStore.getState().draftKey });
      setVoiceResult(null);
      setShowVoiceInput(false);
      router.push(`/app/bill/new?groupId=${groupId}&step=payer`);
    },
    [user, billStore, groupId, router],
  );

  const handleVoiceConfirm = useCallback(
    (result: VoiceExpenseResult, resolvedParticipants: ResolvedParticipant[]) => {
      if (!user) return;
      const liveStore = useBillStore.getState();
      if (hasMeaningfulDraft(liveStore, user.id)) {
        setDraftSnapshot({
          title:
            liveStore.expense?.title ||
            (liveStore.expense?.expenseType === "itemized" ? "Nova conta" : "Conta sem título"),
          itemCount: liveStore.items.length,
          totalCents:
            liveStore.expense?.expenseType === "itemized"
              ? liveStore.getGrandTotal()
              : liveStore.totalAmountInput,
          isItemized: liveStore.expense?.expenseType === "itemized",
        });
        setPendingVoice({ result, resolvedParticipants });
        setDiscardDialogOpen(true);
        return;
      }
      commitVoiceExpense(result, resolvedParticipants);
    },
    [user, commitVoiceExpense],
  );

  const handleDiscardVoiceConfirm = useCallback(() => {
    if (!pendingVoice) return;
    commitVoiceExpense(pendingVoice.result, pendingVoice.resolvedParticipants);
    setPendingVoice(null);
    setDiscardDialogOpen(false);
    setDraftSnapshot(null);
  }, [pendingVoice, commitVoiceExpense]);

  const handleDiscardVoiceKeep = useCallback(() => {
    setPendingVoice(null);
    setDiscardDialogOpen(false);
    setDraftSnapshot(null);
  }, []);

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
            onClick={() => { haptics.tap(); router.push(`/app/bill/new?groupId=${groupId}`); }}
          >
            <Plus className="h-4 w-4" />
            Nova conta
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            aria-label="Adicionar conta por voz"
            aria-expanded={showVoiceInput}
            onClick={() => { haptics.selectionChanged(); setShowVoiceInput(!showVoiceInput); }}
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

        <DiscardDraftDialog
          open={discardDialogOpen}
          draftTitle={draftSnapshot?.title ?? "Nova conta"}
          itemCount={draftSnapshot?.itemCount ?? 0}
          totalCents={draftSnapshot?.totalCents ?? 0}
          mode="voice"
          isItemized={draftSnapshot?.isItemized}
          onDiscard={handleDiscardVoiceConfirm}
          onKeep={handleDiscardVoiceKeep}
        />

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

        {expenses.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Nenhuma conta ainda"
            description="Os gastos compartilhados ficam aqui."
          />
        ) : (
          [...days].map(([day, entries]) => (
            <section key={day} aria-label={day} className="space-y-2 pt-3">
              <h3 className="px-1 text-sm font-semibold text-muted-foreground">
                {day === today ? "Hoje" : day === yesterday ? "Ontem" : new Date(`${day}T12:00:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}
              </h3>
              <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                {entries.map((expense) => (
                  <ListRow
                    key={expense.id}
                    href={`/app/bill/${expense.id}`}
                    title={expense.title}
                    subtitle={expense.status === "deleted" ? "Conta excluída" : expense.myPaidCents > 0 ? "Você pagou" : undefined}
                    className={expense.status === "deleted" ? "text-muted-foreground" : undefined}
                    trailing={
                      <span className="flex flex-col items-end gap-1">
                        <Money cents={expense.totalCents} className="text-base" />
                        {expense.myShareCents > 0 && expense.status !== "deleted" && (
                          <span className="text-xs text-muted-foreground">sua parte <Money cents={expense.myShareCents} className="text-xs" /></span>
                        )}
                      </span>
                    }
                  />
                ))}
              </div>
            </section>
          ))
        )}

        {!complete && expenses.length > 0 && (
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
