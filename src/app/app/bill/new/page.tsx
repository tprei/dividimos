"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Clock,
  Loader2,
  Plus,
  QrCode,
  Receipt,
  ScanLine,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddItemForm } from "@/components/bill/add-item-form";
import { GroupSelector } from "@/components/bill/group-selector";
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
import { loadBillFromSupabase } from "@/lib/supabase/load-bill";
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
  return (
    <Suspense>
      <NewBillPageContent />
    </Suspense>
  );
}

function NewBillPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [showRecentContacts, setShowRecentContacts] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedGroupName, setSelectedGroupName] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraftId, setEditDraftId] = useState<string | null>(null);
  const editLoadedRef = useRef(false);

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

  // Load draft for editing when ?draft=<id> is present
  useEffect(() => {
    const draftId = searchParams.get("draft");
    if (!draftId || !authUser || editLoadedRef.current) return;

    // If store already has this draft loaded, just restore local state
    const storeState = useBillStore.getState();
    if (storeState.bill?.id === draftId) {
      editLoadedRef.current = true;
      setIsEditing(true);
      setEditDraftId(draftId);
      setBillType(storeState.bill.billType);
      setTitle(storeState.bill.title);
      setMerchantName(storeState.bill.merchantName ?? "");
      setServiceFee(String(storeState.bill.serviceFeePercent || 10));
      setFixedFees(storeState.bill.fixedFees ? String(storeState.bill.fixedFees / 100) : "");
      setRemoteBillId(draftId);
      setStep("participants");
      return;
    }

    (async () => {
      const loaded = await loadBillFromSupabase(draftId);
      if (!loaded || editLoadedRef.current) return;
      editLoadedRef.current = true;

      const { bill, participants, items, splits, billSplits } = loaded;

      // Restore store state
      store.setCurrentUser(authUser);
      useBillStore.setState({
        bill,
        participants,
        items,
        splits,
        billSplits,
        ledger: [],
      });

      // Restore local form state
      setIsEditing(true);
      setEditDraftId(draftId);
      setBillType(bill.billType);
      setTitle(bill.title);
      setMerchantName(bill.merchantName ?? "");
      setServiceFee(String(bill.serviceFeePercent || 10));
      setFixedFees(bill.fixedFees ? String(bill.fixedFees / 100) : "");
      setRemoteBillId(draftId);

      if (bill.groupId) {
        setSelectedGroupId(bill.groupId);
        const supabase = createClient();
        const { data: group } = await supabase
          .from("groups")
          .select("name")
          .eq("id", bill.groupId)
          .single();
        if (group) setSelectedGroupName(group.name);
      }

      // Determine starting step based on what data exists
      if (bill.payers.length > 0) {
        setStep("payer");
      } else if (bill.billType === "itemized" && splits.length > 0) {
        setStep("split");
      } else if (bill.billType === "itemized" && items.length > 0) {
        setStep("items");
      } else if (bill.billType === "single_amount" && billSplits.length > 0) {
        setStep("amount-split");
      } else {
        setStep("participants");
      }
    })();
  }, [searchParams, authUser, store]);

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

  const [, setSyncing] = useState(false);
  const [remoteBillId, setRemoteBillId] = useState<string | null>(null);
  const [participantStatuses, setParticipantStatuses] = useState<Map<string, BillParticipantStatus>>(new Map());

  const refreshParticipantStatuses = useCallback(async () => {
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
  }, [remoteBillId]);

  const refreshStatusesRef = useRef(refreshParticipantStatuses);
  refreshStatusesRef.current = refreshParticipantStatuses;

  useEffect(() => {
    if (!remoteBillId) return;
    refreshParticipantStatuses();
    const supabase = createClient();
    const channel = supabase
      .channel(`bill-participants:${remoteBillId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bill_participants", filter: `bill_id=eq.${remoteBillId}` },
        () => { refreshStatusesRef.current(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [remoteBillId, refreshParticipantStatuses]);

  // Group bills skip acceptance entirely — all participants are auto-accepted
  const allAccepted = selectedGroupId
    ? true
    : store.participants
        .filter((p) => p.id !== authUser?.id)
        .every((p) => participantStatuses.get(p.id) === "accepted");

  // Auto-select group from ?groupId URL param when entering participants step
  useEffect(() => {
    const groupIdParam = searchParams.get("groupId");
    if (!groupIdParam || selectedGroupId || step !== "participants" || !authUser) return;

    (async () => {
      const supabase = createClient();
      const { data: group } = await supabase
        .from("groups")
        .select("name, creator_id")
        .eq("id", groupIdParam)
        .single();
      if (!group) return;

      const { data: acceptedMembers } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupIdParam)
        .eq("status", "accepted");

      const allMemberIds = [...new Set([
        ...(acceptedMembers ?? []).map((m) => m.user_id),
        group.creator_id,
      ])];
      const otherIds = allMemberIds.filter((id) => id !== authUser.id);

      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("id, handle, name, avatar_url")
        .in("id", otherIds);

      setSelectedGroupId(groupIdParam);
      setSelectedGroupName(group.name);

      for (const p of [...store.participants]) {
        if (p.id !== authUser.id) store.removeParticipant(p.id);
      }
      for (const profile of profiles ?? []) {
        store.addParticipant({
          id: profile.id,
          email: "",
          handle: profile.handle ?? "",
          name: profile.name,
          pixKeyType: "email",
          pixKeyHint: "",
          avatarUrl: profile.avatar_url ?? undefined,
          onboarded: true,
          createdAt: new Date().toISOString(),
        });
      }
    })();
  }, [step, searchParams, selectedGroupId, authUser, store]);

  // Reset payer amounts if they're stale (e.g., when total was edited after draft loading)
  useEffect(() => {
    if (step !== "payer" || !store.bill) return;
    const gt = store.getGrandTotal();
    const paid = (store.bill.payers || []).reduce((s, p) => s + p.amountCents, 0);
    if (gt > 0 && paid > 0 && Math.abs(gt - paid) > 1) {
      // Payer amounts don't match the new total — reset to equal split
      store.splitPaymentEqually(store.participants.map((p) => p.id));
    }
  }, [step, store]);

  const goNext = useCallback(async () => {
    if (step === "info") {
      if (!isEditing) {
        initBill();
      } else {
        store.updateBill({
          title: title || "Nova conta",
          merchantName: merchantName || undefined,
          serviceFeePercent: billType === "itemized" ? parseFloat(serviceFee) || 0 : 0,
          fixedFees: billType === "itemized"
            ? Math.round((parseFloat(fixedFees.replace(",", ".")) || 0) * 100)
            : 0,
        });
      }
    }
    if (step === "participants" && authUser) {
      const state = useBillStore.getState();
      if (state.bill && state.participants.length >= 2) {
        const result = await saveDraftToSupabase({
          bill: state.bill,
          participants: state.participants,
          creatorId: authUser.id,
          existingBillId: remoteBillId ?? undefined,
          groupId: selectedGroupId ?? undefined,
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
          groupId: selectedGroupId ?? undefined,
          items: draftState.items,
          splits: draftState.splits,
          billSplits: draftState.billSplits,
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
          groupId: selectedGroupId ?? undefined,
        });
        if ("billId" in result) {
          // Clear store so BillDetailPage forces a fresh DB load (not stale draft data)
          useBillStore.setState({ bill: null, items: [], splits: [], billSplits: [], ledger: [] });
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
  }, [step, stepIndex, steps, authUser, remoteBillId, selectedGroupId, allAccepted, store, router, initBill, isEditing, title, merchantName, billType, serviceFee, fixedFees]);

  const isNextDisabled = useCallback(() => {
    if (navigating || isTypeStep) return true;
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
      return !allAccepted && store.participants.length > 1 && !selectedGroupId;
    }
    return false;
  }, [navigating, isTypeStep, step, title, store, allAccepted, selectedGroupId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || tag === "SELECT") return;
      if (isNextDisabled()) return;
      e.preventDefault();
      setNavigating(true);
      goNext().finally(() => setNavigating(false));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, isNextDisabled]);

  const goBack = () => {
    if (stepIndex === 0) {
      if (isEditing && editDraftId) {
        router.push(`/app/bill/${editDraftId}`);
        return;
      }
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
            onClick={() => {
              if (isEditing && editDraftId) {
                router.push(`/app/bill/${editDraftId}`);
              } else {
                setStep("type");
                setBillType(null);
              }
            }}
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
          <h1 className="font-semibold">{isEditing ? "Editar rascunho" : "Nova conta"}</h1>
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
                <div className="mt-2 flex flex-wrap gap-2">
                  {(billType === "single_amount"
                    ? ["Airbnb", "Uber", "Assinatura", "Passagem", "Presente"]
                    : ["Restaurante", "Bar", "Mercado", "Delivery", "Festa"]
                  ).map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setTitle(suggestion)}
                      className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 hover:border-primary/50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
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
                {selectedGroupId
                  ? "Participantes do grupo selecionado."
                  : "Adicione participantes pelo @handle ou selecione um grupo."}
              </p>

              {/* Group selector — shown when no group is linked yet or one is linked */}
              <GroupSelector
                currentUserId={authUser?.id ?? ""}
                excludeIds={[]}
                selectedGroupId={selectedGroupId}
                selectedGroupName={selectedGroupName}
                onSelectGroup={(groupId, groupName, members) => {
                  setSelectedGroupId(groupId);
                  setSelectedGroupName(groupName);
                  // Clear existing non-creator participants and add group members
                  for (const p of [...store.participants]) {
                    if (p.id !== authUser?.id) store.removeParticipant(p.id);
                  }
                  for (const profile of members) {
                    if (profile.id === authUser?.id) continue;
                    store.addParticipant({
                      id: profile.id,
                      email: "",
                      handle: profile.handle,
                      name: profile.name,
                      pixKeyType: "email",
                      pixKeyHint: "",
                      avatarUrl: profile.avatarUrl,
                      onboarded: true,
                      createdAt: new Date().toISOString(),
                    });
                  }
                }}
                onDeselectGroup={() => {
                  setSelectedGroupId(null);
                  setSelectedGroupName(null);
                  // Remove all group members, keep only creator
                  for (const p of [...store.participants]) {
                    if (p.id !== authUser?.id) store.removeParticipant(p.id);
                  }
                }}
              />

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
                    ) : selectedGroupId ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Grupo</span>
                    ) : (
                      <button onClick={() => store.removeParticipant(p.id)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Individual add options — only when no group is selected */}
              {!selectedGroupId && (
                <>
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
                  {!showAddParticipant && !showRecentContacts && (
                    <div className="flex flex-col gap-2">
                      <Button variant="outline" className="w-full gap-2" onClick={() => setShowAddParticipant(true)}>
                        <UserPlus className="h-4 w-4" />
                        Por @handle
                      </Button>
                      <Button variant="outline" className="w-full gap-2" onClick={() => setShowRecentContacts(true)}>
                        <Clock className="h-4 w-4" />
                        De contas anteriores
                      </Button>
                    </div>
                  )}
                </>
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
              {remoteBillId && store.participants.length > 1 && !selectedGroupId && (
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
          if (paid > 0 && Math.abs(gt - paid) > 1) {
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
                disabled={isNextDisabled()}
              >
                {navigating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : step === "summary" ? (
                  <>
                    <QrCode className="h-4 w-4" />
                    {!allAccepted && store.participants.length > 1 && !selectedGroupId
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
