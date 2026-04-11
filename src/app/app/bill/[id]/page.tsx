"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Bell,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Pencil,
  QrCode,
  Receipt,
  UserCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PayerSummaryCard } from "@/components/bill/payer-summary-card";
import { AnimatedCheckmark } from "@/components/shared/animated-checkmark";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/shared/skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { GuestClaimShareModal } from "@/components/bill/guest-claim-share-modal";
import dynamic from "next/dynamic";
const PixQrModal = dynamic(
  () => import("@/components/settlement/pix-qr-modal").then((m) => ({ default: m.PixQrModal })),
  { ssr: false },
);
import { DebtGraph } from "@/components/settlement/debt-graph";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { loadExpense } from "@/lib/supabase/expense-actions";
import { activateExpense } from "@/lib/supabase/expense-rpc";
import { useBillStore } from "@/stores/bill-store";
import { useAuth } from "@/hooks/use-auth";
import { haptics } from "@/hooks/use-haptics";
import { useRealtimeExpense } from "@/hooks/use-realtime-expense";
import toast from "react-hot-toast";
import { notifyExpenseActivated } from "@/lib/push/push-notify";
import type {
  DebtEdge,
  Expense,
  ExpenseItem,
  ExpenseStatus,
  ExpenseWithDetails,
  UserProfile,
} from "@/types";

const expenseStatusConfig: Record<ExpenseStatus, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  active: { label: "Ativo", color: "bg-warning/15 text-warning-foreground" },
  settled: { label: "Quitada", color: "bg-success/15 text-success" },
};

/** Compute debt edges from shares and payers (net-balance algorithm). */
function computeDebtsFromExpense(
  shares: { userId: string; shareAmountCents: number }[],
  payers: { userId: string; amountCents: number }[],
): DebtEdge[] {
  const netBalance = new Map<string, number>();

  for (const s of shares) {
    netBalance.set(s.userId, (netBalance.get(s.userId) || 0) - s.shareAmountCents);
  }
  for (const p of payers) {
    netBalance.set(p.userId, (netBalance.get(p.userId) || 0) + p.amountCents);
  }

  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];

  for (const [id, balance] of netBalance) {
    if (balance < -1) debtors.push({ id, amount: Math.abs(balance) });
    if (balance > 1) creditors.push({ id, amount: balance });
  }

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const debts: DebtEdge[] = [];
  let di = 0;
  let ci = 0;

  while (di < debtors.length && ci < creditors.length) {
    const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
    if (transfer <= 0) break;
    debts.push({
      fromUserId: debtors[di].id,
      toUserId: creditors[ci].id,
      amountCents: transfer,
    });
    debtors[di].amount -= transfer;
    creditors[ci].amount -= transfer;
    if (debtors[di].amount <= 1) di++;
    if (creditors[ci].amount <= 1) ci++;
  }

  return debts;
}

