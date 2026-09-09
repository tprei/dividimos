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
import type { Step, WizardModes } from "./wizard-modes";

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
function resolveChatDraftActors(
  groupId: string,
  me: Me,
  participantIds: string[] | undefined,
  payerId: string | undefined,
): { users: User[]; payerId: string } | null {
  if (participantIds === undefined && payerId === undefined) {
    return null;
  }
  if (!participantIds || participantIds.length !== 2 || !payerId) return null;
  if (new Set(participantIds).size !== participantIds.length || !participantIds.includes(payerId)) {
    return null;
  }

  const snapshot = useAppStore.getState().groups[groupId];
  const acceptedMembers = snapshot?.members.filter((member) => member.status === "accepted") ?? [];
  const membersById = new Map(acceptedMembers.map((member) => [member.userId, member]));
  if (!membersById.has(me.id)) return null;

  const users = participantIds.map((userId) => {
    if (userId === me.id) return meToLegacyUser(me);
    const member = membersById.get(userId);
    return member ? profileToUser(member.user) : null;
  });
  if (users.some((user): user is null => user === null)) return null;
  return { users: users as User[], payerId };
}


export interface WizardInitInput {
  modes: WizardModes;
  me: Me | null;
  step: string;
  selectedGroupId: string | null;
  onSetSelectedGroupId: (groupId: string) => void;
  onSetBillType: (type: ExpenseType) => void;
  onSetStep: (step: Step) => void;
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
      billStore.updateExpense({ title: `Cobrança - ${counterpartyMember.user.name.split(" ")[0]}` });
      onSetBillType("single_amount");
      onSetStep("info");
    } else {
      billStore.createExpense("", "itemized", undefined, modes.dm.groupId);
      billStore.addParticipant(counterparty);
      onSetBillType("itemized");
      onSetStep("info");
    }
  }, [modes.dm, me, onSetSelectedGroupId, onSetIsDmMode, onSetBillType, onSetStep]);

  // Chat draft edit mode: consume ?groupId=<id>&title=<text>&amount=<cents>.
  useEffect(() => {
    if (!modes.chatDraft || !me || draftEditLoadedRef.current) return;
    draftEditLoadedRef.current = true;

    const chatDraft = modes.chatDraft;
    const explicitActors = chatDraft.participantIds !== undefined || chatDraft.payerId !== undefined;
    const actors = explicitActors
      ? resolveChatDraftActors(chatDraft.groupId, me, chatDraft.participantIds, chatDraft.payerId)
      : null;
    if (explicitActors && !actors) return;
    const billStore = useBillStore.getState();
    const currentUser = meToLegacyUser(me);
    billStore.setCurrentUser(currentUser);
    onSetSelectedGroupId(chatDraft.groupId);
    onSetIsDmMode(false);
    billStore.createExpense(
      chatDraft.title,
      chatDraft.expenseType,
      undefined,
      chatDraft.groupId,
    );
    billStore.updateExpense({ totalAmountInput: chatDraft.amountCents });
    onSetBillType(chatDraft.expenseType);

    if (actors) {
      for (const user of actors.users) {
        if (user.id !== currentUser.id) billStore.addParticipant(user);
      }
      if (chatDraft.expenseType === "single_amount") {
        // The chat message already named who splits and who paid, so the
        // draft opens with those actors applied.
        billStore.splitBillEqually(actors.users.map((user) => user.id));
        billStore.setPayerFull(actors.payerId);
      }
    } else {
      // No actor set in the URL: the draft opens with the group's accepted
      // members, the same as any other new bill for that group.
      const snapshot = useAppStore.getState().groups[chatDraft.groupId];
      for (const member of snapshot?.members ?? []) {
        if (member.userId === me.id || member.status !== "accepted") continue;
        billStore.addParticipant(profileToUser(member.user));
      }
    }

    onSetStep("info");
  }, [modes.chatDraft, me, onSetSelectedGroupId, onSetIsDmMode, onSetBillType, onSetStep]);

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
  }, [modes.editExpenseId, me, onSetIsEditing, onSetBillType, onSetSelectedGroupId, onSetStep]);

  useEffect(() => {
    const groupIdParam = modes.entryGroupId;
    if (!groupIdParam || modes.dm || selectedGroupId || step === "type" || !me) return;

    const snapshot = useAppStore.getState().groups[groupIdParam];
    if (!snapshot) return;

    onSetSelectedGroupId(groupIdParam);
    const billStore = useBillStore.getState();
    billStore.updateExpense({ groupId: groupIdParam });
    const hasOthers = billStore.participants.some((p) => p.id !== me.id);
    if (hasOthers) return;
    for (const member of snapshot.members) {
      if (member.userId === me.id || member.status !== "accepted") continue;
      billStore.addParticipant(profileToUser(member.user));
    }
  }, [step, modes.entryGroupId, modes.dm, selectedGroupId, me, onSetSelectedGroupId]);

  useEffect(() => {
    const stepParam = modes.entryStep;
    if (!stepParam || voiceStepRef.current) return;
    if (stepParam !== "payer" && stepParam !== "participants") return;
    const storeState = useBillStore.getState();
    if (storeState.expense) {
      voiceStepRef.current = true;
      onSetBillType(storeState.expense.expenseType);
      onSetStep(stepParam);
    }
  }, [modes.entryStep, onSetBillType, onSetStep]);
}
