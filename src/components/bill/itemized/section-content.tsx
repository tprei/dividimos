"use client";

import { ItemsSection, type ItemsSectionProps } from "@/components/bill/itemized/items-section";
import { PaymentSection, type PaymentSectionProps } from "@/components/bill/itemized/payment-section";
import { ReviewSection, type ReviewSectionProps } from "@/components/bill/itemized/review-section";
import { SplitSection, type SplitSectionProps } from "@/components/bill/itemized/split-section";
import type { ItemizedSectionKey } from "@/components/bill/itemized-bill-form";
import type { ExpenseSplit, Guest } from "@/stores/bill-store";
import type { Expense, ExpenseItem, ExpensePayer, User } from "@/types";

export interface SectionContentProps {
  section: ItemizedSectionKey;
  items: ExpenseItem[];
  amountTexts: Record<string, string>;
  serviceFeeText: string;
  serviceFeeCents: number;
  fixedFees: number;
  grandTotal: number;
  participants: User[];
  guests: Guest[];
  splits: ExpenseSplit[];
  payers: ExpensePayer[];
  expense: Expense | null;
  totals: ReviewSectionProps["totals"];
  partial: boolean;
  remainingCents: number;
  issues: ReviewSectionProps["issues"];
  expandedId: SplitSectionProps["expandedId"];
  participantsOpen: SplitSectionProps["participantsOpen"];
  onDescriptionChange: ItemsSectionProps["onDescriptionChange"];
  onAmountChange: ItemsSectionProps["onAmountChange"];
  onServiceFeeChange: ItemsSectionProps["onServiceFeeChange"];
  onRemoveItem: ItemsSectionProps["onRemoveItem"];
  onAddItem: ItemsSectionProps["onAddItem"];
  onToggleItem: SplitSectionProps["onToggleItem"];
  onSaveDivision: SplitSectionProps["onSaveDivision"];
  onCancelDivision: SplitSectionProps["onCancelDivision"];
  onOpenParticipants: SplitSectionProps["onOpenParticipants"];
  onSetPayerFull: PaymentSectionProps["onSetPayerFull"];
  onSplitPaymentEqually: PaymentSectionProps["onSplitPaymentEqually"];
  onSetPayerAmount: PaymentSectionProps["onSetPayerAmount"];
  onRemovePayerEntry: PaymentSectionProps["onRemovePayerEntry"];
}

export function SectionContent({
  section,
  items,
  amountTexts,
  serviceFeeText,
  serviceFeeCents,
  fixedFees,
  grandTotal,
  participants,
  guests,
  splits,
  payers,
  expense,
  totals,
  partial,
  remainingCents,
  issues,
  expandedId,
  participantsOpen,
  onDescriptionChange,
  onAmountChange,
  onServiceFeeChange,
  onRemoveItem,
  onAddItem,
  onToggleItem,
  onSaveDivision,
  onCancelDivision,
  onOpenParticipants,
  onSetPayerFull,
  onSplitPaymentEqually,
  onSetPayerAmount,
  onRemovePayerEntry,
}: SectionContentProps) {
  if (section === "items") {
    return (
      <ItemsSection
        items={items}
        amountTexts={amountTexts}
        serviceFeeText={serviceFeeText}
        fixedFees={fixedFees}
        grandTotal={grandTotal}
        onDescriptionChange={onDescriptionChange}
        onAmountChange={onAmountChange}
        onServiceFeeChange={onServiceFeeChange}
        onRemoveItem={onRemoveItem}
        onAddItem={onAddItem}
      />
    );
  }
  if (section === "split") {
    return (
      <SplitSection
        items={items}
        participants={participants}
        guests={guests}
        splits={splits}
        serviceFeeCents={serviceFeeCents}
        fixedFees={fixedFees}
        grandTotal={grandTotal}
        expandedId={expandedId}
        participantsOpen={participantsOpen}
        onToggleItem={onToggleItem}
        onSaveDivision={onSaveDivision}
        onCancelDivision={onCancelDivision}
        onOpenParticipants={onOpenParticipants}
      />
    );
  }
  if (section === "payment") {
    return (
      <PaymentSection
        participants={participants}
        payers={payers}
        grandTotal={grandTotal}
        onSetPayerFull={onSetPayerFull}
        onSplitPaymentEqually={onSplitPaymentEqually}
        onSetPayerAmount={onSetPayerAmount}
        onRemovePayerEntry={onRemovePayerEntry}
      />
    );
  }
  return (
    <ReviewSection
      expense={expense}
      items={items}
      splits={splits}
      participants={participants}
      guests={guests}
      payers={payers}
      totals={totals}
      partial={partial}
      remainingCents={remainingCents}
      issues={issues}
    />
  );
}