function CreatorDraftView({
  expense,
  participants,
  items,
  shares,
  guests,
}: {
  expense: Expense;
  participants: UserProfile[];
  items: ExpenseItem[];
  shares: { userId: string; shareAmountCents: number }[];
  guests: { id: string; displayName: string; claimToken: string; share?: { shareAmountCents: number } }[];
}) {
  const [finalizing, setFinalizing] = useState(false);
  const [guestShareModal, setGuestShareModal] = useState<{
    open: boolean;
    guestName: string;
    shareAmountCents?: number;
    claimToken: string;
  }>({ open: false, guestName: "", claimToken: "" });

  const hasContent = shares.length > 0 || items.length > 0;

  const handleFinalize = async () => {
    setFinalizing(true);
    const result = await activateExpense({ expense_id: expense.id });
    if ("error" in result) {
      haptics.error();
      toast.error(result.error);
      setFinalizing(false);
      return;
    }
    haptics.success();
    notifyExpenseActivated(expense.id).catch(() => {});
    // Reload from DB to get authoritative state
    const fresh = await loadExpense(expense.id);
    if (fresh) {
      useBillStore.setState({
        expense: {
          id: fresh.id,
          groupId: fresh.groupId,
          creatorId: fresh.creatorId,
          title: fresh.title,
          merchantName: fresh.merchantName,
          expenseType: fresh.expenseType,
          totalAmount: fresh.totalAmount,
          serviceFeePercent: fresh.serviceFeePercent,
          fixedFees: fresh.fixedFees,
          status: fresh.status,
          createdAt: fresh.createdAt,
          updatedAt: fresh.updatedAt,
        },
      });
    }
    setFinalizing(false);
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/app"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="font-semibold">{expense.title}</h1>
          {expense.merchantName && (
            <p className="text-xs text-muted-foreground">{expense.merchantName}</p>
          )}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${expenseStatusConfig.draft.color}`}>
          {expenseStatusConfig.draft.label}
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mt-6"
      >
        <div className="rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
          <p className="text-sm text-white/70">Total da despesa</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {formatBRL(expense.totalAmount)}
          </p>
          <div className="mt-2 flex gap-4 text-sm text-white/70">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {participants.length} pessoas
            </span>
          </div>
        </div>
      </motion.div>

      {participants.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="mt-5"
        >
          <h2 className="mb-3 text-sm font-semibold">Participantes</h2>
          <div className="space-y-2">
            {participants.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
              >
                <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                <span className="flex-1 text-sm font-medium">{p.name}</span>
                {p.id === expense.creatorId && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Criador
                  </span>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {guests.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4 }}
          className="mt-5"
        >
          <h2 className="mb-3 text-sm font-semibold">Convidados</h2>
          <div className="space-y-2">
            {guests.map((guest) => (
              <div
                key={guest.id}
                className="flex items-center justify-between rounded-xl border border-dashed bg-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                    {guest.displayName.charAt(0)}
                  </span>
                  <span className="text-sm font-medium">{guest.displayName}</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs"
                  onClick={() =>
                    setGuestShareModal({
                      open: true,
                      guestName: guest.displayName,
                      shareAmountCents: guest.share?.shareAmountCents,
                      claimToken: guest.claimToken,
                    })
                  }
                >
                  <QrCode className="h-3.5 w-3.5" />
                  Convidar
                </Button>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className="mt-6 space-y-3"
      >
        {hasContent && (
          <Button
            onClick={handleFinalize}
            disabled={finalizing}
            className="w-full gap-2"
          >
            {finalizing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Finalizar despesa
          </Button>
        )}
        <Link href={`/app/bill/new?draft=${expense.id}`}>
          <Button variant="outline" className="w-full gap-2">
            <Pencil className="h-4 w-4" />
            Editar rascunho
          </Button>
        </Link>
      </motion.div>

      <GuestClaimShareModal
        open={guestShareModal.open}
        onClose={() => setGuestShareModal({ ...guestShareModal, open: false })}
        guestName={guestShareModal.guestName}
        shareAmountCents={guestShareModal.shareAmountCents}
        claimToken={guestShareModal.claimToken}
        expenseTitle={expense.title}
      />
    </div>
  );
}

export default function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<"items" | "split" | "payment">("payment");
  const [pixModal, setPixModal] = useState<{
    open: boolean;
    recipientUserId: string;
    name: string;
    amount: number;
    mode: "pay" | "collect";
  }>({
    open: false,
    recipientUserId: "",
    name: "",
    amount: 0,
    mode: "pay",
  });

  const [guestShareModal, setGuestShareModal] = useState<{
    open: boolean;
    guestName: string;
    shareAmountCents?: number;
    claimToken: string;
  }>({ open: false, guestName: "", claimToken: "" });

  const [expenseData, setExpenseData] = useState<ExpenseWithDetails | null>(null);
  const [loadingFromDb, setLoadingFromDb] = useState(false);
  const loadedKeyRef = useRef<string | null>(null);

  const loadExpenseData = useCallback(async (expenseId: string) => {
    const data = await loadExpense(expenseId);
    if (data) {
      setExpenseData(data);
      // Also update the store so draft editing works
      useBillStore.setState({
        expense: {
          id: data.id,
          groupId: data.groupId,
          creatorId: data.creatorId,
          title: data.title,
          merchantName: data.merchantName,
          expenseType: data.expenseType,
          totalAmount: data.totalAmount,
          serviceFeePercent: data.serviceFeePercent,
          fixedFees: data.fixedFees,
          status: data.status,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        },
        items: data.items,
      });
    }
    return data;
  }, []);

  const currentUserId = currentUser?.id;

  useEffect(() => {
    if (id === "demo") return;
    const cacheKey = `${currentUserId ?? "anon"}:${id}`;
    if (loadedKeyRef.current === cacheKey) {
      setLoadingFromDb(false);
      return;
    }

    loadedKeyRef.current = cacheKey;
    let cancelled = false;
    setLoadingFromDb(true);
    (async () => {
      await loadExpenseData(id);
      if (!cancelled) {
        setLoadingFromDb(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, currentUserId, loadExpenseData]);

  // Realtime: subscribe to expense status changes
  const onExpenseUpdate = useCallback(
    (updated: { id: string; status: ExpenseStatus; updatedAt: string }) => {
      setExpenseData((prev) => {
        if (!prev || prev.id !== updated.id) return prev;
        return { ...prev, status: updated.status, updatedAt: updated.updatedAt };
      });
      useBillStore.setState((state) => ({
        expense: state.expense
          ? { ...state.expense, status: updated.status, updatedAt: updated.updatedAt }
          : null,
      }));
      // If activated, reload to get full data
      if (updated.status === "active") {
        loadExpenseData(updated.id);
      }
    },
    [loadExpenseData],
  );

  useRealtimeExpense(expenseData?.id, onExpenseUpdate);

  const expense = expenseData;
  // Unique participants from shares + payers
  const allParticipants = useMemo(() => {
    if (!expense) return [];
    const map = new Map<string, UserProfile>();
    for (const s of expense.shares) map.set(s.user.id, s.user);
    for (const p of expense.payers) map.set(p.user.id, p.user);
    return Array.from(map.values());
  }, [expense]);

  const debts = useMemo(() => {
    if (!expense || expense.status === "draft") return [];
    return computeDebtsFromExpense(expense.shares, expense.payers);
  }, [expense]);

  const unclaimedGuests = useMemo(
    () => (expense?.guests ?? []).filter((g) => !g.claimedBy),
    [expense],
  );

  // Auto-close the guest share modal when the open guest's token is claimed
  const prevUnclaimedTokensRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentTokens = new Set(unclaimedGuests.map((g) => g.claimToken));

    if (guestShareModal.open && guestShareModal.claimToken) {
      if (
        prevUnclaimedTokensRef.current.has(guestShareModal.claimToken) &&
        !currentTokens.has(guestShareModal.claimToken)
      ) {
        toast.success("Convidado entrou na conta!");
        setGuestShareModal((prev) => ({ ...prev, open: false }));
      }
    }

    prevUnclaimedTokensRef.current = currentTokens;
  }, [unclaimedGuests, guestShareModal.open, guestShareModal.claimToken]);

  if (loadingFromDb) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  if (!expense) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/app"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-semibold">Despesa</h1>
        </div>
        <EmptyState
          icon={Receipt}
          title="Conta não encontrada"
          description="Cria uma conta pra rachar com a galera."
          actionLabel="Nova conta"
          onAction={() => router.push("/app/bill/new")}
        />
      </div>
    );
  }

  // Draft view for non-creator: show waiting message
  if (expense.status === "draft" && currentUser?.id !== expense.creatorId) {
    const creator = allParticipants.find((p) => p.id === expense.creatorId);
    const creatorFirstName = creator?.name.split(" ")[0] ?? "criador";

    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/app"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <h1 className="font-semibold">{expense.title}</h1>
            {expense.merchantName && (
              <p className="text-xs text-muted-foreground">{expense.merchantName}</p>
            )}
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${expenseStatusConfig.draft.color}`}>
            {expenseStatusConfig.draft.label}
          </span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="mt-6"
        >
          <div className="rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
            <p className="text-sm text-white/70">Total da despesa</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">
              {formatBRL(expense.totalAmount)}
            </p>
            <div className="mt-2 flex gap-4 text-sm text-white/70">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {allParticipants.length} pessoas
              </span>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="mt-5 flex flex-col items-center rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-8"
        >
          <Clock className="h-6 w-6 text-muted-foreground" />
          <p className="mt-4 text-sm font-medium text-foreground">
            Aguardando {creatorFirstName} finalizar a despesa
          </p>
          <p className="mt-1 text-xs text-muted-foreground text-center">
            Voce sera notificado assim que a despesa estiver pronta.
          </p>
        </motion.div>

        {allParticipants.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="mt-5"
          >
            <h2 className="mb-3 text-sm font-semibold">Participantes</h2>
            <div className="space-y-2">
              {allParticipants.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
                >
                  <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                  <span className="text-sm font-medium">{p.name}</span>
                  {p.id === expense.creatorId && (
                    <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      criador
                    </span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  // Draft view for creator
  if (expense.status === "draft" && currentUser?.id === expense.creatorId) {
    return (
      <CreatorDraftView
        expense={expense}
        participants={allParticipants}
        items={expense.items}
        shares={expense.shares}
        guests={expense.guests ?? []}
      />
    );
  }

  // Active / settled view
  const statusConfig = expenseStatusConfig[expense.status];
  const allSettled = expense.status === "settled";

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/app"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="font-semibold">{expense.title}</h1>
          {expense.merchantName && (
            <p className="text-xs text-muted-foreground">{expense.merchantName}</p>
          )}
          {expense.groupId && (
            <Link
              href={`/app/groups/${expense.groupId}`}
              className="flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
            >
              <Users className="h-3 w-3" />
              Ver grupo
            </Link>
          )}
        </div>
        <motion.span
          key={expense.status}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusConfig.color}`}
        >
          {statusConfig.label}
        </motion.span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mt-6"
      >
        <div className="rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
          <p className="text-sm text-white/70">Total da despesa</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {formatBRL(expense.totalAmount)}
          </p>
          <div className="mt-2 flex gap-4 text-sm text-white/70">
            <span className="flex items-center gap-1">
              <Receipt className="h-3.5 w-3.5" />
              {expense.items.length} itens
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {allParticipants.length + unclaimedGuests.length} pessoas
            </span>
            {debts.length > 0 && (
              <span className="flex items-center gap-1">
                <Check className="h-3.5 w-3.5" />
                {debts.length} cobrança{debts.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </motion.div>

      {currentUser?.id === expense.creatorId && unclaimedGuests.length > 0 && (
        <div className="mt-4 rounded-2xl border-2 border-dashed border-warning/30 bg-warning/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-warning">
            <Users className="h-4 w-4" />
            {unclaimedGuests.length} convidado{unclaimedGuests.length > 1 ? "s" : ""} pendente{unclaimedGuests.length > 1 ? "s" : ""}
          </div>
          <div className="mt-3 space-y-2">
            {unclaimedGuests.map((guest) => (
              <div key={guest.id} className="flex items-center justify-between">
                <span className="text-sm">{guest.displayName}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs"
                  onClick={() =>
                    setGuestShareModal({
                      open: true,
                      guestName: guest.displayName,
                      shareAmountCents: guest.share?.shareAmountCents,
                      claimToken: guest.claimToken,
                    })
                  }
                >
                  <QrCode className="h-3.5 w-3.5" />
                  Compartilhar
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex rounded-xl bg-muted/50 p-1">
        {(
          [
            { key: "items", label: "Itens" },
            { key: "split", label: "Divisão" },
            { key: "payment", label: "Pagamento" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-lg py-2 text-xs font-medium transition-all ${
              activeTab === tab.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.key === "payment" && debts.length > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-bold text-primary">
                {allSettled ? "\u2713" : debts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "items" && (
        <motion.div
          key="items-tab"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-5 space-y-2"
        >
          {expense.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-xl border bg-card px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{item.description}</p>
                <p className="text-xs text-muted-foreground">
                  {item.quantity > 1 ? `${item.quantity}x ` : ""}
                  {formatBRL(item.unitPriceCents)}/un
                </p>
              </div>
              <span className="font-semibold tabular-nums text-sm">
                {formatBRL(item.totalPriceCents)}
              </span>
            </div>
          ))}
          {expense.items.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum item nesta despesa.
            </p>
          )}
        </motion.div>
      )}

      {activeTab === "split" && (
        <motion.div
          key="split-tab"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="mt-5"
        >
          <ExpenseSharesSummary expense={expense} allParticipants={allParticipants} />
          {expense.guests && expense.guests.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Convidados</h3>
              <div className="space-y-2">
                {expense.guests.map((guest) => {
                  const isClaimed = !!guest.claimedBy;
                  return (
                    <div
                      key={guest.id}
                      className="rounded-xl border border-dashed bg-card p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                            {guest.displayName.charAt(0)}
                          </span>
                          <div>
                            <p className="text-sm font-medium">{guest.displayName}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isClaimed ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                              {isClaimed ? "Confirmado" : "Pendente"}
                            </span>
                          </div>
                        </div>
                        <span className="font-semibold tabular-nums text-sm">
                          {guest.share ? formatBRL(guest.share.shareAmountCents) : "—"}
                        </span>
                      </div>
                      {!isClaimed && currentUser?.id === expense.creatorId && (
                        <div className="mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full gap-1.5 text-xs"
                            onClick={() =>
                              setGuestShareModal({
                                open: true,
                                guestName: guest.displayName,
                                shareAmountCents: guest.share?.shareAmountCents,
                                claimToken: guest.claimToken,
                              })
                            }
                          >
                            <QrCode className="h-3.5 w-3.5" />
                            Compartilhar convite
                          </Button>
                        </div>
                      )}
                      {isClaimed && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <UserCheck className="h-3 w-3" />
                          Confirmado
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {activeTab === "payment" && allSettled && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="mt-5 flex flex-col items-center rounded-2xl border-2 border-dashed border-success/30 bg-success/5 p-8"
        >
          <AnimatedCheckmark size={64} />
          <h3 className="mt-4 text-lg font-bold">Tudo quitado!</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Todos os pagamentos foram confirmados.
          </p>
          {expense.groupId && (
            <Link
              href={`/app/groups/${expense.groupId}`}
              className="mt-3 text-sm text-primary hover:underline"
            >
              Ver acerto do grupo
            </Link>
          )}
        </motion.div>
      )}

      {activeTab === "payment" && !allSettled && expense.groupId && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-5 space-y-4"
        >
          <Link
            href={`/app/groups/${expense.groupId}`}
            className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 hover:bg-primary/10 transition-colors"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">Ir para acerto do grupo</p>
              <p className="text-xs text-muted-foreground">
                Quitar dívidas consolidadas de todas as contas do grupo
              </p>
            </div>
          </Link>

          <div>
            <h2 className="mb-3 text-sm font-semibold">Cobranças desta conta</h2>
            <div className="space-y-3">
              {debts.map((debt, idx) => {
                const debtor = allParticipants.find((p) => p.id === debt.fromUserId);
                const creditor = allParticipants.find((p) => p.id === debt.toUserId);
                const isDebtor = currentUser?.id === debt.fromUserId;
                const isCreditor = currentUser?.id === debt.toUserId;

                const entryLabel = isDebtor
                  ? `Você deve para ${creditor?.name.split(" ")[0] || "?"}`
                  : isCreditor
                    ? `${debtor?.name.split(" ")[0] || "?"} te deve`
                    : `${debtor?.name.split(" ")[0] || "?"} \u2192 ${creditor?.name.split(" ")[0] || "?"}`;

                return (
                  <motion.div
                    key={`${debt.fromUserId}-${debt.toUserId}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.06 }}
                    className="overflow-hidden rounded-2xl border bg-card"
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            name={(isDebtor ? creditor?.name : debtor?.name) || "?"}
                            avatarUrl={isDebtor ? creditor?.avatarUrl : debtor?.avatarUrl}
                            size="sm"
                          />
                          <p className="text-sm font-medium">{entryLabel}</p>
                        </div>
                        <p className="text-lg font-bold tabular-nums">
                          {formatBRL(debt.amountCents)}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Cada membro pode ver e quitar suas dívidas na página do grupo
            </p>
          </div>
        </motion.div>
      )}

      {activeTab === "payment" && !allSettled && !expense.groupId && debts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="mt-5"
        >
          <div className="mb-4">
            <ExpenseChargeExplanation
              expense={expense}
              allParticipants={allParticipants}
              debts={debts}
              currentUserId={currentUser?.id}
            />
          </div>

          {expense.payers.length > 0 && (
            <div className="mb-4">
              <PayerSummaryCard
                payers={expense.payers.map((p) => ({ userId: p.userId, amountCents: p.amountCents }))}
                participants={allParticipants}
              />
            </div>
          )}

          <h2 className="mb-3 text-sm font-semibold">Cobranças</h2>
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {debts.map((debt, idx) => {
                const debtor = allParticipants.find((p) => p.id === debt.fromUserId);
                const creditor = allParticipants.find((p) => p.id === debt.toUserId);
                const isDebtor = currentUser?.id === debt.fromUserId;
                const isCreditor = currentUser?.id === debt.toUserId;

                const entryLabel = isDebtor
                  ? `Você deve para ${creditor?.name.split(" ")[0] || "?"}`
                  : isCreditor
                    ? `${debtor?.name.split(" ")[0] || "?"} te deve`
                    : `${debtor?.name.split(" ")[0] || "?"} \u2192 ${creditor?.name.split(" ")[0] || "?"}`;

                return (
                  <motion.div
                    key={`${debt.fromUserId}-${debt.toUserId}`}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.06 }}
                    className="overflow-hidden rounded-2xl border bg-card"
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            name={(isDebtor ? creditor?.name : debtor?.name) || "?"}
                            avatarUrl={isDebtor ? creditor?.avatarUrl : debtor?.avatarUrl}
                            size="sm"
                          />
                          <p className="text-sm font-medium">{entryLabel}</p>
                        </div>
                        <p className="text-lg font-bold tabular-nums">
                          {formatBRL(debt.amountCents)}
                        </p>
                      </div>

                      {isDebtor && (
                        <div className="mt-3">
                          <Button
                            size="sm"
                            className="w-full gap-1.5 bg-success text-success-foreground hover:bg-success/90"
                            onClick={() =>
                              setPixModal({
                                open: true,
                                recipientUserId: creditor?.id || "",
                                name: creditor?.name || "",
                                amount: debt.amountCents,
                                mode: "pay",
                              })
                            }
                          >
                            <QrCode className="h-4 w-4" />
                            Pagar {formatBRL(debt.amountCents)} para {creditor?.name.split(" ")[0]}
                          </Button>
                        </div>
                      )}

                      {isCreditor && (
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 gap-1.5"
                            onClick={() =>
                              setPixModal({
                                open: true,
                                recipientUserId: currentUser?.id || "",
                                name: debtor?.name || "",
                                amount: debt.amountCents,
                                mode: "collect",
                              })
                            }
                          >
                            <QrCode className="h-4 w-4" />
                            Cobrar via Pix
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-muted-foreground"
                          >
                            <Bell className="h-3.5 w-3.5" />
                            Lembrar
                          </Button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </motion.div>
      )}

      {activeTab === "payment" && debts.length === 0 && !allSettled && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-5"
        >
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma cobrança nesta conta.
          </p>
        </motion.div>
      )}

      <PixQrModal
        open={pixModal.open}
        onClose={() => setPixModal({ ...pixModal, open: false })}
        recipientUserId={pixModal.recipientUserId}
        recipientName={pixModal.name}
        amountCents={pixModal.amount}
        mode={pixModal.mode}
        groupId={expense.groupId}
        onMarkPaid={async () => {
          toast.success("Pagamento registrado!");
        }}
        onSettlementComplete={() => {
          setPixModal({ ...pixModal, open: false });
        }}
      />

      <GuestClaimShareModal
        open={guestShareModal.open}
        onClose={() => setGuestShareModal({ ...guestShareModal, open: false })}
        guestName={guestShareModal.guestName}
        shareAmountCents={guestShareModal.shareAmountCents}
        claimToken={guestShareModal.claimToken}
        expenseTitle={expense.title}
      />
    </div>
  );
}

