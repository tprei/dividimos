"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Loader2,
  QrCode,
  ScanLine,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BillSummary } from "@/components/bill/bill-summary";
import { PayerStep } from "@/components/bill/payer-step";
import { PayerSummaryCard } from "@/components/bill/payer-summary-card";
import { SingleAmountStep } from "@/components/bill/single-amount-step";
import { ItemsStep } from "@/components/bill/wizard/items-step";
import { ParticipantsStep } from "@/components/bill/wizard/participants-step";
import { SplitStep } from "@/components/bill/wizard/split-step";
import type { ResolvedParticipant } from "@/components/bill/voice-expense-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/currency";
import { ReceiptScanner } from "@/components/bill/receipt-scanner";
import {
  parseExpenseCents,
  parseServiceFeeBasisPointsText,
  ZERO_EXPENSE_CENTS,
  ZERO_GRAPH_REVISION,
} from "@/lib/expense-money";
import { computeExpenseLineTotalCents, parseExpenseQuantity } from "@/lib/expense-quantity";
import { ScannedItemsReview } from "@/components/bill/scanned-items-review";
import { ScanSkeletonLoader } from "@/components/bill/scan-skeleton-loader";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";
import { processReceiptScan, fetchSefazReceipt, SefazFallbackError } from "@/lib/process-receipt-scan";
import type { NfceQrResult } from "@/lib/nfce-qr";
import { checkDuplicateReceipt, markReceiptScanned } from "@/lib/nfce-dedup";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import { isContactPickerSupported, pickContacts } from "@/lib/contacts";
import { saveExpenseDraft, loadExpense, resolveExpenseGraphSaveResult } from "@/lib/supabase/expense-actions";
import {
  setPendingSaveOperation,
  clearPendingSaveOperation,
  clearPendingSaveOperationIfMatches,
  peekPendingSaveOperation,
} from "@/lib/supabase/pending-save-operation";
import { userProfileRowToUserProfile } from "@/lib/supabase/expense-mappers";
import { getOrCreateDmGroup } from "@/lib/supabase/dm-actions";
import { notifyExpenseActivated } from "@/lib/push/push-notify";
import { activateExpense, loadExpenseGraphSnapshot } from "@/lib/supabase/expense-rpc";
import { useBillStore, mapLoadedGuestsForEditHydration } from "@/stores/bill-store";
import { useShallow } from "zustand/react/shallow";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import toast from "react-hot-toast";
import type { ExpenseType, User, UserProfile } from "@/types";

const TypeStep = dynamic(
  () => import("@/components/bill/wizard/type-step").then((m) => ({ default: m.TypeStep })),
  { ssr: false },
);

type Step = "type" | "info" | "participants" | "items" | "split" | "amount-split" | "payer" | "summary";

interface StepDef {
  key: Step;
  label: string;
}

const ITEMIZED_STEPS: StepDef[] = [
  { key: "info", label: "Dados" },
  { key: "participants", label: "Pessoas" },
  { key: "items", label: "Itens" },
  { key: "split", label: "Divisão" },
  { key: "payer", label: "Pagamento" },
  { key: "summary", label: "Resumo" },
];

