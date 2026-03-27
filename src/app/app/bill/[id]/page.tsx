"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Bell,
  Check,
  CheckCheck,
  Clock,
  Loader2,
  Pencil,
  QrCode,
  Receipt,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BillSummary } from "@/components/bill/bill-summary";
import { PayerSummaryCard } from "@/components/bill/payer-summary-card";
import { AnimatedCheckmark } from "@/components/shared/animated-checkmark";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/shared/skeleton";
import { PulsingDot } from "@/components/shared/pulsing-dot";
import { UserAvatar } from "@/components/shared/user-avatar";
import dynamic from "next/dynamic";
const PixQrModal = dynamic(
  () => import("@/components/settlement/pix-qr-modal").then((m) => ({ default: m.PixQrModal })),
  { ssr: false },
);
import { ChargeExplanation } from "@/components/settlement/charge-explanation";
import { SimplificationToggle } from "@/components/settlement/simplification-toggle";
import { SimplificationViewer } from "@/components/settlement/simplification-viewer";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatBRL } from "@/lib/currency";
import { computeRawEdges, simplifyDebts } from "@/lib/simplify";
import { coerceDebtStatus } from "@/lib/type-guards";
import { createClient } from "@/lib/supabase/client";
import { loadBillFromSupabase } from "@/lib/supabase/load-bill";
import { ledgerRowToLedgerEntry } from "@/lib/supabase/mappers";
import { recordPaymentInSupabase } from "@/lib/supabase/ledger-actions";
import { syncBillToSupabase } from "@/lib/supabase/sync-bill";
import { useBillStore } from "@/stores/bill-store";
import { useAuth } from "@/hooks/use-auth";
import toast from "react-hot-toast";
import type { Bill, BillParticipantStatus, BillStatus, User } from "@/types";

const billStatusConfig: Record<BillStatus, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  active: { label: "Pendente", color: "bg-warning/15 text-warning-foreground" },
  partially_settled: { label: "Parcial", color: "bg-primary/15 text-primary" },
  settled: { label: "Liquidado", color: "bg-success/15 text-success" },
};

const statusBadge: Record<BillParticipantStatus, { label: string; color: string }> = {
  accepted: { label: "Aceito", color: "bg-success/15 text-success" },
  invited: { label: "Aguardando", color: "bg-warning/15 text-warning-foreground" },
  declined: { label: "Recusou", color: "bg-destructive/15 text-destructive" },
};

