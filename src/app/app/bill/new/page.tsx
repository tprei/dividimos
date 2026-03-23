"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Clock,
  CreditCard,
  Loader2,
  Percent,
  Plus,
  QrCode,
  Receipt,
  ScanLine,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AddItemForm } from "@/components/bill/add-item-form";
import { AddGroupParticipants } from "@/components/bill/add-group-participants";
import { AddParticipantByHandle } from "@/components/bill/add-participant-by-handle";
import { RecentContacts } from "@/components/bill/recent-contacts";
import { BillSummary } from "@/components/bill/bill-summary";
import { BillTypeSelector } from "@/components/bill/bill-type-selector";
import { ItemCard } from "@/components/bill/item-card";
import { PayerStep } from "@/components/bill/payer-step";
import { PayerSummaryCard } from "@/components/bill/payer-summary-card";
import { SingleAmountStep } from "@/components/bill/single-amount-step";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/currency";
import { saveDraftToSupabase } from "@/lib/supabase/save-draft";
import { syncBillToSupabase } from "@/lib/supabase/sync-bill";
import { useBillStore } from "@/stores/bill-store";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { BillParticipantStatus, BillType, User, UserProfile } from "@/types";

type Step = "type" | "info" | "participants" | "items" | "split" | "amount-split" | "payer" | "summary";

interface StepDef {
  key: Step;
  label: string;
}

const ITEMIZED_STEPS: StepDef[] = [
  { key: "info", label: "Dados" },
  { key: "participants", label: "Pessoas" },
  { key: "items", label: "Itens" },
  { key: "split", label: "Divisao" },
  { key: "payer", label: "Pagamento" },
  { key: "summary", label: "Resumo" },
];

const SINGLE_STEPS: StepDef[] = [
  { key: "info", label: "Dados" },
  { key: "participants", label: "Pessoas" },
  { key: "amount-split", label: "Divisao" },
  { key: "payer", label: "Pagamento" },
  { key: "summary", label: "Resumo" },
];

