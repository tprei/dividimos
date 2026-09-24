"use client";

import { useRef } from "react";
import type { PaymentSectionProps } from "@/components/bill/itemized/payment-section";
import { SectionContent, type SectionContentProps } from "@/components/bill/itemized/section-content";
import type { DetailsStepProps } from "@/components/bill/wizard/details-step";
import type { ParticipantsStepProps } from "@/components/bill/wizard/participants-step";
import { WizardFooter } from "@/components/bill/wizard/wizard-footer";
import { WizardSteps } from "@/components/bill/wizard/wizard-steps";
import type { ItemizedSectionKey } from "@/components/bill/itemized-bill-form";
import { ScrollHint } from "@/components/shared/scroll-hint";
import { formatBRL } from "@/lib/currency";
import type { ExpenseState } from "@/stores/bill-store";

export const ITEMIZED_SECTIONS: readonly ItemizedSectionKey[] = ["account", "items", "split", "payment"];
const STEP_LABELS = ["Participantes", "Itens", "Quem consumiu", "Quem pagou"] as const;

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
  onSubmit: () => void;
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
  onSubmit,
  isEditing,
  submitting,
  conflictBlocked,
}: ItemizedWorkspaceProps) {
  const participantCount = participants.participants.length + participants.guests.length;
  const current = ITEMIZED_SECTIONS.indexOf(section);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const paidDiff = grandTotal - store.payers.reduce((sum, payer) => sum + payer.amountCents, 0);
  const stepBlockers = [
    !details.title.trim()
      ? "Dê um nome pra conta."
      : participantCount < 2
        ? "Adicione quem divide com você."
        : null,
    store.items.length === 0
      ? "Adicione pelo menos um item."
      : invalidAmountIds.length > 0
        ? "Confira o valor dos itens."
        : null,
    partial
      ? remainingCents > 0
        ? `Faltam ${formatBRL(remainingCents)} para dividir entre os itens.`
        : "Há itens com divisão incompleta."
      : null,
    payment.included.length === 0
      ? "Escolha quem pagou."
      : paidDiff > 0
        ? `Faltam ${formatBRL(paidDiff)} para bater com o total.`
        : paidDiff < 0
          ? `Excede ${formatBRL(-paidDiff)} do total.`
          : null,
  ];
  const blocked = conflictBlocked
    ? "Carregue a versão mais recente pra salvar."
    : (stepBlockers.slice(0, current + 1).find((reason) => reason !== null) ?? null);
  const lastStep = current === ITEMIZED_SECTIONS.length - 1;
  return (
    <>
      <WizardSteps steps={STEP_LABELS} current={current} />
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
      <div ref={footerRef} className="mt-auto">
        <WizardFooter
          onBack={current > 0 ? () => onSectionChange(ITEMIZED_SECTIONS[current - 1]) : null}
          onContinue={() => (lastStep ? onSubmit() : onSectionChange(ITEMIZED_SECTIONS[current + 1]))}
          continueLabel={lastStep ? (isEditing ? "Salvar alterações" : "Salvar conta") : "Continuar"}
          disabled={blocked !== null}
          reason={blocked}
          loading={submitting}
        />
      </div>
      <ScrollHint targetRef={footerRef} />
    </>
  );
}