function CreatorDraftParticipants({
  billId,
  participants,
  creatorId,
  onAcceptanceChange,
  initialStatuses,
}: {
  billId: string;
  participants: User[];
  creatorId: string;
  onAcceptanceChange?: (allAccepted: boolean) => void;
  initialStatuses?: Map<string, string>;
}) {
  const [statuses, setStatuses] = useState<Map<string, BillParticipantStatus>>(
    (initialStatuses as Map<string, BillParticipantStatus> | undefined) ?? new Map(),
  );

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`draft-participants:${billId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bill_participants", filter: `bill_id=eq.${billId}` },
        (payload) => {
          const updated = payload.new as { user_id: string; status: string };
          setStatuses((prev) => new Map(prev).set(updated.user_id, updated.status as BillParticipantStatus));
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [billId]);

  useEffect(() => {
    if (!onAcceptanceChange || statuses.size === 0) return;
    const allAccepted = participants
      .filter((p) => p.id !== creatorId)
      .every((p) => statuses.get(p.id) === "accepted");
    onAcceptanceChange(allAccepted);
  }, [statuses, participants, creatorId, onAcceptanceChange]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.4 }}
      className="mt-5"
    >
      <h2 className="mb-3 text-sm font-semibold">Participantes</h2>
      <div className="space-y-2">
        {participants.map((p) => {
          const st = statuses.get(p.id) ?? "accepted";
          const badge = statusBadge[st];
          return (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
            >
              <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
              <span className="flex-1 text-sm font-medium">{p.name}</span>
              {p.id === creatorId ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Voce
                </span>
              ) : (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.color}`}>
                  {st === "invited" && <PulsingDot className="mr-1 inline-block h-1.5 w-1.5 bg-warning" />}
                  {badge.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

function CreatorDraftView({
  bill,
  participants,
  items,
  splits,
  billSplits,
  store,
  initialStatuses,
}: {
  bill: NonNullable<ReturnType<typeof useBillStore.getState>["bill"]>;
  participants: User[];
  items: ReturnType<typeof useBillStore.getState>["items"];
  splits: ReturnType<typeof useBillStore.getState>["splits"];
  billSplits: ReturnType<typeof useBillStore.getState>["billSplits"];
  store: ReturnType<typeof useBillStore.getState>;
  initialStatuses?: Map<string, string>;
}) {
  const [draftAllAccepted, setDraftAllAccepted] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const isGroupBill = !!bill.groupId;
  const canFinalize = isGroupBill || draftAllAccepted;
  const hasContent = items.length > 0 || billSplits.length > 0;

  const itemsTotal = items.reduce((s, i) => s + i.totalPriceCents, 0);
  const grandTotal =
    bill.billType === "single_amount"
      ? bill.totalAmountInput
      : itemsTotal +
        Math.round((itemsTotal * bill.serviceFeePercent) / 100) +
        bill.fixedFees;

  const handleFinalize = async () => {
    setFinalizing(true);
    store.computeLedger();
    const state = useBillStore.getState();
    if (state.bill) {
      const result = await syncBillToSupabase({
        bill: state.bill,
        participants: state.participants,
        items: state.items,
        splits: state.splits,
        billSplits: state.billSplits,
        ledger: state.ledger,
        existingBillId: bill.id,
        groupId: bill.groupId,
      });
      if ("billId" in result) {
        // Reload from DB to get authoritative status + real ledger entry IDs
        const fresh = await loadBillFromSupabase(result.billId);
        if (fresh) {
          useBillStore.setState({
            bill: fresh.bill,
            participants: fresh.participants,
            items: fresh.items,
            splits: fresh.splits,
            billSplits: fresh.billSplits,
            ledger: fresh.ledger,
          });
        }
        // No router.push needed: store update causes React re-render;
        // bill.status is now 'active' so the page transitions out of CreatorDraftView
        setFinalizing(false);
        return;
      }
      console.error("Finalize failed:", result.error);
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
          <h1 className="font-semibold">{bill.title}</h1>
          {bill.merchantName && (
            <p className="text-xs text-muted-foreground">{bill.merchantName}</p>
          )}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${billStatusConfig.draft.color}`}>
          {billStatusConfig.draft.label}
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mt-6"
      >
        <div className="rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
          <p className="text-sm text-white/70">Total da conta</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {formatBRL(grandTotal)}
          </p>
          <div className="mt-2 flex gap-4 text-sm text-white/70">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {participants.length} pessoas
            </span>
          </div>
        </div>
      </motion.div>

      {!isGroupBill && (
        <CreatorDraftParticipants
          billId={bill.id}
          participants={participants}
          creatorId={bill.creatorId}
          onAcceptanceChange={setDraftAllAccepted}
          initialStatuses={initialStatuses}
        />
      )}

      {hasContent && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="mt-5"
        >
          <BillSummary
            bill={bill}
            items={items}
            splits={splits}
            billSplits={billSplits}
            participants={participants}
          />
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4 }}
        className="mt-6 space-y-3"
      >
        {hasContent && (
          <Button
            onClick={handleFinalize}
            disabled={!canFinalize || finalizing}
            className="w-full gap-2"
          >
            {finalizing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <QrCode className="h-4 w-4" />
            )}
            {!canFinalize && !isGroupBill
              ? "Aguardando participantes..."
              : "Gerar cobrancas Pix"}
          </Button>
        )}
        {!canFinalize && !isGroupBill && (
          <p className="text-xs text-center text-muted-foreground">
            Aguardando todos os participantes aceitarem o convite para finalizar.
          </p>
        )}
        <Link href={`/app/bill/new?draft=${bill.id}`}>
          <Button variant="outline" className="w-full gap-2">
            <Pencil className="h-4 w-4" />
            Editar rascunho
          </Button>
        </Link>
      </motion.div>
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
  const store = useBillStore();
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<"items" | "split" | "payment">("payment");
  const [simplifyEnabled, setSimplifyEnabled] = useState(true);
  const [showSimplifySteps, setShowSimplifySteps] = useState(false);
  const [pixModal, setPixModal] = useState<{
    open: boolean;
    entryId: string;
    recipientUserId: string;
    name: string;
    amount: number;
    paidAmountCents: number;
    mode: "pay" | "collect";
  }>({
    open: false,
    entryId: "",
    recipientUserId: "",
    name: "",
    amount: 0,
    paidAmountCents: 0,
    mode: "pay",
  });

  const { bill, participants, items, splits, billSplits, ledger } = store;
  const [loadingFromDb, setLoadingFromDb] = useState(false);
  const loadedBillKeyRef = useRef<string | null>(null);
  const lastLoadTimestamp = useRef(0);
  const [participantStatuses, setParticipantStatuses] = useState<Map<string, string>>(new Map());

  const loadAndSetBill = useCallback(async (billId: string) => {
    const now = Date.now();
    if (now - lastLoadTimestamp.current < 2000) return null;
    lastLoadTimestamp.current = now;
    const data = await loadBillFromSupabase(billId);
    if (data) {
      useBillStore.setState({
        bill: data.bill,
        participants: data.participants,
        items: data.items,
        splits: data.splits,
        billSplits: data.billSplits,
        ledger: data.ledger,
      });
    }
    return data;
  }, []);

  const currentUserId = currentUser?.id;

  useEffect(() => {
    if (id === "demo") return;
    const cacheKey = `${currentUserId ?? "anon"}:${id}`;
    if (loadedBillKeyRef.current === cacheKey) {
      setLoadingFromDb(false);
      return;
    }

    loadedBillKeyRef.current = cacheKey;
    let cancelled = false;
    setLoadingFromDb(true);
    (async () => {
      const data = await loadAndSetBill(id);
      if (!cancelled) {
        setLoadingFromDb(false);
        if (data?.participantStatuses) {
          setParticipantStatuses(data.participantStatuses);
          if (currentUserId && data.participantStatuses.get(currentUserId) === "invited") {
            router.push(`/app/bill/${id}/invite`);
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [id, currentUserId, loadAndSetBill, router]);

  const billId = bill?.id;

  useEffect(() => {
    if (!billId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`ledger:${billId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ledger", filter: `bill_id=eq.${billId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newEntry = ledgerRowToLedgerEntry(payload.new as Parameters<typeof ledgerRowToLedgerEntry>[0]);
            useBillStore.setState((state) => ({
              ledger: [...state.ledger, newEntry],
            }));
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as { id: string; status: string; paid_amount_cents: number; paid_at: string | null; confirmed_at: string | null };
            useBillStore.setState((state) => ({
              ledger: state.ledger.map((e) =>
                e.id === updated.id
                  ? {
                      ...e,
                      status: coerceDebtStatus(updated.status, "pending"),
                      paidAmountCents: updated.paid_amount_cents ?? e.paidAmountCents,
                      paidAt: updated.paid_at ?? undefined,
                      confirmedAt: updated.confirmed_at ?? undefined,
                    }
                  : e,
              ),
            }));
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [billId]);

  useEffect(() => {
    if (!billId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`bill:${billId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bills", filter: `id=eq.${billId}` },
        (payload) => {
          const updated = payload.new as { id: string; status: string };
          useBillStore.setState((state) => ({
            bill: state.bill ? { ...state.bill, status: updated.status as Bill["status"] } : null,
          }));
          if (updated.status === "active") {
            loadAndSetBill(billId);
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [billId, loadAndSetBill]);

  useEffect(() => {
    if (!billId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`bill-deleted:${billId}`)
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "bills", filter: `id=eq.${billId}` },
        () => {
          toast("Este rascunho foi excluido.", { icon: "🗑️" });
          router.push("/app");
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [billId, router]);

  const handleRecordPayment = async (entryId: string, amountCents: number) => {
    const entry = ledger.find((e) => e.id === entryId);
    if (!entry) return;
    store.recordPayment(entryId, amountCents);
    await recordPaymentInSupabase(entryId, entry.fromUserId, entry.toUserId, amountCents);
  };

  const simplificationResult = useMemo(() => {
    if (!bill || participants.length < 3) return null;
    const rawEdges = computeRawEdges(bill, participants, splits, billSplits, items);
    if (rawEdges.length < 2) return null;
    return simplifyDebts(rawEdges, participants);
  }, [bill, participants, splits, billSplits, items]);

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

  if (!bill) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/app"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-semibold">Conta</h1>
        </div>
        <EmptyState
          icon={Receipt}
          title="Nenhuma conta ativa"
          description="Crie uma nova conta para dividir com amigos, ou use o botao 'Experimentar demo' na pagina inicial."
          actionLabel="Nova conta"
          onAction={() => router.push("/app/bill/new")}
        />
      </div>
    );
  }

  if (bill.status === "draft" && currentUser?.id !== bill.creatorId) {
    const creator = participants.find((p) => p.id === bill.creatorId);
    const creatorFirstName = creator?.name.split(" ")[0] ?? "criador";

    const itemsTotal = items.reduce((s, i) => s + i.totalPriceCents, 0);
    const grandTotal =
      bill.billType === "single_amount"
        ? bill.totalAmountInput
        : itemsTotal +
          Math.round((itemsTotal * bill.serviceFeePercent) / 100) +
          bill.fixedFees;

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
            <h1 className="font-semibold">{bill.title}</h1>
            {bill.merchantName && (
              <p className="text-xs text-muted-foreground">{bill.merchantName}</p>
            )}
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${billStatusConfig.draft.color}`}>
            {billStatusConfig.draft.label}
          </span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="mt-6"
        >
          <div className="rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
            <p className="text-sm text-white/70">Total da conta</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">
              {formatBRL(grandTotal)}
            </p>
            <div className="mt-2 flex gap-4 text-sm text-white/70">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {participants.length} pessoas
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
          <PulsingDot className="bg-primary h-3 w-3" />
          <p className="mt-4 text-sm font-medium text-foreground">
            Aguardando {creatorFirstName} finalizar a conta
          </p>
          <p className="mt-1 text-xs text-muted-foreground text-center">
            Voce sera notificado assim que a conta estiver pronta para divisao.
          </p>
        </motion.div>

        {participants.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="mt-5"
          >
            <h2 className="mb-3 text-sm font-semibold">Participantes</h2>
            <div className="space-y-2">
              {participants.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
                >
                  <UserAvatar name={p.name} size="sm" />
                  <span className="text-sm font-medium">{p.name}</span>
                  {p.id === bill.creatorId && (
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

  if (bill.status === "draft" && currentUser?.id === bill.creatorId) {
    return (
      <CreatorDraftView
        bill={bill}
        participants={participants}
        items={items}
        splits={splits}
        billSplits={billSplits}
        store={store}
        initialStatuses={participantStatuses}
      />
    );
  }

  const billStatus = billStatusConfig[bill.status];
  const allSettled = ledger.length > 0 && ledger.every((e) => e.status === "settled");
  const settledCount = ledger.filter((e) => e.status === "settled").length;
  const isGroupBill = !!bill.groupId;
  const hasGroupCascadeSettled = isGroupBill && ledger.some(
    (e) => e.status === "settled" && !e.paidAt && e.confirmedAt,
  );

  const itemsTotal = items.reduce((s, i) => s + i.totalPriceCents, 0);
  const grandTotal =
    bill.billType === "single_amount"
      ? bill.totalAmountInput
      : itemsTotal +
        Math.round((itemsTotal * bill.serviceFeePercent) / 100) +
        bill.fixedFees;

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
          <h1 className="font-semibold">{bill.title}</h1>
          {bill.merchantName && (
            <p className="text-xs text-muted-foreground">{bill.merchantName}</p>
          )}
          {isGroupBill && (
            <Link
              href={`/app/groups/${bill.groupId}`}
              className="flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
            >
              <Users className="h-3 w-3" />
              Ver grupo
            </Link>
          )}
        </div>
        <motion.span
          key={bill.status}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${billStatus.color}`}
        >
          {billStatus.label}
        </motion.span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mt-6"
      >
        <div className="rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
          <p className="text-sm text-white/70">Total da conta</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {formatBRL(grandTotal)}
          </p>
          <div className="mt-2 flex gap-4 text-sm text-white/70">
            <span className="flex items-center gap-1">
              <Receipt className="h-3.5 w-3.5" />
              {items.length} itens
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {participants.length} pessoas
            </span>
            {ledger.length > 0 && (
              <span className="flex items-center gap-1">
                <Check className="h-3.5 w-3.5" />
                {settledCount}/{ledger.length}
              </span>
            )}
          </div>
        </div>
      </motion.div>

      <div className="mt-5 flex rounded-xl bg-muted/50 p-1">
        {(
          [
            { key: "items", label: "Itens" },
            { key: "split", label: "Divisao" },
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
            {tab.key === "payment" && ledger.length > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-bold text-primary">
                {ledger.filter((e) => e.status !== "settled").length || "✓"}
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
          {items.map((item) => (
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
          {items.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum item nesta conta.
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
          <BillSummary
            bill={bill}
            items={items}
            splits={splits}
            billSplits={billSplits}
            participants={participants}
          />
        </motion.div>
      )}

      {activeTab === "payment" && allSettled && ledger.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="mt-5 flex flex-col items-center rounded-2xl border-2 border-dashed border-success/30 bg-success/5 p-8"
        >
          <AnimatedCheckmark size={64} />
          <h3 className="mt-4 text-lg font-bold">Tudo liquidado!</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasGroupCascadeSettled
              ? "Liquidado via acerto do grupo."
              : "Todos os pagamentos foram confirmados."}
          </p>
          {isGroupBill && (
            <Link
              href={`/app/groups/${bill.groupId}`}
              className="mt-3 text-sm text-primary hover:underline"
            >
              Ver acerto do grupo
            </Link>
          )}
        </motion.div>
      )}

      {activeTab === "payment" && isGroupBill && !allSettled && ledger.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-5 space-y-4"
        >
          <Link
            href={`/app/groups/${bill.groupId}`}
            className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 hover:bg-primary/10 transition-colors"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">Ir para acerto do grupo</p>
              <p className="text-xs text-muted-foreground">
                Liquidar dividas consolidadas de todas as contas do grupo
              </p>
            </div>
          </Link>

          <div>
            <h2 className="mb-3 text-sm font-semibold">Cobrancas desta conta</h2>
            <div className="space-y-3">
              {ledger.map((entry, idx) => {
                const debtor = participants.find((p) => p.id === entry.fromUserId);
                const creditor = participants.find((p) => p.id === entry.toUserId);
                const isDebtor = currentUser?.id === entry.fromUserId;
                const isCreditor = currentUser?.id === entry.toUserId;

                const entryLabel = isDebtor
                  ? `Voce deve para ${creditor?.name.split(" ")[0] || "?"}`
                  : isCreditor
                    ? `${debtor?.name.split(" ")[0] || "?"} te deve`
                    : `${debtor?.name.split(" ")[0] || "?"} → ${creditor?.name.split(" ")[0] || "?"}`;

                return (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.06 }}
                    className="overflow-hidden rounded-2xl border bg-card"
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                            {isDebtor ? (creditor?.name.charAt(0) || "?") : (debtor?.name.charAt(0) || "?")}
                          </div>
                          <div>
                            <p className="text-sm font-medium">
                              {entryLabel}
                            </p>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                entry.status === "pending"
                                  ? "bg-warning/15 text-warning-foreground"
                                  : entry.status === "partially_paid"
                                    ? "bg-primary/10 text-primary"
                                    : "bg-success/15 text-success"
                              }`}
                            >
                              {entry.status === "pending" && (
                                <>
                                  <Clock className="h-3 w-3" />
                                  Pendente
                                </>
                              )}
                              {entry.status === "partially_paid" && (
                                <>
                                  <Clock className="h-3 w-3" />
                                  Parcialmente pago
                                </>
                              )}
                              {entry.status === "settled" && (
                                <>
                                  <CheckCheck className="h-3 w-3" />
                                  Liquidado
                                </>
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold tabular-nums">
                            {formatBRL(entry.amountCents)}
                          </p>
                          {entry.paidAmountCents > 0 && entry.status !== "settled" && (
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {formatBRL(entry.paidAmountCents)} pago
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      {activeTab === "payment" && ledger.length > 0 && !allSettled && !isGroupBill && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="mt-5"
        >
          <div className="mb-4">
            <ChargeExplanation
              bill={bill}
              participants={participants}
              items={items}
              splits={splits}
              billSplits={billSplits}
              ledger={ledger}
              simplificationResult={simplificationResult}
              currentUserId={currentUser?.id}
            />
          </div>

          {simplificationResult && (
            <div className="mb-4">
              <SimplificationToggle
                originalCount={simplificationResult.originalCount}
                simplifiedCount={simplificationResult.simplifiedCount}
                enabled={simplifyEnabled}
                onToggle={setSimplifyEnabled}
                onViewSteps={() => setShowSimplifySteps(true)}
              />
            </div>
          )}

          {bill.payers.length > 0 && (
            <div className="mb-4">
              <PayerSummaryCard payers={bill.payers} participants={participants} />
            </div>
          )}

          <h2 className="mb-3 text-sm font-semibold">
            Cobrancas
            {simplificationResult && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {simplifyEnabled
                  ? `(${simplificationResult.simplifiedCount} simplificadas)`
                  : `(${simplificationResult.originalCount} detalhadas)`}
              </span>
            )}
          </h2>
          {!simplifyEnabled && simplificationResult && (() => {
            const raw = simplificationResult.originalEdges;
            const grouped = new Map<string, typeof raw>();
            for (const edge of raw) {
              const list = grouped.get(edge.toUserId) || [];
              list.push(edge);
              grouped.set(edge.toUserId, list);
            }
            return (
              <div className="space-y-4">
                {Array.from(grouped.entries()).map(([receiverId, edges]) => {
                  const receiver = participants.find((p) => p.id === receiverId);
                  const groupTotal = edges.reduce((s, e) => s + e.amountCents, 0);
                  return (
                    <div key={receiverId} className="rounded-2xl border bg-card overflow-hidden">
                      <div className="flex items-center justify-between bg-muted/30 px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                            {receiver?.name.charAt(0) || "?"}
                          </span>
                          <span className="text-sm font-semibold">
                            Para {receiver?.name.split(" ")[0] || "?"}
                          </span>
                        </div>
                        <span className="text-sm font-bold tabular-nums text-primary">
                          {formatBRL(groupTotal)}
                        </span>
                      </div>
                      <div className="divide-y divide-border">
                        {edges.map((edge, i) => {
                          const from = participants.find((p) => p.id === edge.fromUserId);
                          return (
                            <div key={i} className="px-4 py-2.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                                    {from?.name.charAt(0) || "?"}
                                  </span>
                                  <span className="text-sm text-muted-foreground">
                                    {from?.name.split(" ")[0] || "?"}
                                  </span>
                                </div>
                                <span className="text-sm font-medium tabular-nums">
                                  {formatBRL(edge.amountCents)}
                                </span>
                              </div>
                              <div className="mt-2 flex gap-2">
                                <Button
                                  size="sm"
                                  className="flex-1 gap-1.5 bg-success text-success-foreground hover:bg-success/90 h-8 text-xs"
                                  onClick={() =>
                                    setPixModal({
                                      open: true,
                                      entryId: `raw_${i}_${edge.fromUserId}`,
                                      recipientUserId: receiver?.id || "",
                                      name: receiver?.name || "",
                                      amount: edge.amountCents,
                                      paidAmountCents: 0,
                                      mode: "pay",
                                    })
                                  }
                                >
                                  <QrCode className="h-3.5 w-3.5" />
                                  Pagar via Pix
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {(simplifyEnabled || !simplificationResult) && (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {ledger.map((entry, idx) => {
                const debtor = participants.find((p) => p.id === entry.fromUserId);
                const creditor = participants.find((p) => p.id === entry.toUserId);
                const isDebtor = currentUser?.id === entry.fromUserId;
                const isCreditor = currentUser?.id === entry.toUserId;

                const entryLabel = isDebtor
                  ? `Voce deve para ${creditor?.name.split(" ")[0] || "?"}`
                  : isCreditor
                    ? `${debtor?.name.split(" ")[0] || "?"} te deve`
                    : `${debtor?.name.split(" ")[0] || "?"} → ${creditor?.name.split(" ")[0] || "?"}`;

                return (
                  <motion.div
                    key={entry.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.06 }}
                    className="overflow-hidden rounded-2xl border bg-card"
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                            {isDebtor ? (creditor?.name.charAt(0) || "?") : (debtor?.name.charAt(0) || "?")}
                          </div>
                          <div>
                            <p className="text-sm font-medium">
                              {entryLabel}
                            </p>
                            <motion.span
                              key={entry.status}
                              initial={{ scale: 0.8, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{
                                type: "spring",
                                stiffness: 400,
                                damping: 20,
                              }}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                entry.status === "pending"
                                  ? "bg-warning/15 text-warning-foreground"
                                  : entry.status === "partially_paid"
                                    ? "bg-primary/10 text-primary"
                                    : "bg-success/15 text-success"
                              }`}
                            >
                              {entry.status === "pending" && (
                                <>
                                  <Clock className="h-3 w-3" />
                                  Pendente
                                </>
                              )}
                              {entry.status === "partially_paid" && (
                                <>
                                  <Clock className="h-3 w-3" />
                                  Parcialmente pago
                                </>
                              )}
                              {entry.status === "settled" && (
                                <>
                                  <CheckCheck className="h-3 w-3" />
                                  Liquidado
                                </>
                              )}
                            </motion.span>
                          </div>
                        </div>
                        <div className="text-right">
                          <motion.p
                            key={entry.amountCents}
                            initial={{ y: 6, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            className="text-lg font-bold tabular-nums"
                          >
                            {formatBRL(entry.amountCents)}
                          </motion.p>
                          {entry.paidAmountCents > 0 && entry.status !== "settled" && (
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {formatBRL(entry.paidAmountCents)} pago
                            </p>
                          )}
                        </div>
                      </div>

                      <AnimatePresence mode="wait">
                        {(entry.status === "pending" || entry.status === "partially_paid") && isDebtor && (
                          <motion.div
                            key="debtor-actions"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="mt-3"
                          >
                            <Button
                              size="sm"
                              className="w-full gap-1.5 bg-success text-success-foreground hover:bg-success/90"
                              onClick={() =>
                                setPixModal({
                                  open: true,
                                  entryId: entry.id,
                                  recipientUserId: creditor?.id || "",
                                  name: creditor?.name || "",
                                  amount: entry.amountCents,
                                  paidAmountCents: entry.paidAmountCents,
                                  mode: "pay",
                                })
                              }
                            >
                              <QrCode className="h-4 w-4" />
                              Pagar {formatBRL(entry.amountCents - entry.paidAmountCents)} para {creditor?.name.split(" ")[0]}
                            </Button>
                          </motion.div>
                        )}

                        {(entry.status === "pending" || entry.status === "partially_paid") && isCreditor && (
                          <motion.div
                            key="creditor-actions"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="mt-3 flex gap-2"
                          >
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 gap-1.5"
                              onClick={() =>
                                setPixModal({
                                  open: true,
                                  entryId: entry.id,
                                  recipientUserId: currentUser?.id || "",
                                  name: debtor?.name || "",
                                  amount: entry.amountCents,
                                  paidAmountCents: entry.paidAmountCents,
                                  mode: "collect",
                                })
                              }
                            >
                              <QrCode className="h-4 w-4" />
                              Gerar cobranca
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1 text-muted-foreground"
                            >
                              <Bell className="h-3.5 w-3.5" />
                              Lembrar
                            </Button>
                          </motion.div>
                        )}

                        {entry.status === "settled" && (
                          <motion.div
                            key="settled-info"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="mt-3 flex items-center gap-2 rounded-lg bg-success/5 px-3 py-2"
                          >
                            <CheckCheck className="h-4 w-4 shrink-0 text-success" />
                            <span className="text-xs text-success">
                              {isGroupBill && !entry.paidAt && entry.confirmedAt
                                ? "Liquidado via acerto do grupo"
                                : "Liquidado"}
                              {entry.confirmedAt &&
                                ` em ${new Date(entry.confirmedAt).toLocaleString("pt-BR", {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}`}
                            </span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
          )}
        </motion.div>
      )}

      {activeTab === "payment" && ledger.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-5"
        >
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma cobranca nesta conta.
          </p>
        </motion.div>
      )}

      <PixQrModal
        open={pixModal.open}
        onClose={() => setPixModal({ ...pixModal, open: false })}
        recipientUserId={pixModal.recipientUserId}
        billId={bill.id}
        recipientName={pixModal.name}
        amountCents={pixModal.amount}
        paidAmountCents={pixModal.paidAmountCents}
        mode={pixModal.mode}
        onMarkPaid={(amountCents) => {
          handleRecordPayment(pixModal.entryId, amountCents);
          setPixModal({ ...pixModal, open: false });
        }}
      />

      {simplificationResult && (
        <Sheet open={showSimplifySteps} onOpenChange={setShowSimplifySteps}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-3xl">
            <SheetHeader>
              <SheetTitle>Simplificacao passo a passo</SheetTitle>
            </SheetHeader>
            <div className="mt-4 pb-8">
              <SimplificationViewer
                result={simplificationResult}
                participants={participants}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
