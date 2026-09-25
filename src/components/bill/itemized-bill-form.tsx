"use client";

import { X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { todayIsoDate } from "@/app/app/bill/new/use-wizard-submit";
import { ScreenHeader } from "@/components/shared/screen-header";
import { Button } from "@/components/ui/button";
import { ITEMIZED_SECTIONS, ItemizedWorkspace } from "@/components/bill/itemized/itemized-workspace";
import type { SplitPerson } from "@/components/bill/split/split-editor";
import { usePayerSplit } from "@/components/bill/split/use-payer-split";
import { initialStartProgress } from "@/components/bill/wizard/details-step";
import { useBackHandler } from "@/hooks/use-back-handler";
import { computeServiceFeeCents, parseExpenseCentsText, parseServiceFeeBasisPointsText } from "@/lib/expense-money";
import { unitPriceCentsForLineTotal } from "@/lib/expense-quantity";
import { assignedDivisionForItem } from "@/lib/item-division";
import { displayNames } from "@/lib/people";
import { useBillStore } from "@/stores/bill-store";
import type { GroupSnapshot, Me, UserProfile } from "@/types/ledger";
import { useShallow } from "zustand/react/shallow";

export type ItemizedSectionKey = "account" | "items" | "split" | "payment";

export interface ItemizedBillFormProps {
  me: Me;
  groups: GroupSnapshot[];
  selectedGroupId: string | null;
  createGroupEnabled: boolean;
  createGroupName: string;
  hasContactPicker: boolean;
  onSelectGroup: (groupId: string | null) => void;
  onToggleCreateGroup: (enabled: boolean) => void;
  onCreateGroupName: (name: string) => void;
  onAddParticipant: (profile: UserProfile) => void;
  onRemoveParticipant: (id: string) => void;
  onAddGuest: (name: string, phone?: string) => void;
  onRemoveGuest: (id: string) => void;
  onPickContacts: () => Promise<void>;
  onSubmit: () => Promise<boolean>;
  onBack: () => void;
  isEditing?: boolean;
  submitting?: boolean;
  initialSection?: ItemizedSectionKey;
  conflictPanel?: ReactNode;
  conflictBlocked?: boolean;
}

function serviceFeeText(basisPoints: number): string {
  return String(basisPoints / 100).replace(".", ",");
}

export function ItemizedBillForm({
  me,
  groups,
  selectedGroupId,
  createGroupEnabled,
  createGroupName,
  hasContactPicker,
  onSelectGroup,
  onToggleCreateGroup,
  onCreateGroupName,
  onAddParticipant,
  onRemoveParticipant,
  onAddGuest,
  onRemoveGuest,
  onPickContacts,
  onSubmit,
  onBack,
  isEditing = false,
  submitting = false,
  initialSection = "account",
  conflictPanel,
  conflictBlocked = false,
}: ItemizedBillFormProps) {
  const store = useBillStore(
    useShallow((state) => ({
      expense: state.expense,
      occurredOn: state.occurredOn,
      participants: state.participants,
      guests: state.guests,
      items: state.items,
      splits: state.splits,
      payers: state.payers,
      updateExpense: state.updateExpense,
      updateItem: state.updateItem,
      setOccurredOn: state.setOccurredOn,
      removeItem: state.removeItem,
      addItem: state.addItem,
      setItemDivision: state.setItemDivision,
      unassignItem: state.unassignItem,
      assignItemsEqually: state.assignItemsEqually,
      setPayerFull: state.setPayerFull,
      splitPaymentEqually: state.splitPaymentEqually,
      setPayerAmount: state.setPayerAmount,
      removePayerEntry: state.removePayerEntry,
      getGrandTotal: state.getGrandTotal,
      getParticipantTotal: state.getParticipantTotal,
    })),
  );
  const [section, setSection] = useState<ItemizedSectionKey>(initialSection);
  const [startProgress, setStartProgress] = useState(() =>
    initialStartProgress(useBillStore.getState().expense?.title ?? ""),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [serviceFeeInput, setServiceFeeInput] = useState(() =>
    serviceFeeText(store.expense?.serviceFeeBasisPoints ?? 0),
  );
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>({});
  const [pickerSentinel, setPickerSentinel] = useState<string | null>(null);

  useBackHandler(true, () => {
    const index = ITEMIZED_SECTIONS.indexOf(section);
    if (expandedId !== null) setExpandedId(null);
    else if (index > 0) setSection(ITEMIZED_SECTIONS[index - 1]);
    else onBack();
  });

  const expense = store.expense;
  const grandTotal = store.getGrandTotal();
  const itemsTotal = store.items.reduce((sum, item) => sum + item.totalPriceCents, 0);
  const serviceFeeResult = computeServiceFeeCents(itemsTotal, expense?.serviceFeeBasisPoints ?? 0);
  const serviceFeeCents = serviceFeeResult.ok ? serviceFeeResult.value : 0;
  const fixedFees = expense?.fixedFees ?? 0;
  const people = useMemo(
    () => [
      ...store.participants.map((participant) => ({
        id: participant.id,
        name: participant.name,
        handle: participant.handle,
        avatarUrl: participant.avatarUrl ?? null,
        isGuest: false,
      })),
      ...store.guests.map((guest) => ({
        id: guest.id,
        name: guest.name,
        handle: null,
        avatarUrl: null,
        isGuest: true,
      })),
    ],
    [store.guests, store.participants],
  );
  const participantIds = useMemo(
    () => store.participants.map((participant) => participant.id),
    [store.participants],
  );
  const labels = displayNames(people, { style: "short", viewerId: me.id });
  const splitPeople: SplitPerson[] = people.map((person) => ({
    id: person.id,
    label: labels.get(person.id) ?? person.name,
    name: person.name,
    avatarUrl: person.avatarUrl,
    isGuest: person.isGuest,
  }));
  const billPeopleIds = new Set(people.map((person) => person.id));
  let unresolvedCount = 0;
  let assignedItemCents = 0;
  for (const item of store.items) {
    const division = assignedDivisionForItem(item, store.splits, billPeopleIds);
    if (!division) {
      unresolvedCount += 1;
      continue;
    }
    assignedItemCents += division.shares.reduce((sum, share) => sum + share.cents, 0);
  }
  const partial = unresolvedCount > 0;
  const remainingCents = partial ? Math.max(0, itemsTotal - assignedItemCents) : 0;
  const payers = usePayerSplit({
    participantIds,
    totalCents: grandTotal,
    initialPayers: () => useBillStore.getState().payers,
    fallbackId: me.id,
    actions: store,
  });
  const others = store.participants.filter((participant) => participant.id !== me.id);
  const dmEligible = others.length === 1 && store.guests.length === 0;
  const selectedGroup = groups.find((snapshot) => snapshot.group.id === selectedGroupId) ?? null;
  const inviteeNames = selectedGroup
    ? others
        .filter((participant) => !selectedGroup.members.some((member) => member.userId === participant.id))
        .map((participant) => labels.get(participant.id))
    : [];

  const handleGroupSelect = (value: string | null) => {
    if (value === "create" || value === "dm") {
      setPickerSentinel(value);
      onSelectGroup(null);
      return;
    }
    setPickerSentinel(null);
    onSelectGroup(value);
  };

  const handleAmountChange = (itemId: string, text: string) => {
    setAmountInputs((current) => ({ ...current, [itemId]: text }));
    const parsed = parseExpenseCentsText(text, { format: "plain_decimal", zeroPolicy: "positive" });
    if (!parsed.ok) return;
    const item = store.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const unitPriceCents = unitPriceCentsForLineTotal(item.quantity, parsed.value);
    if (unitPriceCents === null) return;
    store.updateItem(itemId, { unitPriceCents, totalPriceCents: parsed.value });
  };

  const invalidAmountIds = store.items.flatMap((item) => {
    const text = amountInputs[item.id];
    if (text === undefined) return [];
    const parsed = parseExpenseCentsText(text, { format: "plain_decimal", zeroPolicy: "positive" });
    if (parsed.ok && unitPriceCentsForLineTotal(item.quantity, parsed.value) !== null) return [];
    return [item.id];
  });

  const handleServiceFeeChange = (text: string) => {
    setServiceFeeInput(text);
    const parsed = parseServiceFeeBasisPointsText(text);
    if (!parsed.ok) return;
    store.updateExpense({ serviceFeeBasisPoints: parsed.value, serviceFeePercent: parsed.value / 100 });
  };

  const participantsStepProps = {
    me,
    participants: store.participants,
    guests: store.guests,
    selectedGroupId,
    groups,
    createGroup: { enabled: createGroupEnabled, name: createGroupName },
    onToggleCreateGroup,
    onCreateGroupName,
    onSelectGroup: handleGroupSelect,
    onAddParticipant,
    onRemoveParticipant,
    onAddGuest,
    onRemoveGuest,
    hasContactPicker,
    onPickContacts,
  };

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col pb-[env(safe-area-inset-bottom)] md:max-w-2xl">
      <ScreenHeader
        title={isEditing ? "Editar conta" : "Nova conta"}
        subtitle="Vários itens"
        action={
          <Button variant="ghost" size="icon-lg" aria-label="Fechar" onClick={onBack}>
            <X className="size-5" />
          </Button>
        }
      />
      {conflictPanel}
      <ItemizedWorkspace
        conflictBlocked={conflictBlocked}
        store={store}
        section={section}
        onSectionChange={setSection}
        details={{
          title: expense?.title ?? "",
          onTitleChange: (title) => store.updateExpense({ title }),
          occurredOn: store.occurredOn ?? todayIsoDate(),
          onOccurredOnChange: store.setOccurredOn,
          group: {
            value: selectedGroupId ?? pickerSentinel,
            groups,
            onSelect: handleGroupSelect,
            createValue: createGroupName,
            onCreateValueChange: onCreateGroupName,
            createGroupEnabled,
            onToggleCreateGroup,
            dmEligible,
          },
          note:
            inviteeNames.length > 0
              ? `${inviteeNames.join(", ")} ${inviteeNames.length > 1 ? "serão convidados" : "será convidado"} ao grupo.`
              : null,
          progress: startProgress,
          onProgressChange: setStartProgress,
        }}
        participants={participantsStepProps}
        payment={{
          payers: splitPeople.filter((person) => !person.isGuest),
          mode: payers.draft.mode,
          onModeChange: payers.setMode,
          included: payers.draft.included,
          onToggle: payers.toggle,
          basisPointsById: payers.draft.percent.shares,
          centsById: payers.centsById,
          onShareChange: payers.setShare,
          onSplitEvenly: payers.canSplitEvenly ? payers.splitEvenly : null,
          remainderCents: payers.remainderCents,
          summary: splitPeople.map((person) => ({
            ...person,
            consumedCents: store.getParticipantTotal(person.id),
            paidCents: payers.centsById[person.id] ?? 0,
          })),
          itemsCents: itemsTotal,
          serviceFeeCents,
          fixedFeesCents: fixedFees,
          grandTotal,
          hasGuests: store.guests.length > 0,
        }}
        amountInputs={amountInputs}
        invalidAmountIds={invalidAmountIds}
        serviceFeeInput={serviceFeeInput}
        serviceFeeCents={serviceFeeCents}
        fixedFees={fixedFees}
        grandTotal={grandTotal}
        partial={partial}
        remainingCents={remainingCents}
        expandedId={expandedId}
        onAmountChange={handleAmountChange}
        onServiceFeeChange={handleServiceFeeChange}
        onToggleItem={(itemId) => setExpandedId((current) => (current === itemId ? null : itemId))}
        onSaveDivision={store.setItemDivision}
        onCloseDivision={() => setExpandedId(null)}
        onAssignSelected={(itemIds, personIds) => {
          store.assignItemsEqually(itemIds, personIds);
          setExpandedId(null);
        }}
        onSubmit={() => void onSubmit()}
        isEditing={isEditing}
        submitting={submitting}
      />
    </div>
  );
}
