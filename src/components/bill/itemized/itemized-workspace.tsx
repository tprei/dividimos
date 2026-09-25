"use client";

import type { PaymentSectionProps } from "@/components/bill/itemized/payment-section";
import { SectionContent, type SectionContentProps } from "@/components/bill/itemized/section-content";
import { SectionFooter } from "@/components/bill/itemized/section-footer";
import { SectionTabs } from "@/components/bill/itemized/section-tabs";
import type { DetailsStepProps } from "@/components/bill/wizard/details-step";
import type { ParticipantsStepProps } from "@/components/bill/wizard/participants-step";
import type { ItemizedSectionKey } from "@/components/bill/itemized-bill-form";
import { formatBRL } from "@/lib/currency";
import type { ExpenseState } from "@/stores/bill-store";

export interface ItemizedWorkspaceProps {
  store: Pick<
    ExpenseState,
    "items" | "participants" | "guests" | "splits" | "payers" | "updateItem" | "removeItem" | "addItem"
  >;
  section: ItemizedSectionKey;
  onSectionChange: (section: ItemizedSectionKey) => void;
  details: Omit<DetailsStepProps, "participants">;
  payment: PaymentSectionProps;
  amountInputs: Record<string, string>;
  invalidAmountIds: string[];
  serviceFeeInput: string;
  serviceFeeCents: number;
  fixedFees: number;
  grandTotal: number;
  partial: boolean;
  remainingCents: number;
  expandedId: string | null;
  participants: ParticipantsStepProps;
  onAmountChange: (itemId: string, text: string) => void;
  onServiceFeeChange: (text: string) => void;
  onToggleItem: (itemId: string) => void;
  onSaveDivision: SectionContentProps["onSaveDivision"];
  onCloseDivision: SectionContentProps["onCloseDivision"];
  onAssignSelected: SectionContentProps["onAssignSelected"];
  onFooter: () => void;
  isEditing: boolean;
  submitting: boolean;
  conflictBlocked?: boolean;
}

export function ItemizedWorkspace({
  store,
  section,
  onSectionChange,
  details,
  payment,
  amountInputs,
  invalidAmountIds,
  serviceFeeInput,
  serviceFeeCents,
  fixedFees,
  grandTotal,
  partial,
  remainingCents,
  expandedId,
  participants,
  onAmountChange,
  onServiceFeeChange,
  onToggleItem,
  onSaveDivision,
  onCloseDivision,
  onAssignSelected,
  onFooter,
  isEditing,
  submitting,
  conflictBlocked,
}: ItemizedWorkspaceProps) {
  const participantCount = participants.participants.length + participants.guests.length;

  // The submit contract is exact: every item fully assigned and the payments
  // summing to the grand total. Letting someone walk to the end and fail at
  // "Criar conta" hides which step was wrong, so each section states its own
  // blocker where it can be fixed.
  const blocked = ((): string | null => {
    if (conflictBlocked) {
      return "Carregue a versão mais recente pra salvar.";
    }
    if (section === "account") {
      if (!details.title.trim()) return "Dê um nome pra conta.";
      if (participantCount < 2) return "Adicione quem divide com você.";
      return null;
    }
    if (section === "items" && store.items.length === 0) {
      return "Adicione pelo menos um item.";
    }
    if (section === "split" && partial) {
      return remainingCents > 0
        ? `Faltam ${formatBRL(remainingCents)} para dividir entre os itens.`
        : "Há itens com divisão incompleta.";
    }
    if (section === "payment") {
      if (payment.included.length === 0) return "Escolha quem pagou.";
      const diff = grandTotal - store.payers.reduce((sum, payer) => sum + payer.amountCents, 0);
      if (diff > 0) return `Faltam ${formatBRL(diff)} para bater com o total.`;
      if (diff < 0) return `Excede ${formatBRL(-diff)} do total.`;
    }
    return null;
  })();
  return (
    <>
      <SectionTabs section={section} onChange={onSectionChange} />
      <SectionContent
        section={section}
        details={{ ...details, participants }}
        payment={payment}
        items={store.items}
        amountTexts={amountInputs}
        invalidAmountIds={invalidAmountIds}
        serviceFeeText={serviceFeeInput}
        serviceFeeCents={serviceFeeCents}
        fixedFees={fixedFees}
        grandTotal={grandTotal}
        participants={store.participants}
        guests={store.guests}
        splits={store.splits}
        expandedId={expandedId}
        onDescriptionChange={(itemId, description) => store.updateItem(itemId, { description })}
        onAmountChange={onAmountChange}
        onServiceFeeChange={onServiceFeeChange}
        onRemoveItem={store.removeItem}
        onAddItem={store.addItem}
        onToggleItem={onToggleItem}
        onSaveDivision={onSaveDivision}
        onCloseDivision={onCloseDivision}
        onAssignSelected={onAssignSelected}
      />
      <SectionFooter
        label={section === "payment" ? (isEditing ? "Salvar" : "Criar conta") : "Continuar"}
        disabled={blocked !== null || submitting}
        reason={blocked}
        onClick={onFooter}
      />
    </>
  );
}
