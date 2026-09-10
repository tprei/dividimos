"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { PayerStep } from "@/components/bill/payer-step";
import { SingleBillForm } from "@/components/bill/single-bill-form";
import { ItemsStep } from "@/components/bill/wizard/items-step";
import { ParticipantsStep } from "@/components/bill/wizard/participants-step";
import { SplitStep } from "@/components/bill/wizard/split-step";
import type { ResolvedParticipant } from "@/components/bill/voice-expense-modal";
import { ScanSkeletonLoader } from "@/components/bill/scan-skeleton-loader";
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
import { meToLegacyUser } from "@/hooks/use-auth";
import toast from "react-hot-toast";
import type { GroupSnapshot, UserProfile } from "@/types/ledger";
import type { ExpenseType, User } from "@/types";
import { InfoStep } from "./info-step";
import { SummaryStep } from "./summary-step";
import { useWizardInit } from "./use-wizard-init";
import { useItemAssignment } from "./use-item-assignment";
import { ITEMIZED_STEPS, parseWizardModes, type Step } from "./wizard-modes";
import { todayIsoDate, useWizardSubmit } from "./use-wizard-submit";
import { computeWizardError, WizardFooter } from "./wizard-footer";

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
  const modes = useMemo(() => parseWizardModes(searchParams), [searchParams]);
  const me = useMe();

  const store = useBillStore(
    useShallow((s) => ({
      expense: s.expense,
      participants: s.participants,
      guests: s.guests,
      items: s.items,
      payers: s.payers,
      splits: s.splits,
      billSplits: s.billSplits,
      occurredOn: s.occurredOn,
      setCurrentUser: s.setCurrentUser,
      setOccurredOn: s.setOccurredOn,
      createExpense: s.createExpense,
      updateExpense: s.updateExpense,
      addParticipant: s.addParticipant,
      removeParticipant: s.removeParticipant,
      addGuest: s.addGuest,
      removeGuest: s.removeGuest,
      addItem: s.addItem,
      removeItem: s.removeItem,
      splitItemEqually: s.splitItemEqually,
      splitPaymentEqually: s.splitPaymentEqually,
      setPayerAmount: s.setPayerAmount,
      setPayerFull: s.setPayerFull,
      removePayerEntry: s.removePayerEntry,
      getGrandTotal: s.getGrandTotal,
      wouldProduceNoEdges: s.wouldProduceNoEdges,
    })),
  );

  const groups = useAppStore((s) => s.groups);
  const groupOrder = useAppStore(useShallow((s) => s.groupOrder));
  const editDetail = useAppStore((s) =>
    modes.editExpenseId ? s.expenseDetails[modes.editExpenseId] ?? null : null,
  );

  const [billType, setBillType] = useState<ExpenseType | null>(null);
  const [step, setStep] = useState<Step>("type");
  const [title, setTitle] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [serviceFee, setServiceFee] = useState(() => {
    const existing = useBillStore.getState().expense;
    return existing ? String(existing.serviceFeePercent).replace(".", ",") : "10";
  });
  const [fixedFees, setFixedFees] = useState("");
  const [navigating, setNavigating] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [createGroupEnabled, setCreateGroupEnabled] = useState(true);
  const [createGroupName, setCreateGroupName] = useState("");
  const [mounted, setMounted] = useState(false);
  const [hasContactPicker, setHasContactPicker] = useState(false);
  const [isDmMode, setIsDmMode] = useState(false);

  const { handleAssign, handleUnassign, handleAssignAll } = useItemAssignment();

  useEffect(() => {
    setMounted(true);
    setHasContactPicker(isContactPickerSupported());
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
    onSetTitle: setTitle,
    onSetMerchantName: setMerchantName,
    onSetServiceFee: setServiceFee,
    onSetFixedFees: setFixedFees,
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

  const steps = ITEMIZED_STEPS;
  const stepIndex = steps.findIndex((s) => s.key === step);
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

  const pendingInviteNames = useMemo(() => {
    if (!selectedGroupId || !me) return [];
    const snapshot = groups[selectedGroupId];
    if (!snapshot) return [];
    const statusById = new Map(snapshot.members.map((m) => [m.userId, m.status]));
    return store.participants
      .filter((p) => p.id !== me.id && statusById.get(p.id) !== "accepted")
      .map((p) => p.name.split(" ")[0]);
  }, [selectedGroupId, groups, store.participants, me]);

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
    setStep("info");
  }, [me]);

  const handleScanConfirm = useCallback((result: ReceiptOcrResult) => {
    setBillType("itemized");
    if (me) {
      const billStore = useBillStore.getState();
      billStore.setCurrentUser(meToLegacyUser(me));
      billStore.createExpense(
        result.merchant || "Nota escaneada",
        "itemized",
        result.merchant || undefined,
      );
      billStore.updateExpense({
        serviceFeePercent: (result.serviceFeeBasisPoints || 0) / 100,
      });

      for (const item of result.items) {
        billStore.addItem({
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
  }, [me]);

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
    setTitle(result.title);
    setMerchantName(result.merchantName || "");
    if (result.expenseType === "itemized") {
      setServiceFee("0");
    }
    setStep("participants");
  }, [me, selectedGroupId]);

  const initBill = useCallback(() => {
    if (!billType || !me) return;
    store.setCurrentUser(meToLegacyUser(me));
    store.createExpense(title || "Nova conta", billType, merchantName || undefined);
    if (billType === "itemized") {
      store.updateExpense({
        serviceFeePercent: parseFloat(serviceFee.replace(",", ".")) || 0,
        fixedFees: Math.round((parseFloat(fixedFees.replace(",", ".")) || 0) * 100),
      });
    }
  }, [store, title, billType, merchantName, serviceFee, fixedFees, me]);

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

  const goNext = useCallback(async () => {
    if (step === "info") {
      if (!isEditing && !isDmMode) {
        initBill();
      } else {
        store.updateExpense({
          title: title || "Nova conta",
          merchantName: merchantName || undefined,
          serviceFeePercent: billType === "itemized" ? parseFloat(serviceFee.replace(",", ".")) || 0 : 0,
          fixedFees: billType === "itemized"
            ? Math.round((parseFloat(fixedFees.replace(",", ".")) || 0) * 100)
            : 0,
        });
      }
    }
    if (step === "participants" && me) {
      if (!selectedGroupId) {
        const state = useBillStore.getState();
        const otherParticipants = state.participants.filter((p) => p.id !== me.id);
        const hasGuests = state.guests.length > 0;
        const needsGroup = otherParticipants.length > 0 || hasGuests;
        const isDmCase = otherParticipants.length === 1 && !hasGuests;

        if (isDmCase) {
          try {
            const dm = await getOrCreateDm(otherParticipants[0].id);
            setSelectedGroupId(dm.groupId);
          } catch (e) {
            toast.error(ledgerErrorMessage(e));
            return;
          }
        } else if (needsGroup) {
          if (!createGroupEnabled) {
            toast.error("Escolha um grupo existente ou deixe \"Criar grupo\" marcado.");
            return;
          }
          try {
            const ack = await createGroup(
              createGroupName.trim() || defaultGroupName || "Novo grupo",
              otherParticipants.map((p) => p.id),
            );
            setSelectedGroupId(ack.groupId);
          } catch (e) {
            toast.error(ledgerErrorMessage(e));
            return;
          }
        }
      }
    }
    if (step === "summary") {
      await submit(selectedGroupId);
      return;
    }
    let next = steps[stepIndex + 1];
    if (isDmMode && next?.key === "participants") {
      next = steps[stepIndex + 2];
    }
    if (next) setStep(next.key);
  }, [step, stepIndex, steps, me, selectedGroupId, store, initBill, isEditing, isDmMode, title, merchantName, billType, serviceFee, fixedFees, createGroupEnabled, createGroupName, defaultGroupName, submit]);

  const isNextDisabled = useCallback(() => {
    if (navigating || submitting || isTypeStep) return true;
    if (step === "info") return !title.trim();
    if (step === "participants") return (store.participants.length + store.guests.length) < 2;
    if (step === "payer") {
      const gt = store.getGrandTotal();
      const paid = store.payers.reduce((s, p) => s + p.amountCents, 0);
      return gt <= 0 || Math.abs(gt - paid) > 1;
    }
    if (step === "summary") {
      return store.wouldProduceNoEdges() || pendingInviteNames.length > 0;
    }
    return false;
  }, [navigating, submitting, isTypeStep, step, title, store, pendingInviteNames]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || isSingleFlow) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || tag === "SELECT") return;
      if (isNextDisabled()) return;
      e.preventDefault();
      setNavigating(true);
      goNext().finally(() => setNavigating(false));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, isNextDisabled, isSingleFlow]);

  const goBack = () => {
    if (billType === "single_amount" && step !== "type") {
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
      return;
    }
    if (stepIndex === 0) {
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
      setTitle("");
      setMerchantName("");
      setServiceFee("10");
      setFixedFees("");
      setSelectedGroupId(null);
      setCreateGroupEnabled(true);
      setCreateGroupName("");
      return;
    }
    const prev = steps[stepIndex - 1];
    if (prev) setStep(prev.key);
  };

  if (!mounted || !me) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6" aria-busy="true">
        <ScanSkeletonLoader />
      </div>
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
      />
    );
  }
  const paidTotalCents = store.payers.reduce((s, p) => s + p.amountCents, 0);
  const errorMessage = computeWizardError({
    step,
    participantCount: store.participants.length + store.guests.length,
    grandTotal: store.getGrandTotal(),
    paidTotalCents,
    pendingInviteNames,
    wouldProduceNoEdges: store.wouldProduceNoEdges(),
  });

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        {!isTypeStep ? (
          <button
            onClick={goBack}
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
          <h1 className="font-semibold">{isEditing ? "Editar conta" : isDmMode ? "Cobrar" : "Nova conta"}</h1>
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
                groupMembers={(selectedGroup?.members ?? []).map((m) => ({
                  id: m.user.id,
                  handle: m.user.handle,
                  name: m.user.name,
                  avatarUrl: m.user.avatarUrl ?? undefined,
                }))}
                onTypeSelect={handleTypeSelect}
                onScanConfirm={handleScanConfirm}
                onVoiceConfirm={handleVoiceConfirm}
              />
            </motion.div>
          )}

          {step === "info" && (
            <InfoStep
              billType={billType ?? "single_amount"}
              title={title}
              onTitleChange={setTitle}
              occurredOn={store.occurredOn ?? todayIsoDate()}
              onOccurredOnChange={store.setOccurredOn}
              merchantName={merchantName}
              onMerchantNameChange={setMerchantName}
              serviceFee={serviceFee}
              onServiceFeeChange={setServiceFee}
              fixedFees={fixedFees}
              onFixedFeesChange={setFixedFees}
              onScanConfirm={handleScanConfirm}
            />
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
                me={me}
                participants={store.participants}
                guests={store.guests}
                selectedGroupId={selectedGroupId}
                groups={groupSnapshots}
                createGroup={{ enabled: createGroupEnabled, name: createGroupName || defaultGroupName }}
                onToggleCreateGroup={setCreateGroupEnabled}
                onCreateGroupName={setCreateGroupName}
                onSelectGroup={handleSelectGroup}
                onAddParticipant={(profile) => store.addParticipant(profileToUser(profile))}
                onRemoveParticipant={(id) => store.removeParticipant(id)}
                onAddGuest={(name, phone) => store.addGuest(name, phone)}
                onRemoveGuest={(id) => store.removeGuest(id)}
                hasContactPicker={hasContactPicker}
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
            <SummaryStep
              expense={store.expense}
              items={store.items}
              splits={store.splits}
              billSplits={store.billSplits}
              participants={store.participants}
              guests={store.guests}
              payers={store.payers}
              grandTotal={store.getGrandTotal()}
              pendingInviteNames={pendingInviteNames}
              wouldProduceNoEdges={store.wouldProduceNoEdges()}
            />
          )}
        </AnimatePresence>
      </div>

      {!isTypeStep && (
        <WizardFooter
          isSummary={step === "summary"}
          isEditing={isEditing}
          busy={navigating || submitting}
          disabled={isNextDisabled()}
          errorMessage={errorMessage}
          onNext={async () => {
            setNavigating(true);
            try {
              await goNext();
            } finally {
              setNavigating(false);
            }
          }}
          onBack={goBack}
        />
      )}
    </div>
  );
}
