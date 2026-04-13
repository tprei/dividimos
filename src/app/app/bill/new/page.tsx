"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Loader2,
  Plus,
  QrCode,
  Receipt,
  ScanLine,
  UserPlus,
  Users,
  Users2,
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
import { VoiceExpenseButton } from "@/components/bill/voice-expense-button";
import { VoiceExpenseModal, type ResolvedParticipant } from "@/components/bill/voice-expense-modal";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import { ItemCard } from "@/components/bill/item-card";
import { PayerStep } from "@/components/bill/payer-step";
import { PayerSummaryCard } from "@/components/bill/payer-summary-card";
import { ReceiptScanner } from "@/components/bill/receipt-scanner";
import { ScanSkeletonLoader } from "@/components/bill/scan-skeleton-loader";
import { ScannedItemsReview } from "@/components/bill/scanned-items-review";
import { SingleAmountStep } from "@/components/bill/single-amount-step";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/currency";
import { useQrScannerPreload } from "@/hooks/use-qr-preload";
import { processReceiptScan, fetchSefazReceipt, SefazFallbackError } from "@/lib/process-receipt-scan";
import type { NfceQrResult } from "@/lib/nfce-qr";
import { checkDuplicateReceipt, markReceiptScanned } from "@/lib/nfce-dedup";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";
import { saveExpenseDraft, loadExpense } from "@/lib/supabase/expense-actions";
import { getOrCreateDmGroup } from "@/lib/supabase/dm-actions";
import { isContactPickerSupported, pickContacts } from "@/lib/contacts";
import { useBillStore } from "@/stores/bill-store";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import toast from "react-hot-toast";
import type { ExpenseType, User, UserProfile } from "@/types";

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
  const store = useBillStore();
  const { user: authUser } = useAuth();

  // Preload qr-scanner WASM in background so the QR tab opens fast
  useQrScannerPreload();

  const [billType, setBillType] = useState<ExpenseType | null>(null);
  const [step, setStep] = useState<Step>("type");
  const [title, setTitle] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [serviceFee, setServiceFee] = useState("10");
  const [fixedFees, setFixedFees] = useState("");
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [showAddGuest, setShowAddGuest] = useState(false);
  const [guestNameInput, setGuestNameInput] = useState("");
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
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ReceiptOcrResult | null>(null);
  const [sefazFallback, setSefazFallback] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const lastQrResultRef = useRef<NfceQrResult | null>(null);
  const [showVoiceInput, setShowVoiceInput] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceExpenseResult | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [hasContactPicker, setHasContactPicker] = useState(false);
  const [isDmMode, setIsDmMode] = useState(false);
  const dmLoadedRef = useRef(false);
  const draftEditLoadedRef = useRef(false);

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

    (async () => {
      const supabase = createClient();
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("id, handle, name, avatar_url")
        .eq("id", dmUserId)
        .single();
      if (!profile) return;

      const counterparty: User = {
        id: profile.id,
        email: "",
        handle: profile.handle ?? "",
        name: profile.name,
        pixKeyType: "email",
        pixKeyHint: "",
        avatarUrl: profile.avatar_url ?? undefined,
        onboarded: true,
        createdAt: new Date().toISOString(),

      };

      store.setCurrentUser(authUser);
      setSelectedGroupId(dmGroupId);
      setIsDmMode(true);

      if (dmType === "single_amount") {
        store.createExpenseFromDm(dmGroupId, counterparty);
        const autoTitle = `Cobrança - ${profile.name.split(" ")[0]}`;
        store.updateExpense({ title: autoTitle });
        setTitle(autoTitle);
        setBillType("single_amount");
        setStep("amount-split");
      } else {
        store.createExpense("", "itemized", undefined, dmGroupId);
        store.addParticipant(counterparty);
        setBillType("itemized");
        setStep("info");
      }
    })();
  }, [searchParams, authUser, store]);

  // Chat draft edit mode: consume ?groupId=<id>&title=<text>&amount=<cents>
  // emitted by handleEditDraft in the conversation page when a user clicks
  // "edit" on an AI-parsed expense draft. Skip when ?dm= is present so the
  // dm quick-charge handler above takes precedence.
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
    const picked = await pickContacts();
    if (!picked || picked.length === 0) return;
    for (const c of picked) {
      store.addGuest(c.name || c.phone, c.phone);
    }
  }, [store]);

  const steps = useMemo(
    () => (billType === "single_amount" ? SINGLE_STEPS : ITEMIZED_STEPS),
    [billType],
  );
  const stepIndex = steps.findIndex((s) => s.key === step);
  const isTypeStep = step === "type";

  const handleTypeSelect = (type: ExpenseType) => {
    setBillType(type);
    setStep("info");
  };

  const handleScanProcess = useCallback(async (file: File) => {
    setScanProcessing(true);
    setScanProcessingPhoto(true);
    setScanError(null);
    try {
      const result: ReceiptOcrResult = await processReceiptScan(file);
      // Show review UI instead of populating store directly
      setScanResult(result);
      setShowScanner(false);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Erro ao processar imagem");
    } finally {
      setScanProcessing(false);
      setScanProcessingPhoto(false);
    }
  }, []);

  const handleQrDetected = useCallback(async (result: NfceQrResult) => {
    setScanError(null);
    setDuplicateWarning(null);
    setScanProcessing(true);
    lastQrResultRef.current = result;

    // Check for duplicate receipt
    const previousScan = checkDuplicateReceipt(result.chaveAcesso);
    if (previousScan) {
      const date = new Date(previousScan);
      const formatted = date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      setDuplicateWarning(
        `Esta nota já foi escaneada em ${formatted}. Deseja continuar mesmo assim?`,
      );
      setScanProcessing(false);
      return;
    }

    try {
      const receipt = await fetchSefazReceipt(result.url);
      setScanResult(receipt);
      setShowScanner(false);
    } catch (err) {
      if (err instanceof SefazFallbackError) {
        // SEFAZ blocked (captcha/timeout/unparseable) — nudge user to photo
        setScanError("Não foi possível ler a nota online. Tente capturar a foto.");
        setSefazFallback(true);
        setShowScanner(true);
      } else {
        setScanError(err instanceof Error ? err.message : "Erro ao consultar SEFAZ");
      }
    } finally {
      setScanProcessing(false);
    }
  }, []);

  const handleDuplicateContinue = useCallback(async () => {
    const qrResult = lastQrResultRef.current;
    if (!qrResult) return;
    setDuplicateWarning(null);
    setScanProcessing(true);
    try {
      const receipt = await fetchSefazReceipt(qrResult.url);
      setScanResult(receipt);
      setShowScanner(false);
    } catch (err) {
      if (err instanceof SefazFallbackError) {
        setScanError("Não foi possível ler a nota online. Tente capturar a foto.");
        setSefazFallback(true);
        setShowScanner(true);
      } else {
        setScanError(err instanceof Error ? err.message : "Erro ao consultar SEFAZ");
      }
    } finally {
      setScanProcessing(false);
    }
  }, []);

  const handleScanConfirm = useCallback((result: ReceiptOcrResult) => {
    // Populate store with reviewed items
    setBillType("itemized");
    if (authUser) {
      store.setCurrentUser(authUser);
      store.createExpense(
        result.merchant || "Nota escaneada",
        "itemized",
        result.merchant || undefined,
      );
      store.updateExpense({
        serviceFeePercent: result.serviceFeePercent || 0,
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

    // Mark receipt as scanned to detect future duplicates
    if (lastQrResultRef.current) {
      markReceiptScanned(lastQrResultRef.current.chaveAcesso);
      lastQrResultRef.current = null;
    }

    setTitle(result.merchant || "Nota escaneada");
    setMerchantName(result.merchant || "");
    setServiceFee(String(result.serviceFeePercent || 0));
    setScanResult(null);
    setDuplicateWarning(null);
    setStep("participants");
  }, [authUser, store]);

  const handleScanCancel = useCallback(() => {
    setScanResult(null);
  }, []);

  const handleVoiceResult = useCallback((result: VoiceExpenseResult) => {
    setVoiceResult(result);
    setShowVoiceInput(false);
    setVoiceError(null);
  }, []);

  const handleVoiceError = useCallback((message: string) => {
    setVoiceError(message);
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
      setServiceFee("10");
    }
    setVoiceResult(null);
    setStep("participants");
  }, [authUser, store, selectedGroupId]);

  const handleVoiceCancel = useCallback(() => {
    setVoiceResult(null);
  }, []);

  // Load draft for editing when ?draft=<id> is present
  useEffect(() => {
    const draftId = searchParams.get("draft");
    if (!draftId || !authUser || editLoadedRef.current) return;

    // If store already has this draft loaded, just restore local state
    const storeState = useBillStore.getState();
    if (storeState.expense?.id === draftId) {
      editLoadedRef.current = true;
      setIsEditing(true);
      setEditDraftId(draftId);
      setBillType(storeState.expense.expenseType);
      setTitle(storeState.expense.title);
      setMerchantName(storeState.expense.merchantName ?? "");
      setServiceFee(String(storeState.expense.serviceFeePercent || 10));
      setFixedFees(storeState.expense.fixedFees ? String(storeState.expense.fixedFees / 100) : "");
      setRemoteBillId(draftId);
      setStep("participants");
      return;
    }

    (async () => {
      const loaded = await loadExpense(draftId);
      if (!loaded || editLoadedRef.current) return;
      editLoadedRef.current = true;

      // Convert loaded expense data back to store format for wizard state
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

      // Also add payers who might not be in shares
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

      // Build an Expense object the store can hold
      const expenseForStore = {
        id: loaded.id,
        groupId: loaded.groupId,
        creatorId: loaded.creatorId,
        expenseType: loaded.expenseType,
        title: loaded.title,
        merchantName: loaded.merchantName,
        status: loaded.status,
        serviceFeePercent: loaded.serviceFeePercent,
        fixedFees: loaded.fixedFees,
        totalAmount: loaded.totalAmount,
        createdAt: loaded.createdAt,
        updatedAt: loaded.updatedAt,
      };

      store.setCurrentUser(authUser);
      useBillStore.setState({
        expense: expenseForStore,
        totalAmountInput: loaded.expenseType === "single_amount" ? loaded.totalAmount : 0,
        participants,
        items: loaded.items.map((item) => ({
          ...item,
          expenseId: loaded.id,
        })),
        payers: loaded.payers.map((p) => ({ expenseId: loaded.id, userId: p.userId, amountCents: p.amountCents })),
        splits: [],
        billSplits: loaded.expenseType === "single_amount"
          ? loaded.shares.map((s) => ({
              userId: s.userId,
              splitType: "fixed" as const,
              value: s.shareAmountCents,
              computedAmountCents: s.shareAmountCents,
            }))
          : [],
      });

      // Restore local form state
      setIsEditing(true);
      setEditDraftId(draftId);
      setBillType(loaded.expenseType);
      setTitle(loaded.title);
      setMerchantName(loaded.merchantName ?? "");
      setServiceFee(String(loaded.serviceFeePercent || 10));
      setFixedFees(loaded.fixedFees ? String(loaded.fixedFees / 100) : "");
      setRemoteBillId(draftId);

      setSelectedGroupId(loaded.groupId);
      const supabase = createClient();
      const { data: group } = await supabase
        .from("groups")
        .select("name")
        .eq("id", loaded.groupId)
        .single();
      if (group) setSelectedGroupName(group.name);

      // Determine starting step based on what data exists
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
  }, [searchParams, authUser, store]);

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

  // In the expense model, all expenses belong to a group.
  // Group members are already accepted — no per-expense acceptance needed.
  const allAccepted = true;

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
      setGroupMembers((profiles ?? []).map((p) => ({
        id: p.id,
        handle: p.handle ?? "",
        name: p.name,
        avatarUrl: p.avatar_url ?? undefined,
      })));

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

  // Auto-open scanner when ?scan=true (from "Ler cupom" dashboard button)
  const scanParamRef = useRef(false);
  useEffect(() => {
    if (scanParamRef.current) return;
    if (searchParams.get("scan") && !showScanner && !scanResult) {
      scanParamRef.current = true;
      setBillType("itemized");
      setShowScanner(true);
    }
  }, [searchParams, showScanner, scanResult]);

  /** Compute expense shares from store state. Returns one entry per registered participant (excludes guests). */
  const computeShares = useCallback(() => {
    const state = useBillStore.getState();
    return state.participants.map((p) => ({
      userId: p.id,
      shareAmountCents: state.getParticipantTotal(p.id),
    }));
  }, []);

  /** Build the saveExpenseDraft params from current store state. */
  const buildDraftParams = useCallback((existingId?: string, groupIdOverride?: string) => {
    const state = useBillStore.getState();
    const effectiveGroupId = groupIdOverride ?? selectedGroupId;
    if (!state.expense || !authUser || !effectiveGroupId) return null;

    const guestData = state.guests.length > 0
      ? {
          guests: state.guests.map((g) => ({ localId: g.id, displayName: g.name })),
          guestShares: state.guests
            .map((g) => ({
              guestLocalId: g.id,
              shareAmountCents: state.getParticipantTotal(g.id),
            }))
            .filter((gs) => gs.shareAmountCents > 0),
        }
      : {};

    return {
      groupId: effectiveGroupId,
      creatorId: authUser.id,
      title: state.expense.title,
      merchantName: state.expense.merchantName,
      expenseType: state.expense.expenseType,
      totalAmount: state.payers.length > 0
        ? state.payers.reduce((s, p) => s + p.amountCents, 0)
        : state.getGrandTotal(),
      serviceFeePercent: state.expense.serviceFeePercent,
      fixedFees: state.expense.fixedFees,
      existingExpenseId: existingId,
      items: state.expense.expenseType === "itemized"
        ? state.items.map((i) => ({
            description: i.description,
            quantity: i.quantity,
            unitPriceCents: i.unitPriceCents,
            totalPriceCents: i.totalPriceCents,
          }))
        : undefined,
      shares: computeShares(),
      payers: state.payers.length > 0
        ? state.payers.map((p) => ({ userId: p.userId, amountCents: p.amountCents }))
        : undefined,
      ...guestData,
    };
  }, [authUser, selectedGroupId, computeShares]);

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
            const result = await saveExpenseDraft(params);
            if ("expenseId" in result) {
              setRemoteBillId(result.expenseId);
            }
          }
        }
      }
    }
    if ((step === "items" || step === "split" || step === "amount-split" || step === "payer") && authUser) {
      if (remoteBillId) {
        const params = buildDraftParams(remoteBillId);
        if (params) {
          await saveExpenseDraft(params);
        }
      } else if (isDmMode && selectedGroupId) {
        const params = buildDraftParams(undefined, selectedGroupId);
        if (params) {
          const result = await saveExpenseDraft(params);
          if ("expenseId" in result) {
            setRemoteBillId(result.expenseId);
          }
        }
      }
    }
    if (step === "summary") {
      if (!allAccepted && store.participants.length > 1) {
        return;
      }
      setSyncing(true);

      // Save final state as draft, then activate via RPC
      const params = buildDraftParams(remoteBillId ?? undefined);
      if (params) {
        const saveResult = await saveExpenseDraft(params);
        const expenseId = "expenseId" in saveResult
          ? saveResult.expenseId
          : remoteBillId;

        if (expenseId) {
          // Activate the expense — this transitions draft→active and updates balances
          const supabase = createClient();
          // RPC defined in migration but not yet in generated DB types — cast needed
          const { error: rpcError } = await (supabase.rpc as unknown as (fn: string, params: Record<string, unknown>) => Promise<{ error: { message: string } | null }>)(
            "activate_expense",
            { p_expense_id: expenseId },
          );

          if (!rpcError) {
            useBillStore.setState({ expense: null, items: [], splits: [], billSplits: [], payers: [] });
            router.push(`/app/bill/${expenseId}`);
            return;
          }
          console.error("Activation failed:", rpcError.message);
        }
      }
      router.push(`/app/bill/${remoteBillId || "new"}`);
      return;
    }
    let next = steps[stepIndex + 1];
    // In DM mode, skip the participants step — already pre-filled
    if (isDmMode && next?.key === "participants") {
      next = steps[stepIndex + 2];
    }
    if (next) setStep(next.key);
  }, [step, stepIndex, steps, authUser, remoteBillId, selectedGroupId, allAccepted, store, router, initBill, isEditing, isDmMode, title, merchantName, billType, serviceFee, fixedFees, buildDraftParams]);

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
      return;
    }
    // In DM single_amount mode, skip back past participants to type/close
    if (isDmMode && billType === "single_amount") {
      const prev = steps[stepIndex - 1];
      if (prev && prev.key === "participants") {
        // Skip participants — go back one more
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
              {scanResult ? (
                <ScannedItemsReview
                  result={scanResult}
                  onConfirm={handleScanConfirm}
                  onCancel={handleScanCancel}
                />
              ) : scanProcessingPhoto ? (
                <ScanSkeletonLoader />
              ) : showScanner ? (
                <div className="space-y-3">
                  <ReceiptScanner
                    key={sefazFallback ? "fallback" : "default"}
                    onProcess={handleScanProcess}
                    onBack={() => { setShowScanner(false); setScanError(null); setSefazFallback(false); }}
                    processing={scanProcessing}
                    onQrDetected={handleQrDetected}
                  />
                  {scanError && (
                    <motion.p
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-center text-sm text-destructive"
                    >
                      {scanError}
                    </motion.p>
                  )}
                  {duplicateWarning && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-center dark:border-yellow-700 dark:bg-yellow-950"
                    >
                      <p className="mb-2 text-sm text-yellow-800 dark:text-yellow-200">
                        {duplicateWarning}
                      </p>
                      <div className="flex justify-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setDuplicateWarning(null); lastQrResultRef.current = null; }}
                        >
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleDuplicateContinue}
                        >
                          Continuar mesmo assim
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </div>
              ) : voiceResult ? (
                <VoiceExpenseModal
                  result={voiceResult}
                  groupMembers={groupMembers}
                  onConfirm={handleVoiceConfirm}
                  onCancel={handleVoiceCancel}
                />
              ) : showVoiceInput ? (
                <div className="space-y-3">
                  <VoiceExpenseButton
                    members={groupMembers.map((m) => ({ handle: m.handle, name: m.name }))}
                    onResult={handleVoiceResult}
                    onError={handleVoiceError}
                  />
                  {voiceError && (
                    <motion.p
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-center text-sm text-destructive"
                    >
                      {voiceError}
                    </motion.p>
                  )}
                  <Button
                    variant="ghost"
                    className="w-full"
                    onClick={() => { setShowVoiceInput(false); setVoiceError(null); }}
                  >
                    Voltar
                  </Button>
                </div>
              ) : (
                <BillTypeSelector
                  onSelect={handleTypeSelect}
                  onScanReceipt={() => setShowScanner(true)}
                  onVoiceExpense={() => setShowVoiceInput(true)}
                />
              )}
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
              className="space-y-4"
            >
              <p className="text-sm text-muted-foreground">
                {selectedGroupId
                  ? "Participantes do grupo selecionado."
                  : "Adiciona a galera pelo @handle ou escolhe um grupo."}
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
              />

              <div className="space-y-2">
                {selectedGroupId && groupMembers.length > 0 ? (
                  <>
                    <p className="text-xs text-muted-foreground">Quem participou desta conta?</p>
                    <div
                      key={authUser?.id}
                      className="flex items-center gap-3 rounded-xl border bg-card p-3"
                    >
                      <input type="checkbox" checked disabled className="h-4 w-4 accent-primary" />
                      <UserAvatar name={authUser?.name ?? ""} avatarUrl={authUser?.avatarUrl} size="sm" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{authUser?.name}</p>
                        <p className="text-xs text-muted-foreground">@{authUser?.handle}</p>
                      </div>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Você</span>
                    </div>
                    {groupMembers.map((m) => {
                      const isChecked = store.participants.some((p) => p.id === m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            if (isChecked) {
                              store.removeParticipant(m.id);
                            } else {
                              store.addParticipant({
                                id: m.id,
                                email: "",
                                handle: m.handle,
                                name: m.name,
                                pixKeyType: "email",
                                pixKeyHint: "",
                                avatarUrl: m.avatarUrl,
                                onboarded: true,
                                createdAt: new Date().toISOString(),
                              });
                            }
                          }}
                          className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/30"
                        >
                          <input type="checkbox" checked={isChecked} readOnly className="h-4 w-4 accent-primary pointer-events-none" />
                          <UserAvatar name={m.name} avatarUrl={m.avatarUrl} size="sm" />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{m.name}</p>
                            <p className="text-xs text-muted-foreground">@{m.handle}</p>
                          </div>
                        </button>
                      );
                    })}
                  </>
                ) : (
                  store.participants.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                      <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">@{p.handle}</p>
                      </div>
                      {p.id === authUser?.id ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Você</span>
                      ) : (
                        <button onClick={() => store.removeParticipant(p.id)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>

              {store.guests.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Convidados (sem conta no Dividimos)</p>
                  {store.guests.map((g) => (
                    <div key={g.id} className="flex items-center gap-3 rounded-xl border border-dashed bg-card p-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                        {g.name.charAt(0)}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{g.name}</p>
                      </div>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Convidado</span>
                      <button onClick={() => store.removeGuest(g.id)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <AnimatePresence>
                {showAddGuest && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden rounded-2xl border border-dashed bg-card p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold">Adicionar convidado</span>
                      <button
                        onClick={() => { setShowAddGuest(false); setGuestNameInput(""); }}
                        className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      const name = guestNameInput.trim();
                      if (!name) return;
                      store.addGuest(name);
                      setGuestNameInput("");
                    }} className="flex gap-2">
                      <Input
                        type="text"
                        placeholder="Nome do convidado"
                        value={guestNameInput}
                        onChange={(e) => setGuestNameInput(e.target.value)}
                        autoFocus
                        className="flex-1"
                      />
                      <Button type="submit" size="sm" disabled={!guestNameInput.trim()}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </form>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Convidados recebem um link pra confirmar a participação depois.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Individual add options — only when no group is selected */}
              {!selectedGroupId && (
                <>
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
                  {!showAddParticipant && !showAddGuest && (
                    <div className="flex flex-col gap-2">
                      <Button variant="outline" className="w-full gap-2" onClick={() => setShowAddParticipant(true)}>
                        <UserPlus className="h-4 w-4" />
                        Por @handle
                      </Button>
                      {hasContactPicker && (
                        <Button variant="outline" className="w-full gap-2" onClick={handlePickContacts}>
                          <Users2 className="h-4 w-4" />
                          Dos contatos do celular
                        </Button>
                      )}
                      <Button variant="outline" className="w-full gap-2 border-dashed" onClick={() => setShowAddGuest(true)}>
                        <Users className="h-4 w-4" />
                        Adicionar convidado
                      </Button>
                    </div>
                  )}
                </>
              )}

              {selectedGroupId && !showAddGuest && (
                <div className="flex flex-col gap-2">
                  {hasContactPicker && (
                    <Button variant="outline" className="w-full gap-2" onClick={handlePickContacts}>
                      <Users2 className="h-4 w-4" />
                      Dos contatos do celular
                    </Button>
                  )}
                  <Button variant="outline" className="w-full gap-2 border-dashed" onClick={() => setShowAddGuest(true)}>
                    <Users className="h-4 w-4" />
                    Adicionar convidado
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
                    {store.items.length} itens — {formatBRL(store.expense?.totalAmount || 0)}
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
              {store.items.length > 0 && store.expense && store.expense.serviceFeePercent > 0 && (
                <div className="rounded-xl bg-muted/50 p-3 text-sm space-y-1">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatBRL(store.expense.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Garçom ({store.expense.serviceFeePercent}%)</span>
                    <span className="tabular-nums">{formatBRL(Math.round(store.expense.totalAmount * store.expense.serviceFeePercent / 100))}</span>
                  </div>
                  {store.expense.fixedFees > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Couvert</span>
                      <span className="tabular-nums">{formatBRL(store.expense.fixedFees)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold border-t border-border pt-1">
                    <span>Total com garçom</span>
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
                Toca nos nomes pra atribuir itens. Compartilhados são divididos igualmente.
              </p>
              <AnimatePresence>
                {store.items.map((item) => {
                  const itemSplits = store.splits
                    .filter((s) => s.itemId === item.id)
                    .map((s) => {
                      const user = store.participants.find((p) => p.id === s.userId);
                      const guest = !user ? store.guests.find((g) => g.id === s.userId) : null;
                      return { ...s, user: user ?? (guest ? { id: guest.id, name: guest.name, handle: "" } as UserProfile : undefined) };
                    });
                  return (
                    <ItemCard key={item.id} item={item} splits={itemSplits} participants={store.participants} guests={store.guests} onAssign={handleAssign} onUnassign={handleUnassign} onAssignAll={handleAssignAll} onRemove={(id) => store.removeItem(id)} />
                  );
                })}
              </AnimatePresence>
              {store.items.length > 0 && (() => {
                const unassignedItems = store.items.filter((item) => store.splits.filter((s) => s.itemId === item.id).length === 0);
                if (unassignedItems.length === 0) return null;
                const allPersonIds = [...store.participants.map((p) => p.id), ...store.guests.map((g) => g.id)];
                return (
                  <Button variant="outline" className="w-full gap-2 border-dashed border-primary/40 text-primary" onClick={() => { for (const item of unassignedItems) { store.splitItemEqually(item.id, allPersonIds); } }}>
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
                      payers={store.payers}
                      participants={store.participants}
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
                    Gerar cobranças Pix
                  </>
                ) : (
                  <>
                    Próximo
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
