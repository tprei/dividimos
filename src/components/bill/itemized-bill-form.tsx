"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { todayIsoDate } from "@/app/app/bill/new/use-wizard-submit";
import { ScreenHeader } from "@/components/shared/screen-header";
import { ItemizedWorkspace } from "@/components/bill/itemized/itemized-workspace";
import { useItemizedIssues } from "@/components/bill/itemized/use-itemized-issues";
import { useBackHandler } from "@/hooks/use-back-handler";
import { computeServiceFeeCents, parseExpenseCentsText, parseServiceFeeBasisPointsText } from "@/lib/expense-money";
import { unitPriceCentsForLineTotal } from "@/lib/expense-quantity";
import { assignedDivisionForItem } from "@/lib/item-division";
import { useBillStore } from "@/stores/bill-store";
import type { GroupSnapshot, Me, UserProfile } from "@/types/ledger";
import { useShallow } from "zustand/react/shallow";

export type ItemizedSectionKey = "account" | "items" | "split" | "payment" | "review";

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

const SECTION_ORDER: ItemizedSectionKey[] = ["account", "items", "split", "payment", "review"];

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [serviceFeeInput, setServiceFeeInput] = useState(() =>
    serviceFeeText(store.expense?.serviceFeeBasisPoints ?? 0),
  );
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const focusTitlePending = useRef(false);

  useEffect(() => {
    if (section === "account" && focusTitlePending.current) {
      focusTitlePending.current = false;
      titleRef.current?.focus();
    }
  }, [section]);

  useBackHandler(expandedId !== null && !participantsOpen, () => setExpandedId(null));

  const expense = store.expense;
  const grandTotal = store.getGrandTotal();
  const itemsTotal = store.items.reduce((sum, item) => sum + item.totalPriceCents, 0);
  const serviceFeeResult = computeServiceFeeCents(itemsTotal, expense?.serviceFeeBasisPoints ?? 0);
  const serviceFeeCents = serviceFeeResult.ok ? serviceFeeResult.value : 0;
  const billPeopleIds = new Set<string>([
    ...store.participants.map((participant) => participant.id),
    ...store.guests.map((guest) => guest.id),
  ]);
  const unresolvedItems: typeof store.items = [];
  let assignedItemCents = 0;
  for (const item of store.items) {
    const division = assignedDivisionForItem(item, store.splits, billPeopleIds);
    if (!division) {
      unresolvedItems.push(item);
      continue;
    }
    assignedItemCents += division.shares.reduce((sum, share) => sum + share.cents, 0);
  }
  const partial = unresolvedItems.length > 0;
  const remainingCents = partial ? Math.max(0, itemsTotal - assignedItemCents) : 0;
  const paidTotal = store.payers.reduce((sum, payer) => sum + payer.amountCents, 0);
  const dmEligible = store.participants.filter((participant) => participant.id !== me.id).length === 1 && store.guests.length === 0;
  const accountReady = Boolean(expense?.title.trim()) && store.participants.length + store.guests.length >= 2;
  const occurredOn = store.occurredOn ?? todayIsoDate();

  const resolveTitle = useCallback(() => {
    focusTitlePending.current = true;
    setSection("account");
  }, []);
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
      <ItemizedWorkspace
        store={store}
        expense={expense}
        occurredOn={occurredOn}
        groupValue={selectedGroupId ?? groupSelection}
        dmEligible={dmEligible}
        accountReady={accountReady}
        titleRef={titleRef}
        section={section}
        onSectionChange={setSection}
        amountInputs={amountInputs}
        invalidAmountIds={invalidAmountIds}
        serviceFeeInput={serviceFeeInput}
        serviceFeeCents={serviceFeeCents}
        grandTotal={grandTotal}
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
        onCloseDivision={() => setExpandedId(null)}
        onAssignSelected={(itemIds, personIds) => {
          store.assignItemsEqually(itemIds, personIds);
          setExpandedId(null);
        }}
        onFooter={() => void handleFooter()}
        isEditing={isEditing}
        submitting={submitting}
      />
    </div>
  );
}
