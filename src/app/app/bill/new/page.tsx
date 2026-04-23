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
import { ScannedItemsReview } from "@/components/bill/scanned-items-review";
import { ScanSkeletonLoader } from "@/components/bill/scan-skeleton-loader";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";
import { processReceiptScan, fetchSefazReceipt, SefazFallbackError } from "@/lib/process-receipt-scan";
import type { NfceQrResult } from "@/lib/nfce-qr";
import { checkDuplicateReceipt, markReceiptScanned } from "@/lib/nfce-dedup";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import { isContactPickerSupported, pickContacts } from "@/lib/contacts";
import { saveExpenseDraft, loadExpense } from "@/lib/supabase/expense-actions";
import { getOrCreateDmGroup } from "@/lib/supabase/dm-actions";
import { notifyExpenseActivated } from "@/lib/push/push-notify";
import { useBillStore } from "@/stores/bill-store";
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
  const store = useBillStore();
  const { user: authUser } = useAuth();

  const [billType, setBillType] = useState<ExpenseType | null>(null);
  const [step, setStep] = useState<Step>("type");
  const [title, setTitle] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [serviceFee, setServiceFee] = useState("10");
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

    setTitle(result.merchant || "Nota escaneada");
    setMerchantName(result.merchant || "");
    setServiceFee(String(result.serviceFeePercent || 0));
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
      setServiceFee("10");
    }
    setStep("participants");
  }, [authUser, store, selectedGroupId]);

  // Load draft for editing when ?draft=<id> is present
  useEffect(() => {
    const draftId = searchParams.get("draft");
    if (!draftId || !authUser || editLoadedRef.current) return;

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

  const computeShares = useCallback(() => {
    const state = useBillStore.getState();
    return state.participants.map((p) => ({
      userId: p.id,
      shareAmountCents: state.getParticipantTotal(p.id),
    }));
  }, []);

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

      const params = buildDraftParams(remoteBillId ?? undefined);
      if (params) {
        const saveResult = await saveExpenseDraft(params);
        const expenseId = "expenseId" in saveResult
          ? saveResult.expenseId
          : remoteBillId;

        if (expenseId) {
          const supabase = createClient();
          const { error: rpcError } = await (supabase.rpc as unknown as (fn: string, params: Record<string, unknown>) => Promise<{ error: { message: string } | null }>)(
            "activate_expense",
            { p_expense_id: expenseId },
          );

          if (!rpcError) {
            notifyExpenseActivated(expenseId).catch(() => {});
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
