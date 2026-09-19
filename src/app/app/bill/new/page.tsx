"use client";

import { X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { ItemizedBillForm, type ItemizedSectionKey } from "@/components/bill/itemized-bill-form";
import { ParticipantsDialog } from "@/components/bill/itemized/participants-dialog";
import { SingleBillForm } from "@/components/bill/single-bill-form";
import type { ResolvedParticipant } from "@/components/bill/voice-expense-modal";
import type { ItemDivisionParticipant } from "@/components/bill/item-division-editor";
import { ScanSkeletonLoader } from "@/components/bill/scan-skeleton-loader";
import { ReplaceDraftDialog } from "@/components/bill/wizard/replace-draft-dialog";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import { isContactPickerSupported, pickContacts } from "@/lib/contacts";
import { hasMeaningfulDraft } from "@/lib/bill-draft";
import { DraftResumeBanner } from "@/components/bill/wizard/draft-resume-banner";
import {
  DiscardDraftDialog,
  type DiscardDraftMode,
} from "@/components/bill/wizard/discard-draft-dialog";
import {
  clearDraftIntent,
  readDraftIntent,
  writeDraftIntent,
} from "@/lib/draft-intent";
import { refreshExpense } from "@/lib/sync/refresh";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { useBillStore } from "@/stores/bill-store";
import { expenseReadKey, IDLE_READ, useAppStore } from "@/stores/app-store";
import { useShallow } from "zustand/react/shallow";
import { useMe } from "@/hooks/use-me";
import { useConfirmationPreferences } from "@/hooks/use-confirmation-preferences";
import { useClientOnly, useMounted } from "@/hooks/use-client-only";
import { meToLegacyUser } from "@/hooks/use-auth";
import toast from "react-hot-toast";
import type { ExpenseDetail, GroupSnapshot } from "@/types/ledger";
import { ExpenseConflictPanel } from "@/components/bill/wizard/expense-conflict-panel";
import type { ExpenseType, User } from "@/types";
import { ensureDraftOwnedBy, selectDraftForType, useWizardInit } from "./use-wizard-init";
import {
} from "@/lib/bill-draft-isolation";
import { parseWizardModes, type Step } from "./wizard-modes";
import { planGroup, todayIsoDate, useWizardSubmit } from "./use-wizard-submit";
import { buildScanDraftCandidate, type ScanDraftCandidate } from "./scan-replacement";
import { commitScanReplacement } from "./scan-commit";
import {
  profileToUser,
  useScanDraftContext,
} from "./use-scan-draft-context";
import { useAssignmentRoomEntry } from "./use-assignment-room-entry";

const TypeStep = dynamic(
  () => import("@/components/bill/wizard/type-step").then((m) => ({ default: m.TypeStep })),
  { ssr: false },
);

type ExpenseConflict =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; detail: ExpenseDetail }
  | { status: "error" };
function itemizedSectionFor(step: Step): ItemizedSectionKey {
  if (step === "items") return "items";
  if (step === "split" || step === "participants") return "split";
  if (step === "payer") return "payment";
  if (step === "summary") return "review";
  return "account";
}

interface PreConfirmSnapshot {
  expenseId: string;
  itemCount: number;
  totalCents: number;
  draftTitle: string;
}

function NewBillPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modes = useMemo(() => parseWizardModes(searchParams), [searchParams]);
  const editRead = useAppStore((s) =>
    modes.editExpenseId ? (s.reads[expenseReadKey(modes.editExpenseId)] ?? IDLE_READ) : IDLE_READ,
  );
  const me = useMe();

  const store = useBillStore(
    useShallow((s) => ({
      expense: s.expense,
      totalAmountInput: s.totalAmountInput,
      participants: s.participants,
      guests: s.guests,
      items: s.items,
      payers: s.payers,
      splits: s.splits,
      billSplits: s.billSplits,
      occurredOn: s.occurredOn,
      receiptAccessKey: s.receiptAccessKey,
    })),
  );

  const groups = useAppStore((s) => s.groups);
  const groupOrder = useAppStore(useShallow((s) => s.groupOrder));
  const editDetail = useAppStore((s) =>
    modes.editExpenseId ? s.expenseDetails[modes.editExpenseId] ?? null : null,
  );

  const [billType, setBillType] = useState<ExpenseType | null>(null);
  const [step, setStep] = useState<Step>("type");
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [createGroupEnabled, setCreateGroupEnabled] = useState(true);
  const [createGroupName, setCreateGroupName] = useState("");
  const mounted = useMounted();
  const hasContactPicker = useClientOnly(isContactPickerSupported);
  const [isDmMode, setIsDmMode] = useState(false);
  const [reviewingScan, setReviewingScan] = useState(false);
  const [reviewClearSignal, setReviewClearSignal] = useState(0);
  const [pendingCandidate, setPendingCandidate] = useState<ScanDraftCandidate | null>(null);
  const [preConfirmSnapshot, setPreConfirmSnapshot] = useState<PreConfirmSnapshot | null>(null);
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);
  const [confirmations, updateConfirmations] = useConfirmationPreferences(me?.id ?? "");
  const [resumedEditExpenseId, setResumedEditExpenseId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ExpenseConflict>({ status: "none" });
  const [editBaseVersionNo, setEditBaseVersionNo] = useState<number | null>(null);
  const [dismissedThisMount, setDismissedThisMount] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [discardDialogMode, setDiscardDialogMode] = useState<DiscardDraftMode>("type-switch");
  const [pendingType, setPendingType] = useState<ExpenseType | null>(null);
  const [pendingVoice, setPendingVoice] = useState<{
    result: VoiceExpenseResult;
    resolvedParticipants: ResolvedParticipant[];
  } | null>(null);

  const selectedGroupId = store.expense ? (store.expense.groupId || null) : pendingGroupId;

  const handleSelectGroup = useCallback(
    (groupId: string | null) => {
      const billStore = useBillStore.getState();
      if (billStore.expense) {
        billStore.updateExpense({ groupId: groupId ?? "" });
        setPendingGroupId(null);
      } else {
        setPendingGroupId(groupId);
      }
      for (const p of [...billStore.participants]) {
        if (p.id !== me?.id) billStore.removeParticipant(p.id);
      }
      if (!groupId || !me) return;
      const snapshot = useAppStore.getState().groups[groupId];
      if (!snapshot) return;
      for (const member of snapshot.members) {
        if (member.userId === me.id || member.status !== "accepted") continue;
        billStore.addParticipant(profileToUser(member.user));
      }
    },
    [me],
  );

  const {
    scanDraftContext,
    setScanDraftContext,
    onSelectGroup: onScanSelectGroup,
    onAddParticipant: onScanAddParticipant,
    onRemoveParticipant: onScanRemoveParticipant,
    onAddGuest: onScanAddGuest,
    onRemoveGuest: onScanRemoveGuest,
    addGuestContacts,
  } = useScanDraftContext({
    me,
    reviewingScan,
    onSelectGroupDefault: handleSelectGroup,
  });

  // Derived, not stored: until an accept/intent write pins it, the edit base is
  // simply whatever version the wizard loaded.
  const effectiveBaseVersionNo =
    editBaseVersionNo ?? editDetail?.expense.currentVersionNo ?? null;

  useWizardInit({
    modes,
    me,
    step,
    onSetPendingGroupId: setPendingGroupId,
    onSetBillType: setBillType,
    onSetStep: setStep,
    onSetIsEditing: setIsEditing,
    onSetIsDmMode: setIsDmMode,
  });

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
    addGuestContacts(result.contacts);
    toast.success(
      result.contacts.length === 1
        ? "Contato adicionado como convidado."
        : `${result.contacts.length} contatos adicionados como convidados.`,
    );
  }, [addGuestContacts]);

  const isTypeStep = step === "type";
  const isSingleFlow =
    !isTypeStep &&
    (store.expense?.expenseType === "single_amount" || billType === "single_amount");
  const groupSnapshots = useMemo(
    () =>
      groupOrder
        .map((id) => groups[id])
        .filter((g): g is GroupSnapshot => !!g && g.group.kind === "group"),
    [groupOrder, groups],
  );
  const selectedGroup = selectedGroupId ? groups[selectedGroupId] ?? null : null;
  const scanGroup = selectedGroup ?? (
    modes.entryGroupId ? groups[modes.entryGroupId] ?? null : null
  );
  const assignmentRoomEntry = useAssignmentRoomEntry({
    host: me ? { id: me.id, name: me.name } : null,
    groupId: scanDraftContext?.groupId ?? scanGroup?.group.id ?? null,
  });
  const activeParticipants = reviewingScan && scanDraftContext ? scanDraftContext.participants : store.participants;
  const activeGuests = reviewingScan && scanDraftContext ? scanDraftContext.guests : store.guests;
  const scanParticipants = useMemo<ItemDivisionParticipant[]>(() => {
    if (!me) return [];
    const others = activeParticipants.filter((participant) => participant.id !== me.id);
    return [
      { id: me.id, name: me.name, handle: me.handle, avatarUrl: me.avatarUrl ?? null, isGuest: false },
      ...others.map((participant) => ({
        id: participant.id,
        name: participant.name,
        handle: participant.handle,
        avatarUrl: participant.avatarUrl ?? null,
        isGuest: false,
      })),
      ...activeGuests.map((guest) => ({
        id: guest.id,
        name: guest.name,
        handle: null,
        avatarUrl: null,
        isGuest: true,
      })),
    ];
  }, [me, activeParticipants, activeGuests]);

  const [scanParticipantsOpen, setScanParticipantsOpen] = useState(false);

  const handleReviewingChange = useCallback(
    (reviewing: boolean) => {
      setReviewingScan(reviewing);
      if (!reviewing) {
        setScanDraftContext(null);
        return;
      }
      if (!me) return;
      const initialParticipants: User[] = [meToLegacyUser(me)];
      for (const member of scanGroup?.members ?? []) {
        if (member.userId === me.id || member.status !== "accepted") continue;
        initialParticipants.push(profileToUser(member.user));
      }
      setScanDraftContext({
        groupId: scanGroup?.group.id ?? null,
        participants: initialParticipants,
        guests: [],
      });
    },
    [me, scanGroup, setScanDraftContext],
  );

  const defaultGroupName = useMemo(() => {
    const names = [
      ...store.participants.map((p) => p.name.split(" ")[0]),
      ...store.guests.map((g) => g.name.split(" ")[0]),
    ];
    if (names.length === 0) return "";
    return names.length <= 3
      ? names.join(" e ")
      : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  }, [store.participants, store.guests]);

  const applyTypeSelect = useCallback(
    (type: ExpenseType) => {
      setBillType(type);
      if (me) {
        ensureDraftOwnedBy(me.id);
        const billStore = useBillStore.getState();
        billStore.setCurrentUser(meToLegacyUser(me));
        selectDraftForType(billStore, type, pendingGroupId);
        // Read the key from the store AFTER the transition: selectDraftForType can rotate it.
        writeDraftIntent({ kind: "create", draftKey: useBillStore.getState().draftKey });
        setPendingGroupId(null);
      }
      setStep("info");
    },
    [me, pendingGroupId],
  );

  const handleTypeSelect = useCallback(
    (type: ExpenseType) => {
      const liveStore = useBillStore.getState();
      const currentType = liveStore.expense?.expenseType;
      if (
        me &&
        liveStore.expense &&
        currentType !== type &&
        hasMeaningfulDraft(liveStore, me.id)
      ) {
        setPendingType(type);
        setDiscardDialogMode("type-switch");
        setDiscardDialogOpen(true);
        return;
      }

      applyTypeSelect(type);
    },
    [me, applyTypeSelect],
  );

  const applyScanReplacement = useCallback(
    (candidate: ScanDraftCandidate) => {
      commitScanReplacement(candidate);
      setBillType("itemized");
      setStep("items");
      setReviewingScan(false);
      setScanDraftContext(null);
    },
    [setScanDraftContext],
  );

  const discardScannedReceipt = useCallback(() => {
    toast.success("Rascunho mantido. A nota escaneada foi descartada.");
    setReviewClearSignal((s) => s + 1);
    setReviewingScan(false);
    setScanDraftContext(null);
  }, [setScanDraftContext]);

  const handleReviewSubmit = useCallback((result: ReceiptOcrResult, occurredOn: string) => {
    if (!me) return;

    const liveStore = useBillStore.getState();
    const candidate = buildScanDraftCandidate({
      result,
      occurredOn,
      groupId: scanDraftContext?.groupId ?? scanGroup?.group.id ?? null,
      participants: scanDraftContext?.participants ?? [meToLegacyUser(me)],
      guests: scanDraftContext?.guests ?? [],
      creatorId: me.id,
      nowIso: new Date().toISOString(),
    });

    if (!hasMeaningfulDraft(liveStore, me.id)) {
      applyScanReplacement(candidate);
      return;
    }

    if (confirmations.scanDraftChoice === "replace") {
      applyScanReplacement(candidate);
      toast.success("Rascunho substituído pela nota escaneada.");
      return;
    }
    if (confirmations.scanDraftChoice === "keep") {
      discardScannedReceipt();
      return;
    }

    const snapshot: PreConfirmSnapshot = {
      expenseId: liveStore.expense?.id ?? "",
      itemCount: liveStore.items.length,
      totalCents: liveStore.getGrandTotal(),
      draftTitle: liveStore.expense?.title || "Nova conta",
    };

    setPendingCandidate(candidate);
    setPreConfirmSnapshot(snapshot);
    setReplaceDialogOpen(true);
  }, [
    applyScanReplacement,
    confirmations.scanDraftChoice,
    discardScannedReceipt,
    me,
    scanDraftContext,
    scanGroup,
  ]);

  const handleKeepDraft = useCallback(() => {
    setReplaceDialogOpen(false);
    setPendingCandidate(null);
    setPreConfirmSnapshot(null);
    discardScannedReceipt();
  }, [discardScannedReceipt]);

  const handleReplaceDraft = useCallback(() => {
    if (!pendingCandidate) return;
    setReplaceDialogOpen(false);
    setPendingCandidate(null);
    setPreConfirmSnapshot(null);
    applyScanReplacement(pendingCandidate);
  }, [applyScanReplacement, pendingCandidate]);

  const applyVoiceConfirm = useCallback(
    (result: VoiceExpenseResult, resolvedParticipants: ResolvedParticipant[]) => {
      if (!me) return;
      const billStore = useBillStore.getState();
      billStore.setCurrentUser(meToLegacyUser(me));
      billStore.hydrateFromVoice(result, selectedGroupId ?? undefined);

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
      setBillType(result.expenseType);
      setStep(result.expenseType === "itemized" ? "split" : "info");
    },
    [me, selectedGroupId],
  );

  const handleVoiceConfirm = useCallback(
    (result: VoiceExpenseResult, resolvedParticipants: ResolvedParticipant[]) => {
      if (!me) return;
      const liveStore = useBillStore.getState();
      if (hasMeaningfulDraft(liveStore, me.id)) {
        setPendingVoice({ result, resolvedParticipants });
        setDiscardDialogMode("voice");
        setDiscardDialogOpen(true);
        return;
      }
      applyVoiceConfirm(result, resolvedParticipants);
    },
    [me, applyVoiceConfirm],
  );

  const handleResumeDraft = useCallback(() => {
    const liveStore = useBillStore.getState();
    const draft = liveStore.expense;
    if (!draft) return;

    setBillType(draft.expenseType);
    if (draft.expenseType === "single_amount") {
      setStep("info");
    } else {
      if (liveStore.payers.length > 0) {
        setStep("payer");
      } else if (liveStore.items.length > 0) {
        setStep("items");
      } else {
        setStep("split");
      }
    }

    const intent = readDraftIntent();
    if (intent?.kind === "edit" && intent.expenseId === draft.id) {
      setIsEditing(true);
      setResumedEditExpenseId(intent.expenseId);
      if (effectiveBaseVersionNo === null && intent.expectedVersionNo !== null) {
        setEditBaseVersionNo(intent.expectedVersionNo);
      }
    }
  }, [effectiveBaseVersionNo]);

  const draftSummary = useMemo(() => {
    const isItemized = store.expense?.expenseType === "itemized";
    const named = store.expense?.title || null;
    return {
      // A draft that never got a name shows its contents, not the default placeholder.
      title: named,
      fallbackTitle: isItemized ? "Nova conta" : "Conta sem título",
      itemCount: store.items.length,
      totalCents: isItemized
        ? useBillStore.getState().getGrandTotal()
        : store.totalAmountInput,
      isItemized,
    };
  }, [store.expense?.expenseType, store.expense?.title, store.items.length, store.totalAmountInput]);

  const handleBannerDiscardRequest = useCallback(() => {
    setDiscardDialogMode("banner-discard");
    setDiscardDialogOpen(true);
  }, []);

  const handleDiscardConfirm = useCallback(() => {
    if (discardDialogMode === "type-switch") {
      clearDraftIntent();
      if (pendingType) {
        applyTypeSelect(pendingType);
        setPendingType(null);
      }
    } else if (discardDialogMode === "voice") {
      if (pendingVoice) {
        applyVoiceConfirm(pendingVoice.result, pendingVoice.resolvedParticipants);
        setPendingVoice(null);
      }
    } else if (discardDialogMode === "banner-discard") {
      useBillStore.getState().reset();
      clearDraftIntent();
      setDismissedThisMount(true);
    }
    setDiscardDialogOpen(false);
  }, [discardDialogMode, pendingType, pendingVoice, applyTypeSelect, applyVoiceConfirm]);

  const handleDiscardKeep = useCallback(() => {
    setPendingType(null);
    setPendingVoice(null);
    setDiscardDialogOpen(false);
  }, []);

  const handleStaleVersion = useCallback(async () => {
    const editId = modes.editExpenseId ?? resumedEditExpenseId;
    if (!editId) return;
    setConflict({ status: "loading" });
    try {
      await refreshExpense(editId);
    } catch (e) {
      toast.error(ledgerErrorMessage(e));
      setConflict({ status: "error" });
      return;
    }
    const detail = useAppStore.getState().expenseDetails[editId];
    if (!detail) {
      setConflict({ status: "error" });
      return;
    }
    setConflict({ status: "ready", detail });
  }, [modes.editExpenseId, resumedEditExpenseId]);

  const handleAcceptConflict = useCallback(() => {
    const editId = modes.editExpenseId ?? resumedEditExpenseId;
    if (!editId || conflict.status !== "ready") return;
    const candidate = conflict.detail;
    if (candidate.expense.id !== editId) return;
    const snapshot = useAppStore.getState().groups[candidate.expense.groupId];
    useBillStore.getState().hydrateFromDetail(candidate, snapshot?.members ?? []);
    setEditBaseVersionNo(candidate.expense.currentVersionNo);
    const intent = readDraftIntent();
    if (intent?.kind === "edit" && intent.expenseId === editId) {
      writeDraftIntent({
        kind: "edit",
        expenseId: editId,
        expectedVersionNo: candidate.expense.currentVersionNo,
        draftKey: useBillStore.getState().draftKey,
      });
    }
    setConflict({ status: "none" });
    toast.success("Conta atualizada.");
  }, [modes.editExpenseId, resumedEditExpenseId, conflict]);

  const conflictPanel = conflict.status !== "none" ? (
    <div className="px-4 pt-4">
      <ExpenseConflictPanel
        status={conflict.status}
        detail={conflict.status === "ready" ? conflict.detail : null}
        onRetry={handleStaleVersion}
        onAccept={handleAcceptConflict}
      />
    </div>
  ) : null;
  const conflictBlockedReason =
    conflict.status !== "none"
      ? "Carregue a versão mais recente pra salvar."
      : null;

  const { submitting, submit } = useWizardSubmit({
    router,
    editExpenseId: modes.editExpenseId ?? resumedEditExpenseId,
    expectedVersionNo: effectiveBaseVersionNo,
    onStaleVersion: handleStaleVersion,
  });

  const submitItemized = useCallback(async (): Promise<boolean> => {
    if (!me) return false;
    return submit(() => planGroup({
      meId: me.id,
      createGroupEnabled,
      createGroupName,
      defaultGroupName,
    }));
  }, [me, submit, createGroupEnabled, createGroupName, defaultGroupName]);

  const goBack = () => {
    if (isDmMode && modes.dm) {
      router.push(`/app/conversations/${modes.dm.userId}`);
      return;
    }
    const activeEditId = modes.editExpenseId ?? resumedEditExpenseId;
    if (isEditing && activeEditId) {
      router.push(`/app/bill/${activeEditId}`);
      return;
    }
    setStep("type");
    setBillType(null);
    setCreateGroupEnabled(true);
    setCreateGroupName("");
  };

  if (!mounted || !me) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6" aria-busy="true">
        <ScanSkeletonLoader />
      </div>
    );
  }

  // Editing an expense we could not read would silently present an empty
  // wizard as though the user were creating a new bill.
  if (modes.editExpenseId && editDetail === null && editRead.status === "error") {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <SyncErrorState
          message={ledgerErrorMessage(new LedgerError(editRead.code))}
          onRetry={() => {
            void refreshExpense(modes.editExpenseId!).catch(() => {});
          }}
        />
      </div>
    );
  }

  if (!isTypeStep && billType === "itemized") {
    return (
      <>
        <ItemizedBillForm
        me={me}
        groups={groupSnapshots}
        selectedGroupId={selectedGroupId}
        createGroupEnabled={createGroupEnabled}
        createGroupName={createGroupName || defaultGroupName}
        hasContactPicker={hasContactPicker}
        onSelectGroup={handleSelectGroup}
        onToggleCreateGroup={setCreateGroupEnabled}
        onCreateGroupName={setCreateGroupName}
        onAddParticipant={(profile) => useBillStore.getState().addParticipant(profileToUser(profile))}
        onRemoveParticipant={(id) => useBillStore.getState().removeParticipant(id)}
        onAddGuest={(name, phone) => useBillStore.getState().addGuest(name, phone)}
        onRemoveGuest={(id) => useBillStore.getState().removeGuest(id)}
        onPickContacts={handlePickContacts}
        onSubmit={submitItemized}
        onBack={goBack}
        isEditing={isEditing}
        submitting={submitting}
        initialSection={itemizedSectionFor(step)}
        conflictPanel={conflictPanel}
        conflictBlocked={conflictBlockedReason !== null}
      />
      </>
    );
  }

  if (isSingleFlow) {
    return (
      <>
        <SingleBillForm
        me={me}
        groups={groupSnapshots}
        initialGroupId={selectedGroupId}
        isDmMode={isDmMode}
        isEditing={isEditing}
        hasContactPicker={hasContactPicker}
        onPickContacts={handlePickContacts}
        onBack={goBack}
        submit={submit}
        submitting={submitting}
        conflictPanel={conflictPanel}
        submitBlockedReason={conflictBlockedReason}
      />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      {!reviewingScan && (
        <div className="flex items-center gap-3">
          <Link
            href="/app"
            aria-label="Fechar"
            className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </Link>
          <h1 className="text-[22px] leading-tight font-bold tracking-tight">
            {isDmMode ? "Cobrar" : "Nova conta"}
          </h1>
        </div>
      )}

      {isTypeStep && mounted && me && store.expense && hasMeaningfulDraft(store, me.id) && !dismissedThisMount && !reviewingScan && (
        <div className="mt-4">
          <DraftResumeBanner
            title={draftSummary.title}
            itemCount={draftSummary.itemCount}
            totalCents={draftSummary.totalCents}
            onContinue={handleResumeDraft}
            onDiscardRequest={handleBannerDiscardRequest}
          />
        </div>
      )}

      <div className={reviewingScan ? "min-h-[400px]" : "mt-6 min-h-[400px]"}>
        <TypeStep
          accountId={me?.id ?? null}
          groupMembers={(selectedGroup?.members ?? []).map((m) => ({
            id: m.user.id,
            handle: m.user.handle,
            name: m.user.name,
            avatarUrl: m.user.avatarUrl ?? undefined,
          }))}
          participants={scanParticipants}
          occurredOn={store.occurredOn ?? todayIsoDate()}
          reviewClearSignal={reviewClearSignal}
          onTypeSelect={handleTypeSelect}
          onReviewSubmit={handleReviewSubmit}
          onScanShare={assignmentRoomEntry.shareReceipt}
          scanSharePending={assignmentRoomEntry.pending}
          scanShareError={assignmentRoomEntry.error}
          onVoiceConfirm={handleVoiceConfirm}
          onReviewingChange={handleReviewingChange}
          onManageParticipants={() => setScanParticipantsOpen(true)}
        />
      </div>
      {me && (
        <ParticipantsDialog
          open={scanParticipantsOpen}
          onOpenChange={setScanParticipantsOpen}
          description="Escolha quem divide esta conta."
          participants={{
            me,
            participants: reviewingScan && scanDraftContext ? scanDraftContext.participants : store.participants,
            guests: reviewingScan && scanDraftContext ? scanDraftContext.guests : store.guests,
            selectedGroupId: reviewingScan && scanDraftContext ? scanDraftContext.groupId : selectedGroupId,
            groups: groupSnapshots,
            createGroup: { enabled: createGroupEnabled, name: createGroupName },
            onToggleCreateGroup: setCreateGroupEnabled,
            onCreateGroupName: setCreateGroupName,
            onSelectGroup: onScanSelectGroup,
            onAddParticipant: onScanAddParticipant,
            onRemoveParticipant: onScanRemoveParticipant,
            onAddGuest: onScanAddGuest,
            onRemoveGuest: onScanRemoveGuest,
            hasContactPicker,
            onPickContacts: handlePickContacts,
          }}
        />
      )}
      <ReplaceDraftDialog
        open={replaceDialogOpen}
        draftTitle={preConfirmSnapshot?.draftTitle ?? "Nova conta"}
        itemCount={preConfirmSnapshot?.itemCount ?? 0}
        totalCents={preConfirmSnapshot?.totalCents ?? 0}
        onReplace={handleReplaceDraft}
        onKeep={handleKeepDraft}
        onRemember={(choice) => updateConfirmations({ scanDraftChoice: choice })}
      />
      <DiscardDraftDialog
        open={discardDialogOpen}
        draftTitle={draftSummary.title ?? draftSummary.fallbackTitle}
        itemCount={draftSummary.itemCount}
        totalCents={draftSummary.totalCents}
        mode={discardDialogMode}
        isItemized={store.expense?.expenseType === "itemized"}
        onDiscard={handleDiscardConfirm}
        onKeep={handleDiscardKeep}
      />
    </div>
  );
}

export default function NewBillPage() {
  return (
    <Suspense fallback={null}>
      <NewBillPageContent />
    </Suspense>
  );
}
