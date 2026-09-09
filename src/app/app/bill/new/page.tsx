"use client";

import { X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ItemizedBillForm, type ItemizedSectionKey } from "@/components/bill/itemized-bill-form";
import { SingleBillForm } from "@/components/bill/single-bill-form";
import type { ResolvedParticipant } from "@/components/bill/voice-expense-modal";
import type { ItemDivisionParticipant } from "@/components/bill/item-division-editor";
import { ScanSkeletonLoader } from "@/components/bill/scan-skeleton-loader";
import type { ItemDivisionValue } from "@/lib/item-division";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import { isContactPickerSupported, pickContacts } from "@/lib/contacts";
import { createGroup, getOrCreateDm } from "@/lib/sync/mutations-group";
import { refreshExpense } from "@/lib/sync/refresh";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { useBillStore } from "@/stores/bill-store";
import { useAppStore } from "@/stores/app-store";
import { useShallow } from "zustand/react/shallow";
import { useMe } from "@/hooks/use-me";
import { useClientOnly, useMounted } from "@/hooks/use-client-only";
import { meToLegacyUser } from "@/hooks/use-auth";
import toast from "react-hot-toast";
import type { GroupSnapshot, UserProfile } from "@/types/ledger";
import type { ExpenseType, User } from "@/types";
import { useWizardInit } from "./use-wizard-init";
import { parseWizardModes, type Step } from "./wizard-modes";
import { todayIsoDate, useWizardSubmit } from "./use-wizard-submit";

const TypeStep = dynamic(
  () => import("@/components/bill/wizard/type-step").then((m) => ({ default: m.TypeStep })),
  { ssr: false },
);

function profileToUser(profile: UserProfile): User {
  return {
    id: profile.id,
    email: "",
    handle: profile.handle,
    name: profile.name,
    pixKeyType: "email",
    pixKeyHint: "",
    avatarUrl: profile.avatarUrl ?? undefined,
    onboarded: true,
    createdAt: "",
  };
}

function itemizedSectionFor(step: Step): ItemizedSectionKey {
  if (step === "split" || step === "participants") return "split";
  if (step === "payer") return "payment";
  if (step === "summary") return "review";
  return "account";
}

function NewBillPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modes = useMemo(() => parseWizardModes(searchParams), [searchParams]);
  const me = useMe();

  const store = useBillStore(
    useShallow((s) => ({
      expense: s.expense,
      participants: s.participants,
      guests: s.guests,
      occurredOn: s.occurredOn,
    })),
  );

  const groups = useAppStore((s) => s.groups);
  const groupOrder = useAppStore(useShallow((s) => s.groupOrder));
  const editDetail = useAppStore((s) =>
    modes.editExpenseId ? s.expenseDetails[modes.editExpenseId] ?? null : null,
  );

  const [billType, setBillType] = useState<ExpenseType | null>(null);
  const [step, setStep] = useState<Step>("type");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [createGroupEnabled, setCreateGroupEnabled] = useState(true);
  const [createGroupName, setCreateGroupName] = useState("");
  const mounted = useMounted();
  const hasContactPicker = useClientOnly(isContactPickerSupported);
  const [isDmMode, setIsDmMode] = useState(false);
  const [reviewingScan, setReviewingScan] = useState(false);

  useEffect(() => {
    if (!useBillStore.getState().occurredOn) {
      useBillStore.getState().setOccurredOn(todayIsoDate());
    }
  }, []);

  useWizardInit({
    modes,
    me,
    step,
    selectedGroupId,
    onSetSelectedGroupId: setSelectedGroupId,
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
    for (const c of result.contacts) {
      useBillStore.getState().addGuest(c.name || c.phone, c.phone);
    }
    toast.success(
      result.contacts.length === 1
        ? "Contato adicionado como convidado."
        : `${result.contacts.length} contatos adicionados como convidados.`,
    );
  }, []);

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
  const scanParticipants = useMemo<ItemDivisionParticipant[]>(() => {
    if (!me) return [];
    return [
      {
        id: me.id,
        name: me.name,
        avatarUrl: me.avatarUrl ?? null,
        isGuest: false,
      },
      ...(scanGroup?.members ?? [])
        .filter((member) => member.userId !== me.id && member.status === "accepted")
        .map((member) => ({
          id: member.user.id,
          name: member.user.name,
          avatarUrl: member.user.avatarUrl ?? null,
          isGuest: false,
        })),
    ];
  }, [me, scanGroup]);

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

  const handleTypeSelect = useCallback((type: ExpenseType) => {
    setBillType(type);
    if (type === "single_amount" && me) {
      const billStore = useBillStore.getState();
      billStore.setCurrentUser(meToLegacyUser(me));
      billStore.createExpense("", "single_amount");
    }
    if (type === "itemized" && me) {
      const billStore = useBillStore.getState();
      billStore.setCurrentUser(meToLegacyUser(me));
      billStore.createExpense("Nova conta", "itemized", undefined, selectedGroupId ?? undefined);
    }
    setStep("info");
  }, [me, selectedGroupId]);

  const handleScanConfirm = useCallback((
    result: ReceiptOcrResult,
    receiptAccessKey: string | null,
    divisions: Record<number, ItemDivisionValue>,
    occurredOn: string,
  ) => {
    setBillType("itemized");
    const billStore = useBillStore.getState();
    if (scanGroup) setSelectedGroupId(scanGroup.group.id);
    if (me) {
      billStore.setCurrentUser(meToLegacyUser(me));
      billStore.createExpense(
        result.merchant || "Nota escaneada",
        "itemized",
        result.merchant || undefined,
        scanGroup?.group.id,
      );
      // The scanned document's identity travels with the draft so the create
      // RPC can reject a second expense for the same receipt.
      billStore.setReceiptAccessKey(receiptAccessKey);
      billStore.updateExpense({
        serviceFeePercent: result.serviceFeeBasisPoints / 100,
        serviceFeeBasisPoints: result.serviceFeeBasisPoints,
        fixedFees: result.fixedFeesCents,
      });

      for (const item of result.items) {
        billStore.addItem({
          description: item.description,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          totalPriceCents: item.totalCents,
        });
      }
      for (const member of scanGroup?.members ?? []) {
        if (member.userId === me.id || member.status !== "accepted") continue;
        billStore.addParticipant(profileToUser(member.user));
      }

      const addedItems = useBillStore.getState().items;
      for (const [indexText, division] of Object.entries(divisions)) {
        const item = addedItems[Number(indexText)];
        if (item) billStore.setItemDivision(item.id, division);
      }
    }
    billStore.setOccurredOn(occurredOn);
    setStep("split");
  }, [me, scanGroup]);

  const handleVoiceConfirm = useCallback((result: VoiceExpenseResult, resolvedParticipants: ResolvedParticipant[]) => {
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

    setBillType(result.expenseType);
    setStep(result.expenseType === "itemized" ? "split" : "info");
  }, [me, selectedGroupId]);

  const onStaleReload = useCallback(async () => {
    const editId = modes.editExpenseId;
    if (!editId) return;
    try {
      await refreshExpense(editId);
    } catch (e) {
      toast.error(ledgerErrorMessage(e));
      return;
    }
    const detail = useAppStore.getState().expenseDetails[editId];
    if (!detail) return;
    const snapshot = useAppStore.getState().groups[detail.expense.groupId];
    useBillStore.getState().hydrateFromDetail(detail, snapshot?.members ?? []);
    toast.success("Conta atualizada.");
  }, [modes.editExpenseId]);

  const { submitting, submit } = useWizardSubmit({
    router,
    editExpenseId: modes.editExpenseId,
    expectedVersionNo: editDetail?.expense.currentVersionNo ?? null,
    onStaleReload,
  });

  const handleSelectGroup = useCallback(
    (groupId: string | null) => {
      setSelectedGroupId(groupId);
      const billStore = useBillStore.getState();
      billStore.updateExpense({ groupId: groupId ?? "" });
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

  const resolveGroup = useCallback(async (): Promise<string | null> => {
    if (selectedGroupId || !me) return selectedGroupId;
    const state = useBillStore.getState();
    const otherParticipants = state.participants.filter((participant) => participant.id !== me.id);
    const hasGuests = state.guests.length > 0;
    const needsGroup = otherParticipants.length > 0 || hasGuests;
    if (!needsGroup) return null;
    if (otherParticipants.length === 1 && !hasGuests) {
      try {
        const dm = await getOrCreateDm(otherParticipants[0].id);
        setSelectedGroupId(dm.groupId);
        useBillStore.getState().updateExpense({ groupId: dm.groupId });
        return dm.groupId;
      } catch (error) {
        toast.error(ledgerErrorMessage(error));
        return null;
      }
    }
    if (!createGroupEnabled) {
      toast.error("Escolha um grupo existente ou deixe \"Criar grupo\" marcado.");
      return null;
    }
    try {
      const ack = await createGroup(
        createGroupName.trim() || defaultGroupName || "Novo grupo",
        otherParticipants.map((participant) => participant.id),
      );
      setSelectedGroupId(ack.groupId);
      useBillStore.getState().updateExpense({ groupId: ack.groupId });
      return ack.groupId;
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
      return null;
    }
  }, [selectedGroupId, me, createGroupEnabled, createGroupName, defaultGroupName]);

  const submitItemized = useCallback(async (): Promise<boolean> => {
    if (!me) return false;
    return submit(async () => {
      const state = useBillStore.getState();
      const otherParticipants = state.participants.filter((participant) => participant.id !== me.id);
      const needsGroup = otherParticipants.length > 0 || state.guests.length > 0;
      const groupId = await resolveGroup();
      if (needsGroup && !groupId) return undefined;
      return groupId;
    });
  }, [me, resolveGroup, submit]);

  const goBack = () => {
    if (isDmMode && modes.dm) {
      router.push(`/app/conversations/${modes.dm.userId}`);
      return;
    }
    if (isEditing && modes.editExpenseId) {
      router.push(`/app/bill/${modes.editExpenseId}`);
      return;
    }
    setStep("type");
    setBillType(null);
    setSelectedGroupId(null);
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

  if (!isTypeStep && billType === "itemized") {
    return (
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
      />
    );
  }

  if (isSingleFlow) {
    return (
      <SingleBillForm
        me={me}
        groups={groupSnapshots}
        initialGroupId={selectedGroupId ?? (store.expense?.groupId || null)}
        isDmMode={isDmMode}
        isEditing={isEditing}
        hasContactPicker={hasContactPicker}
        onPickContacts={handlePickContacts}
        onBack={goBack}
        submit={submit}
        submitting={submitting}
      />
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
          onTypeSelect={handleTypeSelect}
          onScanConfirm={handleScanConfirm}
          onVoiceConfirm={handleVoiceConfirm}
          onReviewingChange={setReviewingScan}
        />
      </div>
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
