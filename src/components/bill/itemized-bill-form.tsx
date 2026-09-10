"use client";

import { useCallback, useRef, useState } from "react";
import { ScreenHeader } from "@/components/shared/screen-header";
import { GroupSelect } from "@/components/bill/group-select";
import type { ReviewParticipantTotal } from "@/components/bill/itemized/review-section";
import { ItemizedWorkspace } from "@/components/bill/itemized/itemized-workspace";
import { useItemizedIssues } from "@/components/bill/itemized/use-itemized-issues";
import { Input } from "@/components/ui/input";
import { useBackHandler } from "@/hooks/use-back-handler";
import { computeServiceFeeCents, parseExpenseCentsText, parseServiceFeeBasisPointsText } from "@/lib/expense-money";
import { unitPriceCentsForLineTotal } from "@/lib/expense-quantity";
import { divisionForItem } from "@/lib/item-division";
import { useBillStore, type Guest } from "@/stores/bill-store";
import type { User } from "@/types";
import type { GroupSnapshot, Me, UserProfile } from "@/types/ledger";
import { useShallow } from "zustand/react/shallow";

export type ItemizedSectionKey = "items" | "split" | "payment" | "review";

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
}

const SECTION_ORDER: ItemizedSectionKey[] = ["items", "split", "payment", "review"];

function serviceFeeText(basisPoints: number): string {
  return String(basisPoints / 100).replace(".", ",");
}

function participantTotals(
  participants: User[],
  guests: Guest[],
  getParticipantTotal: (id: string) => number,
): ReviewParticipantTotal[] {
  return [
    ...participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      avatarUrl: participant.avatarUrl ?? null,
      isGuest: false,
      cents: getParticipantTotal(participant.id),
    })),
    ...guests.map((guest) => ({
      id: guest.id,
      name: guest.name,
      avatarUrl: null,
      isGuest: true,
      cents: getParticipantTotal(guest.id),
    })),
  ];
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
  initialSection = "items",
}: ItemizedBillFormProps) {
  const store = useBillStore(
    useShallow((state) => ({
      expense: state.expense,
      participants: state.participants,
      guests: state.guests,
      items: state.items,
      splits: state.splits,
      payers: state.payers,
      updateExpense: state.updateExpense,
      updateItem: state.updateItem,
      removeItem: state.removeItem,
      addItem: state.addItem,
      setItemDivision: state.setItemDivision,
      setPayerFull: state.setPayerFull,
      splitPaymentEqually: state.splitPaymentEqually,
      setPayerAmount: state.setPayerAmount,
      removePayerEntry: state.removePayerEntry,
      getGrandTotal: state.getGrandTotal,
      getParticipantTotal: state.getParticipantTotal,
    })),
  );
  const [section, setSection] = useState<ItemizedSectionKey>(initialSection);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [serviceFeeInput, setServiceFeeInput] = useState(() =>
    serviceFeeText(store.expense?.serviceFeeBasisPoints ?? 0),
  );
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>({});
  const titleRef = useRef<HTMLInputElement>(null);

  useBackHandler(expandedId !== null && !participantsOpen, () => setExpandedId(null));

  const expense = store.expense;
  const grandTotal = store.getGrandTotal();
  const itemsTotal = store.items.reduce((sum, item) => sum + item.totalPriceCents, 0);
  const serviceFeeResult = computeServiceFeeCents(itemsTotal, expense?.serviceFeeBasisPoints ?? 0);
  const serviceFeeCents = serviceFeeResult.ok ? serviceFeeResult.value : 0;
  const unresolvedItems = store.items.filter((item) => !divisionForItem(item, store.splits));
  const assignedItemCents = store.items.reduce((sum, item) => {
    const division = divisionForItem(item, store.splits);
    return sum + (division?.shares.reduce((itemSum, share) => itemSum + share.cents, 0) ?? 0);
  }, 0);
  const partial = unresolvedItems.length > 0;
  const remainingCents = partial ? Math.max(0, itemsTotal - assignedItemCents) : 0;
  const totals = participantTotals(store.participants, store.guests, store.getParticipantTotal);
  const paidTotal = store.payers.reduce((sum, payer) => sum + payer.amountCents, 0);
  const dmEligible = store.participants.filter((participant) => participant.id !== me.id).length === 1 && store.guests.length === 0;

  const resolveTitle = useCallback(() => titleRef.current?.focus(), []);
  const issues = useItemizedIssues({
    title: expense?.title,
    itemCount: store.items.length,
    unresolvedItems,
    grandTotal,
    paidTotal,
    onResolveTitle: resolveTitle,
    onSectionChange: setSection,
    onExpandItem: setExpandedId,
  });

  const [groupSelection, setGroupSelection] = useState<string | null>(selectedGroupId);
  const handleGroupSelect = (value: string | null) => {
    setGroupSelection(value);
    const groupId = value === "create" || value === "dm" ? null : value;
    onSelectGroup(groupId);
    store.updateExpense({ groupId: groupId ?? "" });
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

  const handleFooter = async () => {
    if (section === "review") {
      await onSubmit();
      return;
    }
    const index = SECTION_ORDER.indexOf(section);
    setSection(SECTION_ORDER[Math.min(index + 1, SECTION_ORDER.length - 1)]);
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
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col pb-20">
      <ScreenHeader back onBack={onBack} eyebrow="Nova conta" title="Conta detalhada" />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)] gap-2 px-4">
        <Input
          ref={titleRef}
          value={expense?.title ?? ""}
          onChange={(event) => store.updateExpense({ title: event.target.value })}
          placeholder="Nome da conta"
          aria-label="Nome da conta"
          className="h-11 min-w-0 rounded-xl"
        />
        <GroupSelect
          value={selectedGroupId ?? groupSelection}
          groups={groups}
          onSelect={handleGroupSelect}
          createValue={createGroupName}
          onCreateValueChange={onCreateGroupName}
          createGroupEnabled={createGroupEnabled}
          onToggleCreateGroup={onToggleCreateGroup}
          dmEligible={dmEligible}
        />
      </div>
      <ItemizedWorkspace
        store={store}
        expense={expense}
        section={section}
        onSectionChange={setSection}
        amountInputs={amountInputs}
        invalidAmountIds={invalidAmountIds}
        serviceFeeInput={serviceFeeInput}
        serviceFeeCents={serviceFeeCents}
        grandTotal={grandTotal}
        totals={totals}
        partial={partial}
        remainingCents={remainingCents}
        issues={issues}
        expandedId={expandedId}
        participantsOpen={participantsOpen}
        participants={participantsStepProps}
        onParticipantsOpenChange={setParticipantsOpen}
        onAmountChange={handleAmountChange}
        onServiceFeeChange={handleServiceFeeChange}
        onToggleItem={(itemId) => setExpandedId((current) => (current === itemId ? null : itemId))}
        onSaveDivision={(itemId, value) => {
          store.setItemDivision(itemId, value);
          setExpandedId(null);
        }}
        onCancelDivision={() => setExpandedId(null)}
        onFooter={() => void handleFooter()}
        isEditing={isEditing}
        submitting={submitting}
      />
    </div>
  );
}
