"use client";

import { motion } from "framer-motion";
import { BillSummary } from "@/components/bill/bill-summary";
import { PayerSummaryCard } from "@/components/bill/payer-summary-card";
import type { Expense, ExpenseItem, ExpensePayer, User } from "@/types";
import type { AmountSplit, ExpenseSplit, Guest } from "@/stores/bill-store";

export interface SummaryStepProps {
  expense: Expense | null;
  items: ExpenseItem[];
  splits: ExpenseSplit[];
  billSplits: AmountSplit[];
  participants: User[];
  guests: Guest[];
  payers: ExpensePayer[];
  grandTotal: number;
  pendingInviteNames: string[];
  wouldProduceNoEdges: boolean;
}

export function SummaryStep({
  expense,
  items,
  splits,
  billSplits,
  participants,
  guests,
  payers,
  grandTotal,
  pendingInviteNames,
  wouldProduceNoEdges,
}: SummaryStepProps) {
  if (!expense) return null;

  return (
    <motion.div
      key="summary"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      <BillSummary
        expense={{
          expenseType: expense.expenseType,
          totalAmount: grandTotal,
          serviceFeePercent: expense.serviceFeePercent,
          fixedFees: expense.fixedFees,
        }}
        items={items}
        itemSplits={splits}
        shares={billSplits.map((bs) => ({
          userId: bs.userId,
          shareAmountCents: bs.computedAmountCents,
          splitLabel:
            bs.splitType === "percentage"
              ? `${bs.value.toFixed(1)}%`
              : bs.splitType === "equal"
                ? "igual"
                : undefined,
        }))}
        participants={participants}
        guests={guests}
      />
      {payers.length > 0 && (
        <PayerSummaryCard
          payers={payers.flatMap((payer) => {
            const user = participants.find((p) => p.id === payer.userId);
            return user ? [{ user, amountCents: payer.amountCents }] : [];
          })}
        />
      )}
      {pendingInviteNames.length > 0 && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-700 dark:bg-yellow-950">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            Aguardando {pendingInviteNames.join(", ")} aceitar o convite
          </p>
          <p className="mt-1 text-xs text-yellow-700 dark:text-yellow-300">
            A conta só pode ser concluída quando todos os participantes aceitarem o convite do grupo.
          </p>
        </div>
      )}
      {wouldProduceNoEdges && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-700 dark:bg-yellow-950"
        >
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            Essa conta não gera nenhuma cobrança
          </p>
          <p className="mt-1 text-xs text-yellow-700 dark:text-yellow-300">
            Cada pessoa já pagou exatamente o que consumiu. Volte e ajuste a divisão ou os pagadores para que alguém fique devendo.
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