const SINGLE_STEPS: StepDef[] = [
  { key: "info", label: "Dados" },
  { key: "participants", label: "Pessoas" },
  { key: "amount-split", label: "Divisão" },
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
  const store = useBillStore(
    useShallow((s) => ({
      expense: s.expense,
      participants: s.participants,
      guests: s.guests,
      items: s.items,
      payers: s.payers,
      splits: s.splits,
      billSplits: s.billSplits,
      draftClaimProtectedUserIds: s.draftClaimProtectedUserIds,
      totalAmountInput: s.totalAmountInput,
      setCurrentUser: s.setCurrentUser,
      createExpense: s.createExpense,
      createExpenseFromDm: s.createExpenseFromDm,
      updateExpense: s.updateExpense,
      addParticipant: s.addParticipant,
      removeParticipant: s.removeParticipant,
      addGuest: s.addGuest,
      removeGuest: s.removeGuest,
      addItem: s.addItem,
      removeItem: s.removeItem,
      hydrateFromVoice: s.hydrateFromVoice,
      splitItemEqually: s.splitItemEqually,
      unassignItem: s.unassignItem,
      splitBillByFixed: s.splitBillByFixed,
      splitBillByPercentage: s.splitBillByPercentage,
      splitBillEqually: s.splitBillEqually,
      splitPaymentEqually: s.splitPaymentEqually,
      setPayerAmount: s.setPayerAmount,
      setPayerFull: s.setPayerFull,
      removePayerEntry: s.removePayerEntry,
      getGrandTotal: s.getGrandTotal,
      wouldProduceNoEdges: s.wouldProduceNoEdges,
    })),
  );
  const { user: authUser } = useAuth();

  const [billType, setBillType] = useState<ExpenseType | null>(null);
  const [step, setStep] = useState<Step>("type");
  const [title, setTitle] = useState("");
  const [merchantName, setMerchantName] = useState("");
  // #477: default "10" is only for a genuinely fresh manual entry, where
  // it is visibly configured in the itemized info-step form. A session
  // already hydrated before this component mounted (voice/chat source via
  // group-detail-content.tsx's navigate-then-render flow) must reflect
  // that source's real fee (never a source schema field) instead of
  // silently overriding it with the manual default.
  const [serviceFee, setServiceFee] = useState(() => {
    const existing = useBillStore.getState().expense;
    return existing ? String(existing.serviceFeePercent).replace(".", ",") : "10";
  });
  const [fixedFees, setFixedFees] = useState("");
  const [navigating, setNavigating] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedGroupName, setSelectedGroupName] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<UserProfile[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraftId, setEditDraftId] = useState<string | null>(null);
  const editLoadedRef = useRef(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanProcessing, setScanProcessing] = useState(false);
  const [scanProcessingPhoto, setScanProcessingPhoto] = useState(false);
  const [pageScanResult, setPageScanResult] = useState<ReceiptOcrResult | null>(null);
  const [hasContactPicker, setHasContactPicker] = useState(false);
  const [isDmMode, setIsDmMode] = useState(false);
  const dmLoadedRef = useRef(false);
  const draftEditLoadedRef = useRef(false);
  const lastPageQrResultRef = useRef<NfceQrResult | null>(null);
  const draftRevisionRef = useRef(ZERO_GRAPH_REVISION);

  useEffect(() => {
    setHasContactPicker(isContactPickerSupported());
  }, []);

  // DM quick-charge mode: consume ?dm=<userId>&groupId=<id>&type=<expenseType>
  useEffect(() => {
    const dmUserId = searchParams.get("dm");
    const dmGroupId = searchParams.get("groupId");
    if (!dmUserId || !dmGroupId || !authUser || dmLoadedRef.current) return;
    dmLoadedRef.current = true;

    const dmType = (searchParams.get("type") as ExpenseType) || "single_amount";
    let cancelled = false;

    (async () => {
      const supabase = createClient();
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("id, handle, name, avatar_url")
        .eq("id", dmUserId)
        .single();
      // #477 Slice 5: a route change away from DM quick-charge mode while
      // this profile fetch is in flight must not still hydrate the store
      // for a departed session (DraftSessionState's "no late completion
      // may reset or navigate a departed route").
      if (cancelled || !profile) return;
      const profileMapped = userProfileRowToUserProfile(profile);

      const counterparty: User = {
        id: profileMapped.id,
        email: "",
        handle: profileMapped.handle,
        name: profileMapped.name,
        pixKeyType: "email",
        pixKeyHint: "",
        avatarUrl: profileMapped.avatarUrl,
        onboarded: true,
        createdAt: new Date().toISOString(),
      };

      const billStore = useBillStore.getState();
      billStore.setCurrentUser(authUser);
      setSelectedGroupId(dmGroupId);
      setIsDmMode(true);

      if (dmType === "single_amount") {
        billStore.createExpenseFromDm(dmGroupId, counterparty);
        const autoTitle = `Cobrança - ${profileMapped.name.split(" ")[0]}`;
        billStore.updateExpense({ title: autoTitle });
        setTitle(autoTitle);
        setBillType("single_amount");
        setStep("amount-split");
      } else {
        billStore.createExpense("", "itemized", undefined, dmGroupId);
        billStore.addParticipant(counterparty);
        setBillType("itemized");
        setStep("info");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, authUser]);

  // Chat draft edit mode: consume ?groupId=<id>&title=<text>&amount=<cents>
  useEffect(() => {
    const draftGroupId = searchParams.get("groupId");
    const draftTitle = searchParams.get("title");
    const draftAmount = searchParams.get("amount");
    const dmUserId = searchParams.get("dm");
    if (
      !draftGroupId ||
      !draftTitle ||
      !draftAmount ||
      dmUserId ||
      !authUser ||
      draftEditLoadedRef.current
    ) {
      return;
    }
    const amountCents = Number.parseInt(draftAmount, 10);
    if (!Number.isFinite(amountCents) || amountCents <= 0) return;
    draftEditLoadedRef.current = true;

    store.setCurrentUser(authUser);
    store.createExpense(draftTitle, "single_amount", undefined, draftGroupId);
    store.updateExpense({ totalAmountInput: amountCents });
    setTitle(draftTitle);
    setBillType("single_amount");
    setStep("participants");
  }, [searchParams, authUser, store]);

  const handlePickContacts = useCallback(async () => {
    const result = await pickContacts();
    if (result.status === "cancelled") return;
    if (result.status === "unsupported") {
      toast.error("Seu dispositivo não suporta escolher contatos do celular.");
      return;
    }
    if (result.status === "permission_denied") {
      toast.error("Permissão de contatos negada. Verifique as configurações do app.");
      return;
    }
    if (result.status === "error") {
      toast.error("Não foi possível abrir os contatos. Tente novamente.");
      return;
    }
    if (result.contacts.length === 0) {
      toast.error("Nenhum contato com telefone selecionado.");
      return;
    }
    for (const c of result.contacts) {
      store.addGuest(c.name || c.phone, c.phone);
    }
    toast.success(
      result.contacts.length === 1
        ? "Contato adicionado como convidado."
        : `${result.contacts.length} contatos adicionados como convidados.`,
    );
  }, [store]);

  const steps = useMemo(
    () => (billType === "single_amount" ? SINGLE_STEPS : ITEMIZED_STEPS),
    [billType],
  );
  const stepIndex = steps.findIndex((s) => s.key === step);
  const isTypeStep = step === "type";

  const handleTypeSelect = useCallback((type: ExpenseType) => {
    setBillType(type);
    setStep("info");
    setShowScanner(false);
    setPageScanResult(null);
  }, []);

  const handleScanConfirm = useCallback((result: ReceiptOcrResult) => {
    setBillType("itemized");
    if (authUser) {
      store.setCurrentUser(authUser);
      store.createExpense(
        result.merchant || "Nota escaneada",
        "itemized",
        result.merchant || undefined,
      );
      store.updateExpense({
        serviceFeePercent: (result.serviceFeeBasisPoints || 0) / 100,
      });

      for (const item of result.items) {
        store.addItem({
          description: item.description,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          totalPriceCents: item.totalCents,
        });
      }
    }

    setTitle(result.merchant || "Nota escaneada");
    setMerchantName(result.merchant || "");
    setServiceFee(String((result.serviceFeeBasisPoints || 0) / 100));
    setStep("participants");
  }, [authUser, store]);

  const handlePageScanProcess = useCallback(async (file: File) => {
    setScanProcessing(true);
    setScanProcessingPhoto(true);
    try {
      const result: ReceiptOcrResult = await processReceiptScan(file);
      setShowScanner(false);
      setPageScanResult(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao processar imagem");
    } finally {
      setScanProcessing(false);
      setScanProcessingPhoto(false);
    }
  }, []);

  const handlePageScanReviewConfirm = useCallback((result: ReceiptOcrResult) => {
    const chaveAcesso = lastPageQrResultRef.current?.chaveAcesso ?? null;
    if (chaveAcesso) {
      markReceiptScanned(chaveAcesso);
      lastPageQrResultRef.current = null;
    }
    setPageScanResult(null);
    handleScanConfirm(result);
  }, [handleScanConfirm]);

  const handlePageScanReviewCancel = useCallback(() => {
    lastPageQrResultRef.current = null;
    setPageScanResult(null);
  }, []);

  const handlePageQrDetected = useCallback(async (result: NfceQrResult) => {
    setScanProcessing(true);
    lastPageQrResultRef.current = result;

    const previousScan = checkDuplicateReceipt(result.chaveAcesso);
    if (previousScan) {
      const date = new Date(previousScan);
      const formatted = date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      toast.error(`Esta nota já foi escaneada em ${formatted}.`);
      setScanProcessing(false);
      return;
    }

    try {
      const receipt = await fetchSefazReceipt(result.url);
      setShowScanner(false);
      setPageScanResult(receipt);
    } catch (err) {
      if (err instanceof SefazFallbackError) {
        toast.error("Não foi possível ler a nota online. Tente capturar a foto.");
      } else {
        toast.error(err instanceof Error ? err.message : "Erro ao consultar SEFAZ");
      }
    } finally {
      setScanProcessing(false);
    }
  }, []);

  const handleVoiceConfirm = useCallback((result: VoiceExpenseResult, resolvedParticipants: ResolvedParticipant[]) => {
    if (!authUser) return;
    store.setCurrentUser(authUser);
    store.hydrateFromVoice(result, selectedGroupId ?? undefined);

    for (const rp of resolvedParticipants) {
      if (rp.type === "member") {
        store.addParticipant({
          id: rp.userId,
          email: "",
          handle: rp.handle,
          name: rp.name,
          pixKeyType: "email",
          pixKeyHint: "",
          avatarUrl: rp.avatarUrl,
          onboarded: true,
          createdAt: new Date().toISOString(),
        });
      } else {
        store.addGuest(rp.name);
      }
    }

    setBillType(result.expenseType);
    setTitle(result.title);
    setMerchantName(result.merchantName || "");
    if (result.expenseType === "itemized") {
      // #477: hydrateFromVoice already set the store's fee to 0 (voice
      // results carry no fee data) - mirror that here instead of
      // re-introducing the manual-entry 10% default.
      setServiceFee("0");
    }
    setStep("participants");
  }, [authUser, store, selectedGroupId]);

  // Load draft for editing when ?draft=<id> is present
  useEffect(() => {
    let cancelled = false;
    const draftId = searchParams.get("draft");
    if (!draftId || !authUser || editLoadedRef.current) return;

    const storeState = useBillStore.getState();
    if (storeState.expense?.id === draftId) {
      // #477: the store already holds this draft's editable rows from
      // an earlier mount in the same SPA session (the module-level
      // Zustand store survives client-side navigation even though
      // draftRevisionRef is a fresh per-mount ref defaulting to zero).
      // Fetching only the snapshot's graph_revision -- not re-hydrating
      // the already-correct rows -- keeps editable rows and the
      // graph-revision ref paired to the same persisted state instead
      // of silently combining current rows with a stale/zero revision
      // on the next save.
      const draftExpense = storeState.expense;
      (async () => {
        const snapshotResult = await loadExpenseGraphSnapshot(draftId);
        if (editLoadedRef.current) return;
        if (!snapshotResult || "error" in snapshotResult) {
          toast.error("Não foi possível carregar este rascunho para edição. Tente novamente.");
          return;
        }
        editLoadedRef.current = true;
        draftRevisionRef.current = snapshotResult.graphRevision;
        setIsEditing(true);
        setEditDraftId(draftId);
        setBillType(draftExpense.expenseType);
        setTitle(draftExpense.title);
        setMerchantName(draftExpense.merchantName ?? "");
        setServiceFee(String(draftExpense.serviceFeePercent));
        setFixedFees(draftExpense.fixedFees ? String(draftExpense.fixedFees / 100) : "");
        setRemoteBillId(draftId);
        setStep("participants");
      })();
      return;
    }

    (async () => {
      const [loaded, snapshotResult] = await Promise.all([
        loadExpense(draftId),
        loadExpenseGraphSnapshot(draftId),
      ]);
      // #477 Slice 5: searchParams/authUser can change (e.g. ?draft=A ->
      // ?draft=B via client-side navigation) before this in-flight load
      // resolves. Without this guard, a late-arriving load for the OLD
      // draft would silently overwrite whatever the NEW draft's own
      // effect run has since started hydrating -- exactly the "no late
      // completion may reset or navigate a departed route" case the
      // DraftSessionState spec requires.
      if (cancelled || !loaded || editLoadedRef.current) return;
      // #477/#495: the wizard cannot safely resume editing without the
      // current graph_revision -- proceeding with a stale/zero ref would
      // make the very next save fail with PST08 (stale_graph_revision).
      // load_expense_graph_snapshot is also the only loader that surfaces
      // draft_claim_protected_user_ids (loadExpense's direct table reads
      // don't), so both requirements share this one guard.
      if (!snapshotResult || "error" in snapshotResult) {
        toast.error("Não foi possível carregar este rascunho para edição. Tente novamente.");
        return;
      }
      editLoadedRef.current = true;
      draftRevisionRef.current = snapshotResult.graphRevision;
      const draftClaimProtectedUserIds = [...snapshotResult.draftClaimProtectedUserIds];

      const participants = loaded.shares.map((s) => ({
        id: s.user.id,
        email: "",
        handle: s.user.handle,
        name: s.user.name,
        pixKeyType: "email" as const,
        pixKeyHint: "",
        avatarUrl: s.user.avatarUrl,
        onboarded: true,
        createdAt: new Date().toISOString(),
      }));

      for (const p of loaded.payers) {
        if (!participants.find((u) => u.id === p.user.id)) {
          participants.push({
            id: p.user.id,
            email: "",
            handle: p.user.handle,
            name: p.user.name,
            pixKeyType: "email" as const,
            pixKeyHint: "",
            avatarUrl: p.user.avatarUrl,
            onboarded: true,
            createdAt: new Date().toISOString(),
          });
        }
      }

      const expenseForStore = {
        id: loaded.id,
        groupId: loaded.groupId,
        creatorId: loaded.creatorId,
        expenseType: loaded.expenseType,
        title: loaded.title,
        merchantName: loaded.merchantName,
        status: loaded.status,
        serviceFeePercent: loaded.serviceFeePercent,
        serviceFeeBasisPoints: loaded.serviceFeeBasisPoints,
        fixedFees: loaded.fixedFees,
        totalAmount: loaded.totalAmount,
        createdAt: loaded.createdAt,
        updatedAt: loaded.updatedAt,
      };

      useBillStore.getState().setCurrentUser(authUser);
      const { guests: guestsForStore, guestBillSplits } = mapLoadedGuestsForEditHydration(
        loaded.guests,
        loaded.expenseType,
      );

      useBillStore.getState().hydrateFromServer({
        expense: expenseForStore,
        items: loaded.items.map((item) => ({
          ...item,
          expenseId: loaded.id,
        })),
        participants,
        guests: guestsForStore,
        payers: loaded.payers.map((p) => ({ expenseId: loaded.id, userId: p.userId, amountCents: p.amountCents })),
        draftClaimProtectedUserIds,
        billSplits: loaded.expenseType === "single_amount"
          ? [
              ...loaded.shares.map((s) => ({
                userId: s.userId,
                splitType: "fixed" as const,
                value: s.shareAmountCents,
                computedAmountCents: s.shareAmountCents,
              })),
              ...guestBillSplits,
            ]
          : [],
      });

      setIsEditing(true);
      setEditDraftId(draftId);
      setBillType(loaded.expenseType);
      setTitle(loaded.title);
      setMerchantName(loaded.merchantName ?? "");
      setServiceFee(String(loaded.serviceFeePercent));
      setFixedFees(loaded.fixedFees ? String(loaded.fixedFees / 100) : "");
      setRemoteBillId(draftId);

      setSelectedGroupId(loaded.groupId);
      const supabase = createClient();
      const { data: group } = await supabase
        .from("groups")
        .select("name")
        .eq("id", loaded.groupId)
        .single();
      if (cancelled) return;
      if (group) setSelectedGroupName(group.name);

      if (loaded.payers.length > 0) {
        setStep("payer");
      } else if (loaded.expenseType === "itemized" && loaded.items.length > 0) {
        setStep("items");
      } else if (loaded.expenseType === "single_amount" && loaded.shares.length > 0) {
        setStep("amount-split");
      } else {
        setStep("participants");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, authUser]);

  const initBill = useCallback(() => {
    if (!billType || !authUser) return;
    store.setCurrentUser(authUser);
    store.createExpense(title || "Nova conta", billType, merchantName || undefined);
    if (billType === "itemized") {
      store.updateExpense({
        serviceFeePercent: parseFloat(serviceFee) || 0,
        fixedFees: Math.round((parseFloat(fixedFees.replace(",", ".")) || 0) * 100),
      });
    }
  }, [store, title, billType, merchantName, serviceFee, fixedFees, authUser]);

  const [, setSyncing] = useState(false);
  const [remoteBillId, setRemoteBillId] = useState<string | null>(null);

  const allAccepted = true;

  // Auto-select group from ?groupId URL param when entering participants step
  useEffect(() => {
    const groupIdParam = searchParams.get("groupId");
    if (!groupIdParam || selectedGroupId || step !== "participants" || !authUser) return;

    let cancelled = false;

    (async () => {
      const supabase = createClient();
      const { data: group } = await supabase
        .from("groups")
        .select("name, creator_id")
        .eq("id", groupIdParam)
        .single();
      if (cancelled || !group) return;

      const { data: acceptedMembers } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupIdParam)
        .eq("status", "accepted");
      if (cancelled) return;

      const allMemberIds = [...new Set([
        ...(acceptedMembers ?? []).map((m) => m.user_id),
        group.creator_id,
      ])];
      const otherIds = allMemberIds.filter((id) => id !== authUser.id);

      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("id, handle, name, avatar_url")
        .in("id", otherIds);
      // #477 Slice 5: groupIdParam/step/authUser can change (route
      // navigation away from the participants step, or a different group
      // selected) before this three-step async chain resolves. Without
      // this guard, a late-arriving result would still overwrite the
      // group/member selection and mutate participants -- exactly the
      // "no late completion may reset or navigate a departed route" case
      // the DraftSessionState spec requires.
      if (cancelled) return;

      setSelectedGroupId(groupIdParam);
      setSelectedGroupName(group.name);
      setGroupMembers((profiles ?? []).map(userProfileRowToUserProfile));

      const billStore = useBillStore.getState();
      for (const p of [...billStore.participants]) {
        if (p.id !== authUser.id) billStore.removeParticipant(p.id);
      }
      for (const row of profiles ?? []) {
        const mapped = userProfileRowToUserProfile(row);
        billStore.addParticipant({
          id: mapped.id,
          email: "",
          handle: mapped.handle,
          name: mapped.name,
          pixKeyType: "email",
          pixKeyHint: "",
          avatarUrl: mapped.avatarUrl,
          onboarded: true,
          createdAt: new Date().toISOString(),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, searchParams, selectedGroupId, authUser]);

  const voiceStepRef = useRef(false);
  useEffect(() => {
    const stepParam = searchParams.get("step");
    if (!stepParam || voiceStepRef.current) return;
    if (stepParam !== "payer" && stepParam !== "participants") return;
    const storeState = useBillStore.getState();
    if (storeState.expense) {
      voiceStepRef.current = true;
      setBillType(storeState.expense.expenseType);
      setTitle(storeState.expense.title);
      setMerchantName(storeState.expense.merchantName ?? "");
      setStep("participants");
    }
  }, [searchParams]);

  // Durable save-operation wrapper: persists to localStorage before the RPC
  // call and clears after, enabling crash/restart recovery (#477 Slice 5).
  const durableSaveDraft = useCallback(
    async (params: Parameters<typeof saveExpenseDraft>[0]) => {
      setPendingSaveOperation(params.saveOperationId, params.groupId);
      const result = await saveExpenseDraft(params);
      // Only a definitive server response -- success or a typed
      // rejection -- proves this attempt is resolved; clear the durable
      // record here. A thrown transport failure means the response was
      // lost, not that the request failed: leaving the record intact
      // lets the mount-time reconciliation effect (or a later retry)
      // resolve it via resolveExpenseGraphSaveResult instead of silently
      // discarding recovery data for exactly the "response loss" case
      // it exists to protect (#477 Slice 5). A `finally` here would have
      // cleared it unconditionally, including on throw.
      clearPendingSaveOperation();
      return result;
    },
    [],
  );

  // Mount-time reconciliation: if a previous save response was lost (crash,
  // tab close, network error), resolve the pending operation to recover
  // the expense ID without a duplicate save.
  //
  // #477 Slice 5: a "committed" result must not just poison remoteBillId
  // in place. This effect runs on mount, before the user has typed
  // anything into what looks like a blank wizard. Silently setting
  // remoteBillId/draftRevisionRef here made every *subsequent* save in
  // that session -- for a completely unrelated new draft the user was
  // about to create -- a replacement save against the recovered expense's
  // ID instead of a new-expense creation, silently overwriting the
  // recovered draft's content with unrelated data the user never
  // reviewed. Redirect into the existing, already race-hardened
  // ?draft=<id> edit-load flow instead, so the recovered draft is fully
  // hydrated and visible before the user can act on it.
  useEffect(() => {
    const pending = peekPendingSaveOperation();
    if (!pending) return;
    resolveExpenseGraphSaveResult(pending.operationId, pending.groupId)
      .then((result) => {
        // #477 Slice 5: only clear the durable record once resolution
        // returns a terminal outcome. A null result means the operation
        // hasn't reached the server yet (or this lookup itself failed) --
        // leaving the entry in place lets a later mount retry resolution
        // instead of permanently losing recovery for an in-flight save.
        if (result?.outcome === "committed") {
          clearPendingSaveOperationIfMatches(pending.operationId);
          // #477 Slice 5: redirect into the existing, already race-hardened
          // ?draft=<id> edit-load flow instead of silently setting
          // remoteBillId/draftRevisionRef in place. This effect runs on
          // mount, before the user has typed anything into what looks like
          // a blank wizard -- silently poisoning remoteBillId here made
          // every *subsequent* save in that session, for a completely
          // unrelated new draft the user was about to create, a
          // replacement save against the recovered expense's ID instead of
          // a new-expense creation, silently overwriting the recovered
          // draft's content with unrelated data the user never reviewed.
          if (searchParams.get("draft") !== result.expenseId) {
            router.push(`/app/bill/new?draft=${result.expenseId}`);
          }
        } else if (result?.outcome === "retired") {
          clearPendingSaveOperationIfMatches(pending.operationId);
        }
      })
      .catch(() => {});
  }, [router, searchParams]);

  const buildDraftParams = useCallback((existingId?: string, groupIdOverride?: string) => {
    const state = useBillStore.getState();
    const effectiveGroupId = groupIdOverride ?? selectedGroupId;
    if (!state.expense || !authUser || !effectiveGroupId) return null;

    const serviceFeeResult = parseServiceFeeBasisPointsText(
      state.expense.expenseType === "itemized"
        ? serviceFee || String(state.expense.serviceFeePercent).replace(".", ",")
        : "0",
    );
    const fixedFeeResult =
      state.expense.expenseType === "itemized"
        ? parseExpenseCents(state.expense.fixedFees, "allow")
        : { ok: true as const, value: ZERO_EXPENSE_CENTS };
    const totalResult = parseExpenseCents(state.getGrandTotal(), "allow");
    if (!serviceFeeResult.ok || !fixedFeeResult.ok || !totalResult.ok) return null;

    const normalizedItems = [];
    if (state.expense.expenseType === "itemized") {
      for (const item of state.items) {
        const quantity = parseExpenseQuantity(item.quantity);
        const unitPriceCents = parseExpenseCents(item.unitPriceCents, "positive");
        const suppliedTotal = parseExpenseCents(item.totalPriceCents, "positive");
        if (!quantity.ok || !unitPriceCents.ok || !suppliedTotal.ok) return null;
        const computedTotal = computeExpenseLineTotalCents(quantity.value, unitPriceCents.value);
        if (!computedTotal.ok || computedTotal.value !== suppliedTotal.value) return null;
        normalizedItems.push({
          description: item.description,
          quantity: quantity.value,
          unitPriceCents: unitPriceCents.value,
          totalPriceCents: suppliedTotal.value,
        });
      }
    }

    const shares = [];
    for (const participant of state.participants) {
      const shareAmountCents = parseExpenseCents(
        state.getParticipantTotal(participant.id),
        "allow",
      );
      if (!shareAmountCents.ok) return null;
      shares.push({ userId: participant.id, shareAmountCents: shareAmountCents.value });
    }

    const payers = [];
    for (const payer of state.payers) {
      const amountCents = parseExpenseCents(payer.amountCents, "positive");
      if (!amountCents.ok) return null;
      payers.push({ userId: payer.userId, amountCents: amountCents.value });
    }

    const guests = state.guests.map((guest) => ({
      localId: guest.id,
      displayName: guest.name,
    }));
    const guestShares = [];
    for (const guest of state.guests) {
      const shareAmountCents = parseExpenseCents(
        state.getParticipantTotal(guest.id),
        "allow",
      );
      if (!shareAmountCents.ok) return null;
      guestShares.push({ guestLocalId: guest.id, shareAmountCents: shareAmountCents.value });
    }

    // Each save attempt is a distinct logical write; a fresh operation id
    // keeps the idempotency ledger from replaying a stale canonical request
    // (and rejecting the new one with operation_conflict) across steps.
    const saveOperationId = crypto.randomUUID();

    return {
      groupId: effectiveGroupId,
      title: state.expense.title,
      merchantName: state.expense.merchantName,
      expenseType: state.expense.expenseType,
      totalAmountCents: totalResult.value,
      serviceFeeBasisPoints: serviceFeeResult.value,
      fixedFeesCents: fixedFeeResult.value,
      existingExpenseId: existingId,
      items: normalizedItems,
      shares,
      payers,
      guests,
      guestShares,
      expectedGraphRevision: draftRevisionRef.current,
      saveOperationId,
    };
  }, [authUser, selectedGroupId, serviceFee]);

  const goNext = useCallback(async () => {
    if (step === "info") {
      if (!isEditing && !isDmMode) {
        initBill();
      } else {
        store.updateExpense({
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
      let groupId = selectedGroupId;

      if (!groupId) {
        const state = useBillStore.getState();
        const otherParticipants = state.participants.filter((p) => p.id !== authUser.id);
        const hasGuests = state.guests.length > 0;

        if (otherParticipants.length === 1 && !hasGuests) {
          const dmResult = await getOrCreateDmGroup(otherParticipants[0].id);
          if ("error" in dmResult) {
            toast.error("Não foi possível iniciar a conversa. Tente novamente.");
            return;
          }
          groupId = dmResult.groupId;
          setSelectedGroupId(dmResult.groupId);
          setSelectedGroupName("");
        } else {
          const supabase = createClient();
          const names = [
            ...state.participants.map((p) => p.name.split(" ")[0]),
            ...state.guests.map((g) => g.name.split(" ")[0]),
          ];
          const groupName = names.length <= 3
            ? names.join(" e ")
            : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;

          const { data: group } = await supabase
            .from("groups")
            .insert({ name: groupName, creator_id: authUser.id })
            .select("id")
            .single();

          if (group) {
            if (otherParticipants.length > 0) {
              await supabase.from("group_members").insert(
                otherParticipants.map((p) => ({
                  group_id: group.id,
                  user_id: p.id,
                  invited_by: authUser.id,
                  status: "invited" as const,
                })),
              );
            }
            groupId = group.id;
            setSelectedGroupId(group.id);
            setSelectedGroupName(groupName);
          }
        }
      }

      if (groupId) {
        const state = useBillStore.getState();
        if (state.expense && state.participants.length >= 2) {
          const params = buildDraftParams(remoteBillId ?? undefined, groupId);
          if (params) {
            const result = await durableSaveDraft(params);
            if ("expenseId" in result) {
              setRemoteBillId(result.expenseId);
              draftRevisionRef.current = result.graphRevision;
            } else {
              toast.error(result.error);
              return;
            }
          }
        }
      }
    }
    if ((step === "items" || step === "split" || step === "amount-split" || step === "payer") && authUser) {
      if (remoteBillId) {
        const params = buildDraftParams(remoteBillId);
        if (params) {
          const result = await durableSaveDraft(params);
          if ("expenseId" in result) {
            draftRevisionRef.current = result.graphRevision;
          } else {
            toast.error(result.error);
            return;
          }
        }
      } else if (isDmMode && selectedGroupId) {
        const params = buildDraftParams(undefined, selectedGroupId);
        if (params) {
          const result = await durableSaveDraft(params);
          if ("expenseId" in result) {
            setRemoteBillId(result.expenseId);
            draftRevisionRef.current = result.graphRevision;
          } else {
            toast.error(result.error);
            return;
          }
        }
      }
    }
    if (step === "summary") {
      if (!allAccepted && store.participants.length > 1) {
        return;
      }
      setSyncing(true);

      const params = buildDraftParams(remoteBillId ?? undefined);
      if (params) {
        const saveResult = await durableSaveDraft(params);
        if (!("expenseId" in saveResult)) {
          toast.error(saveResult.error);
          setSyncing(false);
          return;
        }
        const expenseId = saveResult.expenseId;
        draftRevisionRef.current = saveResult.graphRevision;

        const activationResult = await activateExpense({
          expense_id: expenseId,
          expectedGraphRevision: draftRevisionRef.current,
        });

        if (!("error" in activationResult)) {
          notifyExpenseActivated(expenseId).catch(() => {});
          useBillStore.getState().reset();
          router.push(`/app/bill/${expenseId}`);
          return;
        }
        toast.error(activationResult.error);
        setSyncing(false);
        return;
      }
      setSyncing(false);
      return;
    }
    let next = steps[stepIndex + 1];
    if (isDmMode && next?.key === "participants") {
      next = steps[stepIndex + 2];
    }
    if (next) setStep(next.key);
  }, [step, stepIndex, steps, authUser, remoteBillId, selectedGroupId, allAccepted, store, router, initBill, isEditing, isDmMode, title, merchantName, billType, serviceFee, fixedFees, buildDraftParams, durableSaveDraft]);

  const isNextDisabled = useCallback(() => {
    if (navigating || isTypeStep) return true;
    if (step === "info") return !title.trim();
    if (step === "participants") return (store.participants.length + store.guests.length) < 2;
    if (step === "amount-split") {
      const total = store.totalAmountInput || 0;
      if (total <= 0) return true;
      const assigned = store.billSplits.reduce((s, bs) => s + bs.computedAmountCents, 0);
      return Math.abs(total - assigned) > 1;
    }
    if (step === "payer") {
      const gt = store.getGrandTotal();
      const paid = store.payers.reduce((s, p) => s + p.amountCents, 0);
      return gt <= 0 || Math.abs(gt - paid) > 1;
    }
    if (step === "summary") return store.wouldProduceNoEdges();
    return false;
  }, [navigating, isTypeStep, step, title, store]);

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
      if (isDmMode && selectedGroupId) {
        router.push(`/app/chat/${selectedGroupId}`);
        return;
      }
      if (isEditing && editDraftId) {
        router.push(`/app/bill/${editDraftId}`);
        return;
      }
      setStep("type");
      setBillType(null);
      setShowScanner(false);
      setPageScanResult(null);
      return;
    }
    if (isDmMode && billType === "single_amount") {
      const prev = steps[stepIndex - 1];
      if (prev && prev.key === "participants") {
        const prevPrev = steps[stepIndex - 2];
        if (prevPrev) {
          setStep(prevPrev.key);
        } else {
          router.push(`/app/chat/${selectedGroupId}`);
        }
        return;
      }
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
    const allPersonIds = [...store.participants.map((p) => p.id), ...store.guests.map((g) => g.id)];
    const currentSplits = store.splits.filter((s) => s.itemId === itemId);
    const allAssigned = currentSplits.length === allPersonIds.length;
    if (allAssigned) {
      for (const id of allPersonIds) {
        store.unassignItem(itemId, id);
      }
    } else {
      store.splitItemEqually(itemId, allPersonIds);
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
              if (isDmMode && selectedGroupId) {
                router.push(`/app/chat/${selectedGroupId}`);
              } else if (isEditing && editDraftId) {
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
          <h1 className="font-semibold">{isEditing ? "Editar rascunho" : isDmMode ? "Cobrar" : "Nova conta"}</h1>
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
              <TypeStep
                groupMembers={groupMembers}
                onTypeSelect={handleTypeSelect}
                onScanConfirm={handleScanConfirm}
                onVoiceConfirm={handleVoiceConfirm}
              />
            </motion.div>
          )}

          {step === "info" && pageScanResult && (
            <motion.div
              key="info-scan-review"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <ScannedItemsReview
                result={pageScanResult}
                onConfirm={handlePageScanReviewConfirm}
                onCancel={handlePageScanReviewCancel}
              />
            </motion.div>
          )}

          {step === "info" && scanProcessingPhoto && !pageScanResult && (
            <motion.div
              key="info-scan-skeleton"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <ScanSkeletonLoader />
            </motion.div>
          )}

          {step === "info" && showScanner && !scanProcessingPhoto && !pageScanResult && (
            <motion.div
              key="info-scanner"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-3"
            >
              <ReceiptScanner
                onProcess={handlePageScanProcess}
                onQrDetected={handlePageQrDetected}
                onBack={() => setShowScanner(false)}
                processing={scanProcessing}
              />
            </motion.div>
          )}

          {step === "info" && !showScanner && !scanProcessingPhoto && !pageScanResult && (
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
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(billType === "single_amount"
                    ? ["Airbnb", "Uber", "Presente", "Mercado", "Aluguel"]
                    : ["Bar", "Restaurante", "Churrasco", "Pizza", "Lanchonete"]
                  ).map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
                      onClick={() => setTitle(suggestion)}
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
                        Taxa de serviço (%)
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
                    <Button variant="outline" className="mt-3 w-full gap-2" onClick={() => setShowScanner(true)}>
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
            >
              <ParticipantsStep
                authUser={authUser}
                participants={store.participants}
                guests={store.guests}
                protectedUserIds={store.draftClaimProtectedUserIds}
                selectedGroupId={selectedGroupId}
                selectedGroupName={selectedGroupName}
                groupMembers={groupMembers}
                hasContactPicker={hasContactPicker}
                onSelectGroup={(groupId, groupName, members) => {
                  setSelectedGroupId(groupId);
                  setSelectedGroupName(groupName);
                  setGroupMembers(members);
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
                  setGroupMembers([]);
                  for (const p of [...store.participants]) {
                    if (p.id !== authUser?.id) store.removeParticipant(p.id);
                  }
                }}
                onAddParticipant={(user) => store.addParticipant(user)}
                onRemoveParticipant={(id) => store.removeParticipant(id)}
                onAddGuest={(name, phone) => store.addGuest(name, phone)}
                onRemoveGuest={(id) => store.removeGuest(id)}
                onPickContacts={handlePickContacts}
              />
            </motion.div>
          )}

          {step === "items" && (
            <motion.div
              key="items"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <ItemsStep
                items={store.items}
                expense={store.expense}
                grandTotal={store.getGrandTotal()}
                onAddItem={(item) => store.addItem(item)}
                onRemoveItem={(id) => store.removeItem(id)}
              />
            </motion.div>
          )}

          {step === "split" && (
            <motion.div
              key="split"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <SplitStep
                items={store.items}
                splits={store.splits}
                participants={store.participants}
                guests={store.guests}
                onAssign={handleAssign}
                onUnassign={handleUnassign}
                onAssignAll={handleAssignAll}
                onRemoveItem={(id) => store.removeItem(id)}
                onSplitItemEqually={(itemId, userIds) => store.splitItemEqually(itemId, userIds)}
              />
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
                guests={store.guests}
                totalAmountInput={store.totalAmountInput || 0}
                onSetTotal={(cents) => store.updateExpense({ totalAmountInput: cents, totalAmount: cents })}
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
                payers={store.payers}
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
              {store.expense && (
                <>
                  <BillSummary
                    expense={{
                      expenseType: store.expense.expenseType,
                      totalAmount: store.getGrandTotal(),
                      serviceFeePercent: store.expense.serviceFeePercent,
                      fixedFees: store.expense.fixedFees,
                    }}
                    items={store.items}
                    itemSplits={store.splits}
                    shares={store.billSplits.map((bs) => ({
                      userId: bs.userId,
                      shareAmountCents: bs.computedAmountCents,
                      splitLabel: bs.splitType === "percentage"
                        ? `${bs.value.toFixed(1)}%`
                        : bs.splitType === "equal"
                          ? "igual"
                          : undefined,
                    }))}
                    participants={store.participants}
                    guests={store.guests}
                  />
                  {store.payers.length > 0 && (
                    <PayerSummaryCard
                      payers={store.payers.flatMap((payer) => {
                        const user = store.participants.find((p) => p.id === payer.userId);
                        return user ? [{ user, amountCents: payer.amountCents }] : [];
                      })}
                    />
                  )}
                  {store.wouldProduceNoEdges() && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-700 dark:bg-yellow-950"
                    >
                      <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                        Essa conta não gera nenhuma cobrança
                      </p>
                      <p className="mt-1 text-xs text-yellow-700 dark:text-yellow-300">
                        Cada pessoa já pagou exatamente o que consumiu. Volte e ajuste a divisão ou os pagadores para que alguém fique devendo.
                      </p>
                    </motion.div>
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!isTypeStep && (() => {
        let errorMsg: string | null = null;
        if (step === "participants" && (store.participants.length + store.guests.length) < 2) {
          errorMsg = "Adicione pelo menos uma pessoa para dividir a conta";
        } else if (step === "amount-split") {
          const total = store.totalAmountInput || 0;
          const assigned = store.billSplits.reduce((s, bs) => s + bs.computedAmountCents, 0);
          if (total <= 0) {
            errorMsg = "Informe o valor total da conta";
          } else if (Math.abs(total - assigned) > 1) {
            errorMsg = `A divisão (${formatBRL(assigned)}) não bate com o total (${formatBRL(total)})`;
          }
        } else if (step === "payer") {
          const gt = store.getGrandTotal();
          const paid = store.payers.reduce((s, p) => s + p.amountCents, 0);
          if (paid > 0 && gt > 0 && Math.abs(gt - paid) > 1) {
            errorMsg = `O pagamento (${formatBRL(paid)}) não bate com o total (${formatBRL(gt)})`;
          }
        } else if (step === "summary" && store.wouldProduceNoEdges()) {
          errorMsg = "Nenhuma dívida será gerada — quem pagou já consumiu tudo que pagou. Ajuste a divisão ou os pagadores.";
        }
        const isSummary = step === "summary";
        return (
          <div className="mt-6">
            {errorMsg && (
              <p className="mb-2 text-center text-xs text-destructive">{errorMsg}</p>
            )}
            {isSummary ? (
              <div className="flex flex-col gap-3">
                <Button
                  onClick={async () => {
                    setNavigating(true);
                    try {
                      await goNext();
                    } finally {
                      setNavigating(false);
                    }
                  }}
                  className="w-full h-12 gap-2 text-base font-semibold"
                  disabled={isNextDisabled()}
                >
                  {navigating ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <QrCode className="h-5 w-5" />
                      Gerar cobranças Pix
                    </>
                  )}
                </Button>
                <Button variant="ghost" onClick={goBack} className="gap-1 text-muted-foreground" disabled={navigating}>
                  <ArrowLeft className="h-4 w-4" />
                  Voltar
                </Button>
              </div>
            ) : (
              <div className="flex gap-3">
                <Button variant="ghost" onClick={goBack} className="gap-1 text-muted-foreground h-10" disabled={navigating}>
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
                  className="flex-1 gap-2 h-10 text-base font-medium"
                  disabled={isNextDisabled()}
                >
                  {navigating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Próximo
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
