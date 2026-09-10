"use client";

import { useCallback, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { SingleBillDetails } from "@/components/bill/single-bill/details-section";
import { SingleBillDivision } from "@/components/bill/single-bill/division-section";
import { ScreenHeader } from "@/components/shared/screen-header";
import { Button } from "@/components/ui/button";
import { createGroup, getOrCreateDm } from "@/lib/sync/mutations-group";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { useBillStore } from "@/stores/bill-store";
import type { GroupSnapshot, Me, UserProfile } from "@/types/ledger";
import type { User } from "@/types";
import { useShallow } from "zustand/react/shallow";

export interface SingleBillFormProps {
  me: Me;
  groups: GroupSnapshot[];
  initialGroupId: string | null;
  isDmMode: boolean;
  isEditing: boolean;
  hasContactPicker: boolean;
  onPickContacts: () => Promise<void>;
  onBack: () => void;
  submit: (groupId: string | null) => Promise<boolean>;
}

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


export function SingleBillForm({
  me,
  groups,
  initialGroupId,
  isDmMode,
  isEditing,
  hasContactPicker,
  onPickContacts,
  onBack,
  submit,
}: SingleBillFormProps) {
  const store = useBillStore(
    useShallow((state) => ({
      expense: state.expense,
      totalAmountInput: state.totalAmountInput,
      occurredOn: state.occurredOn,
      participants: state.participants,
      guests: state.guests,
      payers: state.payers,
      billSplits: state.billSplits,
      updateExpense: state.updateExpense,
      setOccurredOn: state.setOccurredOn,
      addParticipant: state.addParticipant,
      removeParticipant: state.removeParticipant,
      addGuest: state.addGuest,
      removeGuest: state.removeGuest,
      setPayerFull: state.setPayerFull,
      splitBillEqually: state.splitBillEqually,
      splitBillByBasisPoints: state.splitBillByBasisPoints,
      splitBillByFixed: state.splitBillByFixed,
    })),
  );
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [groupSelection, setGroupSelection] = useState<string | null>(() =>
    isDmMode ? "dm" : initialGroupId,
  );
  const [seenInitialGroupId, setSeenInitialGroupId] = useState(initialGroupId);
  if (initialGroupId !== seenInitialGroupId) {
    setSeenInitialGroupId(initialGroupId);
    if (initialGroupId && !isDmMode && (groupSelection === null || groupSelection === seenInitialGroupId)) {
      setGroupSelection(initialGroupId);
    }
  }
  const [createGroupEnabled, setCreateGroupEnabled] = useState(!isDmMode);
  const [createGroupName, setCreateGroupName] = useState("");
  const [divisionValid, setDivisionValid] = useState(false);

  const allPeople = useMemo(
    () => [...store.participants, ...store.guests],
    [store.guests, store.participants],
  );
  const otherParticipants = useMemo(
    () => store.participants.filter((participant) => participant.id !== me.id),
    [me.id, store.participants],
  );
  const defaultGroupName = useMemo(() => {
    const names = allPeople.map((person) => person.name.split(" ")[0]);
    if (names.length === 0) return "";
    return names.length <= 3 ? names.join(" e ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  }, [allPeople]);
  const dmEligible = otherParticipants.length === 1 && store.guests.length === 0;
  const payerTotal = store.payers.reduce((sum, payer) => sum + payer.amountCents, 0);
  const hasPayer = store.payers.length > 0 && payerTotal === (store.totalAmountInput || 0);
  const totalCents = store.totalAmountInput || 0;
  const participantCount = allPeople.length;
  const title = store.expense?.title ?? "";
  const canSubmit = Boolean(
    store.expense &&
      title.trim() &&
      totalCents > 0 &&
      participantCount >= 2 &&
      divisionValid &&
      hasPayer,
  );

  const handleGroupSelect = useCallback(
    (value: string | null) => {
      setGroupSelection(value);
      setCreateGroupEnabled(value === "create" || value === null);
      if (value === "create" || value === "dm") return;
      const billStore = useBillStore.getState();
      for (const participant of billStore.participants) {
        if (participant.id !== me.id) billStore.removeParticipant(participant.id);
      }
      if (!value) return;
      const group = groups.find((snapshot) => snapshot.group.id === value);
      if (!group) return;
      for (const member of group.members) {
        if (member.userId === me.id || member.status !== "accepted") continue;
        billStore.addParticipant(profileToUser(member.user));
      }
    },
    [groups, me.id],
  );

  const resolveGroup = useCallback(async (): Promise<string | null | undefined> => {
    if (groupSelection && groupSelection !== "create" && groupSelection !== "dm") return groupSelection;
    const state = useBillStore.getState();
    const others = state.participants.filter((participant) => participant.id !== me.id);
    const hasGuests = state.guests.length > 0;
    const isDmCase =
      groupSelection === "dm" ||
      (groupSelection === null && others.length === 1 && !hasGuests);
    if (isDmCase) {
      if (others.length !== 1 || hasGuests) {
        toast.error("Conversa direta exige uma pessoa registrada.");
        return undefined;
      }
      if (isDmMode && initialGroupId) return initialGroupId;
      try {
        const dm = await getOrCreateDm(others[0].id);
        setGroupSelection(dm.groupId);
        setCreateGroupEnabled(false);
        return dm.groupId;
      } catch (error) {
        toast.error(ledgerErrorMessage(error));
        return undefined;
      }
    }
    const needsGroup = others.length > 0 || hasGuests;
    if (groupSelection === "create" || (groupSelection === null && needsGroup)) {
      if (!createGroupEnabled) {
        toast.error('Escolha um grupo existente ou deixe "Criar grupo" marcado.');
        return undefined;
      }
      try {
        const ack = await createGroup(
          createGroupName.trim() || defaultGroupName || "Novo grupo",
          others.map((participant) => participant.id),
        );
        setGroupSelection(ack.groupId);
        setCreateGroupEnabled(false);
        return ack.groupId;
      } catch (error) {
        toast.error(ledgerErrorMessage(error));
        return undefined;
      }
    }
    return null;
  }, [createGroupEnabled, createGroupName, defaultGroupName, groupSelection, initialGroupId, isDmMode, me.id]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    const groupId = await resolveGroup();
    if (groupId === undefined) return;
    await submit(groupId);
  }, [canSubmit, resolveGroup, submit]);

  return (
    <div className="mx-auto max-w-lg">
      <ScreenHeader
        back
        onBack={onBack}
        eyebrow="Valor único"
        title={isEditing ? "Editar conta" : "Nova conta"}
      />
      <SingleBillDetails
        me={me}
        groups={groups}
        totalCents={totalCents}
        title={title}
        occurredOn={store.occurredOn ?? ""}
        groupSelection={groupSelection}
        createGroupName={createGroupName}
        createGroupEnabled={createGroupEnabled}
        defaultGroupName={defaultGroupName}
        dmEligible={dmEligible}
        participants={store.participants}
        guests={store.guests}
        payers={store.payers}
        participantCount={participantCount}
        hasPayer={hasPayer}
        participantsOpen={participantsOpen}
        hasContactPicker={hasContactPicker}
        onTotalChange={(cents) => store.updateExpense({ totalAmountInput: cents, totalAmount: cents })}
        onTitleChange={(nextTitle) => store.updateExpense({ title: nextTitle })}
        onOccurredOnChange={store.setOccurredOn}
        onGroupSelect={handleGroupSelect}
        onCreateGroupNameChange={setCreateGroupName}
        onToggleCreateGroup={setCreateGroupEnabled}
        onPayerSelect={store.setPayerFull}
        onParticipantsOpenChange={setParticipantsOpen}
        onAddParticipant={(profile) => store.addParticipant(profileToUser(profile))}
        onRemoveParticipant={store.removeParticipant}
        onAddGuest={store.addGuest}
        onRemoveGuest={store.removeGuest}
        onPickContacts={onPickContacts}
      />
      <div className="px-4 pb-4">
        <SingleBillDivision
          totalCents={totalCents}
          participants={store.participants}
          guests={store.guests}
          billSplits={store.billSplits}
          splitBillEqually={store.splitBillEqually}
          splitBillByBasisPoints={store.splitBillByBasisPoints}
          splitBillByFixed={store.splitBillByFixed}
          onValidityChange={setDivisionValid}
        />
      </div>
      <footer className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur safe-bottom">
        <Button
          type="button"
          size="lg"
          className="h-12 w-full text-base font-bold"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          aria-describedby="single-bill-division-status"
        >
          {isEditing ? "Salvar" : "Criar conta"}
        </Button>
      </footer>
    </div>
  );
}