export default function NewBillPage() {
  const router = useRouter();
  const store = useBillStore();
  const { user: authUser } = useAuth();

  const [billType, setBillType] = useState<BillType | null>(null);
  const [step, setStep] = useState<Step>("type");
  const [title, setTitle] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [serviceFee, setServiceFee] = useState("10");
  const [fixedFees, setFixedFees] = useState("");
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [showRecentContacts, setShowRecentContacts] = useState(false);
  const [navigating, setNavigating] = useState(false);

  const steps = useMemo(
    () => (billType === "single_amount" ? SINGLE_STEPS : ITEMIZED_STEPS),
    [billType],
  );
  const stepIndex = steps.findIndex((s) => s.key === step);
  const isTypeStep = step === "type";

  const handleTypeSelect = (type: BillType) => {
    setBillType(type);
    setStep("info");
  };

  const initBill = useCallback(() => {
    if (!billType || !authUser) return;
    store.setCurrentUser(authUser);
    store.createBill(title || "Nova conta", billType, merchantName || undefined);
    if (billType === "itemized") {
      store.updateBill({
        serviceFeePercent: parseFloat(serviceFee) || 0,
        fixedFees: Math.round((parseFloat(fixedFees.replace(",", ".")) || 0) * 100),
      });
    }
  }, [store, title, billType, merchantName, serviceFee, fixedFees, authUser]);

  const [syncing, setSyncing] = useState(false);
  const [remoteBillId, setRemoteBillId] = useState<string | null>(null);
  const [participantStatuses, setParticipantStatuses] = useState<Map<string, BillParticipantStatus>>(new Map());

  const refreshParticipantStatuses = async () => {
    if (!remoteBillId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("bill_participants")
      .select("user_id, status")
      .eq("bill_id", remoteBillId);
    if (data) {
      const map = new Map<string, BillParticipantStatus>();
      for (const row of data) {
        map.set(row.user_id, row.status as BillParticipantStatus);
      }
      setParticipantStatuses(map);
    }
  };

  useEffect(() => {
    if (!remoteBillId) return;
    refreshParticipantStatuses();
    const supabase = createClient();
    const channel = supabase
      .channel(`bill-participants:${remoteBillId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bill_participants", filter: `bill_id=eq.${remoteBillId}` },
        () => { refreshParticipantStatuses(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [remoteBillId]);

  const allAccepted = store.participants
    .filter((p) => p.id !== authUser?.id)
    .every((p) => participantStatuses.get(p.id) === "accepted");

  const goNext = async () => {
    if (step === "info") {
      initBill();
    }
    if (step === "participants" && authUser) {
      const state = useBillStore.getState();
      if (state.bill && state.participants.length >= 2) {
        const result = await saveDraftToSupabase({
          bill: state.bill,
          participants: state.participants,
          creatorId: authUser.id,
          existingBillId: remoteBillId ?? undefined,
        });
        if ("billId" in result) {
          setRemoteBillId(result.billId);
        }
      }
    }
    if ((step === "items" || step === "split" || step === "amount-split" || step === "payer") && remoteBillId && authUser) {
      const draftState = useBillStore.getState();
      if (draftState.bill) {
        await saveDraftToSupabase({
          bill: draftState.bill,
          participants: draftState.participants,
          creatorId: authUser.id,
          existingBillId: remoteBillId,
        });
      }
    }
    if (step === "summary") {
      if (!allAccepted && store.participants.length > 1) {
        return;
      }
      store.computeLedger();
      setSyncing(true);
      const state = useBillStore.getState();
      if (state.bill) {
        const result = await syncBillToSupabase({
          bill: state.bill,
          participants: state.participants,
          items: state.items,
          splits: state.splits,
          billSplits: state.billSplits,
          ledger: state.ledger,
          existingBillId: remoteBillId ?? undefined,
        });
        if ("billId" in result) {
          router.push(`/app/bill/${result.billId}`);
          return;
        }
        console.error("Sync failed:", result.error);
      }
      router.push(`/app/bill/${remoteBillId || state.bill?.id || "new"}`);
      return;
    }
    const next = steps[stepIndex + 1];
    if (next) setStep(next.key);
  };

  const goBack = () => {
    if (stepIndex === 0) {
      setStep("type");
      setBillType(null);
      return;
    }
    const prev = steps[stepIndex - 1];
    if (prev) setStep(prev.key);
  };

  const handleAssign = (itemId: string, userId: string) => {
    const existingSplits = store.splits.filter((s) => s.itemId === itemId);
    const allUserIds = [...existingSplits.map((s) => s.userId), userId];
    store.splitItemEqually(itemId, allUserIds);
  };

  const handleUnassign = (itemId: string, userId: string) => {
    store.unassignItem(itemId, userId);
    const remaining = store.splits
      .filter((s) => s.itemId === itemId && s.userId !== userId)
      .map((s) => s.userId);
    if (remaining.length > 0) {
      store.splitItemEqually(itemId, remaining);
    }
  };

  const handleAssignAll = (itemId: string) => {
    const currentSplits = store.splits.filter((s) => s.itemId === itemId);
    const allAssigned = currentSplits.length === store.participants.length;
    if (allAssigned) {
      for (const p of store.participants) {
        store.unassignItem(itemId, p.id);
      }
    } else {
      store.splitItemEqually(itemId, store.participants.map((p) => p.id));
    }
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        {!isTypeStep && stepIndex > 0 ? (
          <button
            onClick={goBack}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : !isTypeStep ? (
          <button
            onClick={() => { setStep("type"); setBillType(null); }}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : (
          <Link
            href="/app"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </Link>
        )}
        <div className="flex-1">
          <h1 className="font-semibold">Nova conta</h1>
          {!isTypeStep && (
            <p className="text-xs text-muted-foreground">
              Passo {stepIndex + 1} de {steps.length}
            </p>
          )}
        </div>
      </div>

      {!isTypeStep && (
        <div className="mt-4">
          <div className="flex gap-1">
            {steps.map((s, idx) => (
              <div key={s.key} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: idx <= stepIndex ? 1 : 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  style={{ transformOrigin: "left" }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 hidden sm:flex">
            {steps.map((s, idx) => (
              <span
                key={s.key}
                className={`flex-1 text-center text-[10px] font-medium transition-colors ${
                  idx <= stepIndex ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 min-h-[400px]">
        <AnimatePresence mode="wait">
          {step === "type" && (
            <motion.div
              key="type"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <BillTypeSelector onSelect={handleTypeSelect} />
            </motion.div>
          )}

          {step === "info" && (
            <motion.div
              key="info"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Nome da conta
                </label>
                <Input
                  placeholder={
                    billType === "single_amount"
                      ? "Ex: Airbnb, Uber, presente..."
                      : "Ex: Churrascaria, Bar do Zeca..."
                  }
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                />
              </div>

              {billType === "itemized" && (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      Estabelecimento (opcional)
                    </label>
                    <Input
                      placeholder="Nome do restaurante"
                      value={merchantName}
                      onChange={(e) => setMerchantName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">
                        Taxa de servico (%)
                      </label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={serviceFee}
                        onChange={(e) => setServiceFee(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">
                        Couvert / taxas fixas (R$)
                      </label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={fixedFees}
                        onChange={(e) => setFixedFees(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                        <Camera className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Escanear nota fiscal</p>
                        <p className="text-xs text-muted-foreground">
                          QR Code NFC-e ou foto do cupom
                        </p>
                      </div>
                    </div>
                    <Button variant="outline" className="mt-3 w-full gap-2" onClick={() => {}}>
                      <ScanLine className="h-4 w-4" />
                      Escanear
                    </Button>
                  </div>
                </>
              )}
            </motion.div>
          )}

          {step === "participants" && (
            <motion.div
              key="participants"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <p className="text-sm text-muted-foreground">
                Adicione participantes pelo @handle. Voce ja esta incluido.
              </p>
              <div className="space-y-2">
                {store.participants.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                    <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">@{p.handle}</p>
                    </div>
                    {p.id === authUser?.id ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Voce</span>
                    ) : (
                      <button onClick={() => store.removeParticipant(p.id)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <AnimatePresence>
                {showAddParticipant && (
                  <AddParticipantByHandle
                    onAdd={(profile: UserProfile) => {
                      const newUser: User = {
                        id: profile.id,
                        email: "",
                        handle: profile.handle,
                        name: profile.name,
                        pixKeyType: "email",
                        pixKeyHint: "",
                        avatarUrl: profile.avatarUrl,
                        onboarded: true,
                        createdAt: new Date().toISOString(),
                      };
                      store.addParticipant(newUser);
                      setShowAddParticipant(false);
                    }}
                    onCancel={() => setShowAddParticipant(false)}
                    excludeIds={store.participants.map((p) => p.id)}
                  />
                )}
              </AnimatePresence>
              <AnimatePresence>
                {showAddGroup && (
                  <AddGroupParticipants
                    onAddMembers={(profiles) => {
                      for (const profile of profiles) {
                        const newUser: User = {
                          id: profile.id,
                          email: "",
                          handle: profile.handle,
                          name: profile.name,
                          pixKeyType: "email",
                          pixKeyHint: "",
                          avatarUrl: profile.avatarUrl,
                          onboarded: true,
                          createdAt: new Date().toISOString(),
                        };
                        store.addParticipant(newUser);
                      }
                      setShowAddGroup(false);
                    }}
                    onCancel={() => setShowAddGroup(false)}
                    excludeIds={store.participants.map((p) => p.id)}
                    currentUserId={authUser?.id ?? ""}
                  />
                )}
              </AnimatePresence>
              <AnimatePresence>
                {showRecentContacts && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden rounded-2xl border bg-card p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold">Contas anteriores</span>
                      <button
                        onClick={() => setShowRecentContacts(false)}
                        className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <RecentContacts
                      onSelect={(profile) => {
                        const newUser: User = {
                          id: profile.id,
                          email: "",
                          handle: profile.handle,
                          name: profile.name,
                          pixKeyType: "email",
                          pixKeyHint: "",
                          avatarUrl: profile.avatarUrl,
                          onboarded: true,
                          createdAt: new Date().toISOString(),
                        };
                        store.addParticipant(newUser);
                      }}
                      excludeIds={store.participants.map((p) => p.id)}
                      currentUserId={authUser?.id ?? ""}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              {!showAddParticipant && !showAddGroup && !showRecentContacts && (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1 gap-2" onClick={() => setShowAddParticipant(true)}>
                      <UserPlus className="h-4 w-4" />
                      Por @handle
                    </Button>
                    <Button variant="outline" className="flex-1 gap-2" onClick={() => setShowAddGroup(true)}>
                      <Users className="h-4 w-4" />
                      De um grupo
                    </Button>
                  </div>
                  <Button variant="outline" className="w-full gap-2" onClick={() => setShowRecentContacts(true)}>
                    <Clock className="h-4 w-4" />
                    De contas anteriores
                  </Button>
                </div>
              )}
            </motion.div>
          )}

          {step === "items" && (
            <motion.div
              key="items"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <p className="text-sm text-muted-foreground">
                Adicione os itens da conta.{" "}
                {store.items.length > 0 && (
                  <span className="font-medium text-foreground">
                    {store.items.length} itens — {formatBRL(store.bill?.totalAmount || 0)}
                  </span>
                )}
              </p>
              <AnimatePresence>
                {store.items.map((item) => (
                  <motion.div key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -100 }} className="flex items-center justify-between rounded-xl border bg-card p-3">
                    <div>
                      <p className="text-sm font-medium">{item.description}</p>
                      <p className="text-xs text-muted-foreground">{item.quantity}x {formatBRL(item.unitPriceCents)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums text-sm">{formatBRL(item.totalPriceCents)}</span>
                      <button onClick={() => store.removeItem(item.id)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <AnimatePresence>
                {showAddItem && (
                  <AddItemForm onAdd={(item) => { store.addItem(item); setShowAddItem(false); }} onCancel={() => setShowAddItem(false)} />
                )}
              </AnimatePresence>
              {!showAddItem && (
                <Button variant="outline" className="w-full gap-2" onClick={() => setShowAddItem(true)}>
                  <Plus className="h-4 w-4" />
                  Adicionar item
                </Button>
              )}
              {store.items.length > 0 && store.bill && store.bill.serviceFeePercent > 0 && (
                <div className="rounded-xl bg-muted/50 p-3 text-sm space-y-1">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatBRL(store.bill.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Servico ({store.bill.serviceFeePercent}%)</span>
                    <span className="tabular-nums">{formatBRL(Math.round(store.bill.totalAmount * store.bill.serviceFeePercent / 100))}</span>
                  </div>
                  {store.bill.fixedFees > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Couvert</span>
                      <span className="tabular-nums">{formatBRL(store.bill.fixedFees)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold border-t border-border pt-1">
                    <span>Total com servico</span>
                    <span className="tabular-nums text-primary">{formatBRL(store.getGrandTotal())}</span>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {step === "split" && (
            <motion.div
              key="split"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <p className="text-sm text-muted-foreground">
                Toque nos nomes para atribuir itens. Compartilhados sao divididos igualmente.
              </p>
              <AnimatePresence>
                {store.items.map((item) => {
                  const itemSplits = store.splits
                    .filter((s) => s.itemId === item.id)
                    .map((s) => ({ ...s, user: store.participants.find((p) => p.id === s.userId) }));
                  return (
                    <ItemCard key={item.id} item={item} splits={itemSplits} participants={store.participants} onAssign={handleAssign} onUnassign={handleUnassign} onAssignAll={handleAssignAll} onRemove={(id) => store.removeItem(id)} />
                  );
                })}
              </AnimatePresence>
              {store.items.length > 0 && (() => {
                const unassignedItems = store.items.filter((item) => store.splits.filter((s) => s.itemId === item.id).length === 0);
                if (unassignedItems.length === 0) return null;
                return (
                  <Button variant="outline" className="w-full gap-2 border-dashed border-primary/40 text-primary" onClick={() => { const allUserIds = store.participants.map((p) => p.id); for (const item of unassignedItems) { store.splitItemEqually(item.id, allUserIds); } }}>
                    <Users className="h-4 w-4" />
                    Dividir {unassignedItems.length} restante{unassignedItems.length > 1 ? "s" : ""} igualmente
                  </Button>
                );
              })()}
              {store.items.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  <Receipt className="mx-auto h-8 w-8 opacity-50" />
                  <p className="mt-2 text-sm">Adicione itens primeiro</p>
                </div>
              )}
            </motion.div>
          )}

          {step === "amount-split" && (
            <motion.div
              key="amount-split"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <SingleAmountStep
                participants={store.participants}
                totalAmountInput={store.bill?.totalAmountInput || 0}
                onSetTotal={(cents) => store.updateBill({ totalAmountInput: cents, totalAmount: cents })}
                onSplitEqually={(ids) => store.splitBillEqually(ids)}
                onSplitByPercentage={(a) => store.splitBillByPercentage(a)}
                onSplitByFixed={(a) => store.splitBillByFixed(a)}
              />
            </motion.div>
          )}

          {step === "payer" && (
            <motion.div
              key="payer"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <PayerStep
                participants={store.participants}
                payers={store.bill?.payers || []}
                grandTotal={store.getGrandTotal()}
                onSetPayerFull={(id) => store.setPayerFull(id)}
                onSplitPaymentEqually={(ids) => store.splitPaymentEqually(ids)}
                onSetPayerAmount={(id, amt) => store.setPayerAmount(id, amt)}
                onRemovePayerEntry={(id) => store.removePayerEntry(id)}
              />
            </motion.div>
          )}

          {step === "summary" && (
            <motion.div
              key="summary"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              {remoteBillId && store.participants.length > 1 && (
                <div className="rounded-2xl border bg-card p-4">
                  <h3 className="text-sm font-semibold mb-3">Participantes</h3>
                  <div className="space-y-2">
                    {store.participants.map((p) => {
                      const isCreator = p.id === authUser?.id;
                      const status = isCreator ? "accepted" : (participantStatuses.get(p.id) ?? "invited");
                      return (
                        <div key={p.id} className="flex items-center gap-3">
                          <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                          <span className="flex-1 text-sm font-medium">{p.name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            status === "accepted"
                              ? "bg-success/15 text-success"
                              : status === "declined"
                                ? "bg-destructive/15 text-destructive"
                                : "bg-warning/15 text-warning-foreground"
                          }`}>
                            {status === "accepted" ? "Aceito" : status === "declined" ? "Recusou" : "Aguardando"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {!allAccepted && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Aguardando todos os participantes aceitarem o convite para finalizar.
                    </p>
                  )}
                </div>
              )}
              {store.bill && (
                <>
                  <BillSummary
                    bill={store.bill}
                    items={store.items}
                    splits={store.splits}
                    billSplits={store.billSplits}
                    participants={store.participants}
                  />
                  {store.bill.payers.length > 0 && (
                    <PayerSummaryCard
                      payers={store.bill.payers}
                      participants={store.participants}
                    />
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!isTypeStep && (() => {
        let errorMsg: string | null = null;
        if (step === "amount-split") {
          const total = store.bill?.totalAmountInput || 0;
          const assigned = store.billSplits.reduce((s, bs) => s + bs.computedAmountCents, 0);
          if (total <= 0) {
            errorMsg = "Informe o valor total da conta";
          } else if (Math.abs(total - assigned) > 1) {
            errorMsg = `A divisao (${formatBRL(assigned)}) nao corresponde ao total (${formatBRL(total)})`;
          }
        } else if (step === "payer") {
          const gt = store.getGrandTotal();
          const paid = (store.bill?.payers || []).reduce((s, p) => s + p.amountCents, 0);
          if (gt > 0 && Math.abs(gt - paid) > 1) {
            errorMsg = `O pagamento (${formatBRL(paid)}) nao corresponde ao total (${formatBRL(gt)})`;
          }
        }
        return (
          <div className="mt-6">
            {errorMsg && (
              <p className="mb-2 text-center text-xs text-destructive">{errorMsg}</p>
            )}
            <div className="flex gap-3">
              <Button variant="outline" onClick={goBack} className="gap-1" disabled={navigating}>
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </Button>
              <Button
                onClick={async () => {
                  setNavigating(true);
                  try {
                    await goNext();
                  } finally {
                    setNavigating(false);
                  }
                }}
                className="flex-1 gap-2"
                disabled={navigating || (() => {
                  if (step === "info") return !title.trim();
                  if (step === "participants") return store.participants.length < 2;
                  if (step === "amount-split") {
                    const total = store.bill?.totalAmountInput || 0;
                    if (total <= 0) return true;
                    const assigned = store.billSplits.reduce((s, bs) => s + bs.computedAmountCents, 0);
                    return Math.abs(total - assigned) > 1;
                  }
                  if (step === "payer") {
                    const gt = store.getGrandTotal();
                    const paid = (store.bill?.payers || []).reduce((s, p) => s + p.amountCents, 0);
                    return gt <= 0 || Math.abs(gt - paid) > 1;
                  }
                  if (step === "summary") {
                    return !allAccepted && store.participants.length > 1;
                  }
                  return false;
                })()}
              >
                {navigating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : step === "summary" ? (
                  <>
                    <QrCode className="h-4 w-4" />
                    {!allAccepted && store.participants.length > 1
                      ? "Aguardando participantes..."
                      : "Gerar cobrancas Pix"}
                  </>
                ) : (
                  <>
                    Proximo
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
