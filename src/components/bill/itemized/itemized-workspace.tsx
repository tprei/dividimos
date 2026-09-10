"use client";

import type { ParticipantsStepProps } from "@/components/bill/wizard/participants-step";
import { ParticipantsSheet } from "@/components/bill/itemized/participants-sheet";
import { SectionContent, type SectionContentProps } from "@/components/bill/itemized/section-content";
import { SectionFooter } from "@/components/bill/itemized/section-footer";
import { SectionTabs } from "@/components/bill/itemized/section-tabs";
import type { ReviewIssue, ReviewParticipantTotal } from "@/components/bill/itemized/review-section";
import type { ItemizedSectionKey } from "@/components/bill/itemized-bill-form";
import type { ExpenseState } from "@/stores/bill-store";
import type { Expense } from "@/types";

export interface ItemizedWorkspaceProps {
  store: Pick<
    ExpenseState,
    | "items"
    | "participants"
    | "guests"
    | "splits"
    | "payers"
    | "updateItem"
    | "removeItem"
    | "addItem"
    | "setItemDivision"
    | "setPayerFull"
    | "splitPaymentEqually"
    | "setPayerAmount"
    | "removePayerEntry"
  >;
  expense: Expense | null;
  section: ItemizedSectionKey;
  onSectionChange: (section: ItemizedSectionKey) => void;
  amountInputs: Record<string, string>;
  invalidAmountIds: string[];
  serviceFeeInput: string;
  serviceFeeCents: number;
  grandTotal: number;
  totals: ReviewParticipantTotal[];
  partial: boolean;
  remainingCents: number;
  issues: ReviewIssue[];
  expandedId: string | null;
  participantsOpen: boolean;
  participants: ParticipantsStepProps;
  onParticipantsOpenChange: (open: boolean) => void;
  onAmountChange: (itemId: string, text: string) => void;
  onServiceFeeChange: (text: string) => void;
  onToggleItem: (itemId: string) => void;
  onSaveDivision: SectionContentProps["onSaveDivision"];
  onCancelDivision: SectionContentProps["onCancelDivision"];
  onFooter: () => void;
  isEditing: boolean;
  submitting: boolean;
}

export function ItemizedWorkspace({
  store,
  expense,
  section,
  onSectionChange,
  amountInputs,
  invalidAmountIds,
  serviceFeeInput,
  serviceFeeCents,
  grandTotal,
  totals,
  partial,
  remainingCents,
  issues,
  expandedId,
  participantsOpen,
  participants,
  onParticipantsOpenChange,
  onAmountChange,
  onServiceFeeChange,
  onToggleItem,
  onSaveDivision,
  onCancelDivision,
  onFooter,
  isEditing,
  submitting,
}: ItemizedWorkspaceProps) {
  return (
    <>
      <SectionTabs section={section} onChange={onSectionChange} />
      <SectionContent
        section={section}
        items={store.items}
        amountTexts={amountInputs}
        invalidAmountIds={invalidAmountIds}
        serviceFeeText={serviceFeeInput}
        serviceFeeCents={serviceFeeCents}
        fixedFees={expense?.fixedFees ?? 0}
        grandTotal={grandTotal}
        participants={store.participants}
        guests={store.guests}
        splits={store.splits}
        payers={store.payers}
        expense={expense}
        totals={totals}
        partial={partial}
        remainingCents={remainingCents}
        issues={issues}
        expandedId={expandedId}
        participantsOpen={participantsOpen}
        onDescriptionChange={(itemId, description) => store.updateItem(itemId, { description })}
        onAmountChange={onAmountChange}
        onServiceFeeChange={onServiceFeeChange}
        onRemoveItem={store.removeItem}
        onAddItem={store.addItem}
        onToggleItem={onToggleItem}
        onSaveDivision={onSaveDivision}
        onCancelDivision={onCancelDivision}
        onOpenParticipants={() => onParticipantsOpenChange(true)}
        onSetPayerFull={store.setPayerFull}
        onSplitPaymentEqually={store.splitPaymentEqually}
        onSetPayerAmount={store.setPayerAmount}
        onRemovePayerEntry={store.removePayerEntry}
      />
      <ParticipantsSheet
        open={participantsOpen}
        onOpenChange={onParticipantsOpenChange}
        participants={participants}
      />
      <SectionFooter
        label={section === "review" ? (isEditing ? "Salvar" : "Criar conta") : "Continuar"}
        disabled={submitting || (section === "review" && issues.length > 0)}
        onClick={onFooter}
      />
    </>
  );
}