/** Shows per-person share breakdown for the "Divisão" tab. */
function ExpenseSharesSummary({
  expense,
  allParticipants,
}: {
  expense: ExpenseWithDetails;
  allParticipants: UserProfile[];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Receipt className="h-4 w-4 text-primary" />
          Por pessoa
        </div>
        <div className="mt-3 space-y-3">
          {expense.shares.map((share, idx) => {
            const payer = expense.payers.find((p) => p.userId === share.userId);
            const net = (payer?.amountCents ?? 0) - share.shareAmountCents;

            return (
              <motion.div
                key={share.userId}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="rounded-xl bg-muted/50 p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UserAvatar name={share.user.name} avatarUrl={share.user.avatarUrl} size="xs" />
                    <span className="font-medium text-sm">
                      {share.user.name.split(" ")[0]}
                    </span>
                  </div>
                  <span className="text-lg font-bold tabular-nums">
                    {formatBRL(share.shareAmountCents)}
                  </span>
                </div>
                <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
                  <span>Consumo: {formatBRL(share.shareAmountCents)}</span>
                  {payer && (
                    <span>Pagou: {formatBRL(payer.amountCents)}</span>
                  )}
                  {Math.abs(net) > 1 && (
                    <span className={net > 0 ? "text-success" : "text-destructive"}>
                      {net > 0 ? "+" : ""}{formatBRL(Math.abs(net))} {net > 0 ? "a receber" : "a pagar"}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {expense.payers.length > 0 && (
        <PayerSummaryCard
          payers={expense.payers.map((p) => ({ userId: p.userId, amountCents: p.amountCents }))}
          participants={allParticipants}
        />
      )}
    </div>
  );
}

/** Simplified charge explanation for expense model. */
function ExpenseChargeExplanation({
  expense,
  allParticipants,
  debts,
  currentUserId,
}: {
  expense: ExpenseWithDetails;
  allParticipants: UserProfile[];
  debts: DebtEdge[];
  currentUserId?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
      >
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">De onde veio esse valor</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="border-t px-4 pb-4 pt-3 space-y-5">
              {debts.length > 0 && allParticipants.length >= 2 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Quem paga quem
                  </p>
                  <DebtGraph participants={allParticipants} edges={debts} />
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Quanto cada um consumiu
                </p>
                <div className="space-y-1.5">
                  {expense.shares.map((share) => {
                    const payer = expense.payers.find((p) => p.userId === share.userId);
                    const isMe = share.userId === currentUserId;
                    return (
                      <div
                        key={share.userId}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                          isMe ? "bg-primary/5" : "bg-muted/30"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <UserAvatar name={share.user.name} avatarUrl={share.user.avatarUrl} size="xs" />
                          <span className={isMe ? "font-medium" : ""}>
                            {share.user.name.split(" ")[0]}
                            {isMe && " (você)"}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="tabular-nums font-medium">
                            {formatBRL(share.shareAmountCents)}
                          </span>
                          {payer && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              pagou {formatBRL(payer.amountCents)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Saldo líquido
                </p>
                <div className="space-y-1">
                  {expense.shares.map((share) => {
                    const payer = expense.payers.find((p) => p.userId === share.userId);
                    const net = (payer?.amountCents ?? 0) - share.shareAmountCents;
                    if (Math.abs(net) < 2) return null;
                    return (
                      <div
                        key={share.userId}
                        className="flex items-center justify-between text-sm px-3 py-1"
                      >
                        <span className="text-muted-foreground">
                          {share.user.name.split(" ")[0]}
                        </span>
                        <span
                          className={`font-medium tabular-nums ${
                            net > 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {net > 0 ? "+" : ""}
                          {formatBRL(Math.abs(net))}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            {net > 0 ? "a receber" : "a pagar"}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg bg-muted/30 p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total da conta</span>
                  <span className="font-bold tabular-nums">{formatBRL(expense.totalAmount)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Quem pagou</span>
                  <span>
                    {expense.payers.map((py) => {
                      const name = py.user.name.split(" ")[0];
                      return `${name} (${formatBRL(py.amountCents)})`;
                    }).join(", ")}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
