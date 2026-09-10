"use client";

import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { meToLegacyUser } from "@/hooks/use-auth";
import { refreshExpense } from "@/lib/sync/refresh";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { useAppStore } from "@/stores/app-store";
import { useBillStore } from "@/stores/bill-store";
import type { ExpenseDetail, Me, UserProfile } from "@/types/ledger";
import type { ExpenseType, User } from "@/types";
import type { WizardModes } from "./wizard-modes";

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

export interface WizardInitInput {
  modes: WizardModes;
  me: Me | null;
  step: string;
  selectedGroupId: string | null;
  onSetSelectedGroupId: (groupId: string) => void;
  onSetBillType: (type: ExpenseType) => void;
  onSetStep: (step: "type" | "info" | "participants" | "items" | "split" | "payer" | "summary") => void;
  onSetTitle: (title: string) => void;
  onSetMerchantName: (merchant: string) => void;
  onSetServiceFee: (fee: string) => void;
  onSetFixedFees: (fees: string) => void;
  onSetIsEditing: (isEditing: boolean) => void;
  onSetIsDmMode: (isDm: boolean) => void;
}

export function useWizardInit({
  modes,
  me,
  step,
  selectedGroupId,
  onSetSelectedGroupId,
  onSetBillType,
  onSetStep,
  onSetTitle,
  onSetMerchantName,
  onSetServiceFee,
  onSetFixedFees,
  onSetIsEditing,
  onSetIsDmMode,
}: WizardInitInput) {
  const dmLoadedRef = useRef(false);
  const draftEditLoadedRef = useRef(false);
  const editLoadedRef = useRef(false);
  const voiceStepRef = useRef(false);

  // DM quick-charge mode: consume ?dm=<userId>&groupId=<id>&type=<expenseType>.
  useEffect(() => {
    if (!modes.dm || !me || dmLoadedRef.current) return;
    dmLoadedRef.current = true;

    const snapshot = useAppStore.getState().groups[modes.dm.groupId];
    const counterpartyMember = snapshot?.members.find((m) => m.userId === modes.dm?.userId);
    if (!counterpartyMember) return;

    const counterparty = profileToUser(counterpartyMember.user);
    const billStore = useBillStore.getState();
    billStore.setCurrentUser(meToLegacyUser(me));
    onSetSelectedGroupId(modes.dm.groupId);
    onSetIsDmMode(true);

    if (modes.dm.type === "single_amount") {
      billStore.createExpenseFromDm(modes.dm.groupId, counterparty);
      const autoTitle = `Cobrança - ${counterpartyMember.user.name.split(" ")[0]}`;
      billStore.updateExpense({ title: autoTitle });
      onSetTitle(autoTitle);
      onSetBillType("single_amount");
      onSetStep("info");
    } else {
      billStore.createExpense("", "itemized", undefined, modes.dm.groupId);
      billStore.addParticipant(counterparty);
      onSetBillType("itemized");
      onSetStep("info");
    }
  }, [modes.dm, me, onSetSelectedGroupId, onSetIsDmMode, onSetTitle, onSetBillType, onSetStep]);

  // Chat draft edit mode: consume ?groupId=<id>&title=<text>&amount=<cents>
  useEffect(() => {
    if (!modes.chatDraft || !me || draftEditLoadedRef.current) return;
    draftEditLoadedRef.current = true;

    const billStore = useBillStore.getState();
    billStore.setCurrentUser(meToLegacyUser(me));
    billStore.createExpense(modes.chatDraft.title, "single_amount", undefined, modes.chatDraft.groupId);
    billStore.updateExpense({ totalAmountInput: modes.chatDraft.amountCents });
    onSetSelectedGroupId(modes.chatDraft.groupId);
    onSetTitle(modes.chatDraft.title);
    onSetBillType("single_amount");
    onSetStep("info");
  }, [modes.chatDraft, me, onSetSelectedGroupId, onSetTitle, onSetBillType, onSetStep]);

  // Edit mode: consume ?edit=<id> from the store's cached expense detail.
  useEffect(() => {
    const editId = modes.editExpenseId;
    if (!editId || !me || editLoadedRef.current) return;

    const hydrate = (detail: ExpenseDetail) => {
      editLoadedRef.current = true;
      const snapshot = useAppStore.getState().groups[detail.expense.groupId];
      const billStore = useBillStore.getState();
      billStore.setCurrentUser(meToLegacyUser(me));
      billStore.hydrateFromDetail(detail, snapshot?.members ?? []);

      const hydrated = useBillStore.getState();
      onSetIsEditing(true);
      onSetBillType(hydrated.expense?.expenseType ?? "single_amount");
      onSetTitle(hydrated.expense?.title ?? "");
      onSetMerchantName(hydrated.expense?.merchantName ?? "");
      onSetServiceFee(String(hydrated.expense?.serviceFeePercent ?? 0).replace(".", ","));
      onSetFixedFees(hydrated.expense?.fixedFees ? String(hydrated.expense.fixedFees / 100) : "");
      onSetSelectedGroupId(detail.expense.groupId);

      if (hydrated.expense?.expenseType === "single_amount") {
        onSetStep("info");
      } else if (hydrated.payers.length > 0) {
        onSetStep("payer");
      } else if (hydrated.items.length > 0) {
        onSetStep("items");
      } else {
        onSetStep("participants");
      }
    };

    const cached = useAppStore.getState().expenseDetails[editId];
    if (cached) {
      hydrate(cached);
      return;
    }

    void refreshExpense(editId)
      .then(() => {
        const detail = useAppStore.getState().expenseDetails[editId];
        if (detail) hydrate(detail);
      })
      .catch((e) => {
        toast.error(ledgerErrorMessage(e));
      });
  }, [modes.editExpenseId, me, onSetIsEditing, onSetBillType, onSetTitle, onSetMerchantName, onSetServiceFee, onSetFixedFees, onSetSelectedGroupId, onSetStep]);

  // Auto-select the ?groupId group when entering the participants step.
  useEffect(() => {
    const groupIdParam = modes.entryGroupId;
    if (!groupIdParam || modes.dm || selectedGroupId || step !== "participants" || !me) return;

    const snapshot = useAppStore.getState().groups[groupIdParam];
    if (!snapshot) return;

    onSetSelectedGroupId(groupIdParam);
    const billStore = useBillStore.getState();
    const hasOthers = billStore.participants.some((p) => p.id !== me.id);
    if (hasOthers) return;
    for (const member of snapshot.members) {
      if (member.userId === me.id || member.status !== "accepted") continue;
      billStore.addParticipant(profileToUser(member.user));
    }
  }, [step, modes.entryGroupId, modes.dm, selectedGroupId, me, onSetSelectedGroupId]);

  // Voice hydration navigate-then-render flow (?step=payer|participants).
  useEffect(() => {
    const stepParam = modes.entryStep;
    if (!stepParam || voiceStepRef.current) return;
    if (stepParam !== "payer" && stepParam !== "participants") return;
    const storeState = useBillStore.getState();
    if (storeState.expense) {
      voiceStepRef.current = true;
      onSetBillType(storeState.expense.expenseType);
      onSetTitle(storeState.expense.title);
      onSetMerchantName(storeState.expense.merchantName ?? "");
      onSetStep("participants");
    }
  }, [modes.entryStep, onSetBillType, onSetTitle, onSetMerchantName, onSetStep]);
}
