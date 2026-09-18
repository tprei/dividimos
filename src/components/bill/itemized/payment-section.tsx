"use client";

import { PayerStep } from "@/components/bill/payer-step";
import type { ExpensePayer, User } from "@/types";

export interface PaymentSectionProps {
  participants: User[];
  payers: ExpensePayer[];
  grandTotal: number;
  onSetPayerFull: (userId: string) => void;
  onSplitPaymentEqually: (userIds: string[]) => void;
  onSetPayerAmount: (userId: string, amountCents: number) => void;
  onRemovePayerEntry: (userId: string) => void;
  hasGuests?: boolean;
}

export function PaymentSection({
  participants,
  payers,
  grandTotal,
  onSetPayerFull,
  onSplitPaymentEqually,
  onSetPayerAmount,
  onRemovePayerEntry,
  hasGuests,
}: PaymentSectionProps) {
  return (
    <div className="px-4 py-3">
      <PayerStep
        participants={participants}
        payers={payers}
        grandTotal={grandTotal}
        onSetPayerFull={onSetPayerFull}
        onSplitPaymentEqually={onSplitPaymentEqually}
        onSetPayerAmount={onSetPayerAmount}
        onRemovePayerEntry={onRemovePayerEntry}
        hasGuests={hasGuests}
      />
    </div>
  );
}
