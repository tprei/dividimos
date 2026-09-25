"use client";

import { ItemsSection, type ItemsSectionProps } from "@/components/bill/itemized/items-section";
import { PaymentSection, type PaymentSectionProps } from "@/components/bill/itemized/payment-section";
import { SplitSection, type SplitSectionProps } from "@/components/bill/itemized/split-section";
import { DetailsStep, type DetailsStepProps } from "@/components/bill/wizard/details-step";
import type { ItemizedSectionKey } from "@/components/bill/itemized-bill-form";
import type { ExpenseSplit, Guest } from "@/stores/bill-store";
import type { ExpenseItem, User } from "@/types";

export interface SectionContentProps {
  viewerId: string;
  section: ItemizedSectionKey;
  details: DetailsStepProps;
  payment: PaymentSectionProps;
  items: ExpenseItem[];
  amountTexts: Record<string, string>;
  invalidAmountIds: string[];
  serviceFeeText: string;
  serviceFeeCents: number;
  fixedFees: number;
  grandTotal: number;
  participants: User[];
  guests: Guest[];
  splits: ExpenseSplit[];
  expandedId: SplitSectionProps["expandedId"];
  onDescriptionChange: ItemsSectionProps["onDescriptionChange"];
  onAmountChange: ItemsSectionProps["onAmountChange"];
  onServiceFeeChange: ItemsSectionProps["onServiceFeeChange"];
  onRemoveItem: ItemsSectionProps["onRemoveItem"];
  onAddItem: ItemsSectionProps["onAddItem"];
  onToggleItem: SplitSectionProps["onToggleItem"];
  onSaveDivision: SplitSectionProps["onSaveDivision"];
  onUnassign: SplitSectionProps["onUnassign"];
  onCloseDivision: SplitSectionProps["onCloseDivision"];
  onAssignSelected: SplitSectionProps["onAssignSelected"];
}

export function SectionContent({
  viewerId,
  section,
  details,
  payment,
  items,
  amountTexts,
  invalidAmountIds,
  serviceFeeText,
  serviceFeeCents,
  fixedFees,
  grandTotal,
  participants,
  guests,
  splits,
  expandedId,
  onDescriptionChange,
  onAmountChange,
  onServiceFeeChange,
  onRemoveItem,
  onAddItem,
  onToggleItem,
  onSaveDivision,
  onUnassign,
  onCloseDivision,
  onAssignSelected,
}: SectionContentProps) {
  if (section === "account") {
    return <DetailsStep {...details} />;
  }
  if (section === "items") {
    return (
      <ItemsSection
        items={items}
        amountTexts={amountTexts}
        invalidAmountIds={invalidAmountIds}
        serviceFeeText={serviceFeeText}
        serviceFeeCents={serviceFeeCents}
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
        viewerId={viewerId}
        items={items}
        participants={participants}
        guests={guests}
        splits={splits}
        serviceFeeCents={serviceFeeCents}
        fixedFees={fixedFees}
        grandTotal={grandTotal}
        expandedId={expandedId}
        onToggleItem={onToggleItem}
        onSaveDivision={onSaveDivision}
        onUnassign={onUnassign}
        onCloseDivision={onCloseDivision}
        onAssignSelected={onAssignSelected}
      />
    );
  }
  return <PaymentSection {...payment} />;
}
