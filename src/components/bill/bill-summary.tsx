"use client";

import { motion } from "framer-motion";
import { Calculator, Receipt } from "lucide-react";
import { formatBRL } from "@/lib/currency";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { UserAvatar } from "@/components/shared/user-avatar";
import { PersonLabel } from "@/components/shared/person-label";
import { Chip } from "@/components/ui/chip";
import { displayNames } from "@/lib/people";
import {
  allocateByWeights,
  allocateEvenly,
  computeServiceFeeCents,
  formatServiceFeeBasisPoints,
} from "@/lib/expense-money";
import type { ExpenseType, UserProfile } from "@/types";

/** Fields the summary reads from the expense config. */
interface ExpenseConfig {
  expenseType: ExpenseType;
  totalAmount: number;
  serviceFeeBasisPoints: number;
  fixedFees: number;
}

/** Per-user share with optional label (for display of split method). */
interface ShareEntry {
  userId: string;
  shareAmountCents: number;
  splitLabel?: string;
}

/** Item with price (for itemized breakdown). */
interface SummaryItem {
  totalPriceCents: number;
}

/** Per-item assignment (for computing itemized per-person fees). */
interface SummaryItemSplit {
  userId: string;
  computedAmountCents: number;
}

interface GuestEntry {
  id: string;
  name: string;
}

interface BillSummaryProps {
  expense: ExpenseConfig;
  items: SummaryItem[];
  /** Per-item splits (only used for itemized expenses). */
  itemSplits?: SummaryItemSplit[];
  /** Pre-computed shares per user (used for single_amount expenses). */
  shares?: ShareEntry[];
  participants: UserProfile[];
  guests?: GuestEntry[];
  viewerId?: string;
}

export function BillSummary({ expense, items, itemSplits = [], shares = [], participants, guests = [], viewerId }: BillSummaryProps) {
  const isSingleAmount = expense.expenseType === "single_amount";

  const itemsTotal = items.reduce((sum, i) => sum + i.totalPriceCents, 0);
  const serviceFeeRes = computeServiceFeeCents(itemsTotal, expense.serviceFeeBasisPoints);
  const serviceFee = serviceFeeRes.ok ? serviceFeeRes.value : 0;
  const grandTotal = isSingleAmount
    ? expense.totalAmount
    : itemsTotal + serviceFee + expense.fixedFees;

  const allPersons = [
    ...participants.map((p) => ({ ...p, isGuest: false })),
    ...guests.map((g) => ({ id: g.id, name: g.name, avatarUrl: null, isGuest: true })),
  ];
  const labels = displayNames(allPersons, { style: "full", viewerId });

  const perPerson = (() => {
    if (isSingleAmount) {
      return allPersons.map((person) => {
        const share = shares.find((s) => s.userId === person.id);
        return {
          person,
          itemTotal: share?.shareAmountCents || 0,
          serviceFee: 0,
          fixedFee: 0,
          total: share?.shareAmountCents || 0,
          splitLabel: share?.splitLabel,
        };
      });
    }

    const itemTotals = allPersons.map((person) => {
      const userSplits = itemSplits.filter((s) => s.userId === person.id);
      return userSplits.reduce((sum, s) => sum + s.computedAmountCents, 0);
    });
    const serviceFeesRes = allocateByWeights(serviceFee, itemTotals);
    const fixedFeesRes = allocateEvenly(expense.fixedFees, allPersons.length);
    const serviceFees = serviceFeesRes.ok ? serviceFeesRes.value : itemTotals.map(() => 0);
    const fixedFees = fixedFeesRes.ok ? fixedFeesRes.value : allPersons.map(() => 0);

    return allPersons.map((person, i) => ({
      person,
      itemTotal: itemTotals[i],
      serviceFee: serviceFees[i],
      fixedFee: fixedFees[i],
      total: itemTotals[i] + serviceFees[i] + fixedFees[i],
      splitLabel: undefined as string | undefined,
    }));
  })();

  const unassigned = isSingleAmount
    ? grandTotal - shares.reduce((sum, s) => sum + s.shareAmountCents, 0)
    : itemsTotal - itemSplits.reduce((sum, s) => sum + s.computedAmountCents, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Calculator className="h-4 w-4 text-primary" />
          Resumo
        </div>

        <div className="mt-3 space-y-2 text-sm">
          {isSingleAmount ? (
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums text-primary-text">{formatBRL(grandTotal)}</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal dos itens</span>
                <span className="tabular-nums">{formatBRL(itemsTotal)}</span>
              </div>
              {expense.serviceFeeBasisPoints > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Garçom ({formatServiceFeeBasisPoints(expense.serviceFeeBasisPoints)})
                  </span>
                  <span className="tabular-nums">{formatBRL(serviceFee)}</span>
                </div>
              )}
              {expense.fixedFees > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Couvert / taxas fixas</span>
                  <span className="tabular-nums">{formatBRL(expense.fixedFees)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <span>Total</span>
                <span className="tabular-nums text-primary-text">{formatBRL(grandTotal)}</span>
              </div>
            </>
          )}
          {unassigned > 0 && (
            <div className="flex justify-between text-warning-text">
              <span className="text-xs">Valor não atribuído</span>
              <span className="text-xs font-medium tabular-nums">
                {formatBRL(unassigned)}
              </span>
            </div>
          )}
        </div>
      </div>

      {perPerson.length > 0 && perPerson.some((p) => p.total > 0) && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Receipt className="h-4 w-4 text-primary" />
            Por pessoa
          </div>

          <div className="mt-3 space-y-3">
            {perPerson.map((entry, idx) => (
              <motion.div
                key={entry.person.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="rounded-xl bg-muted/50 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {entry.person.isGuest
                      ? <GuestAvatar id={entry.person.id} name={entry.person.name} size="sm" />
                      : <UserAvatar id={entry.person.id} name={entry.person.name} avatarUrl={entry.person.avatarUrl} size="sm" />}
                    <PersonLabel name={entry.person.name} overrideName={labels.get(entry.person.id)} />
                    {entry.person.isGuest && <Chip tone="guest">Convidado</Chip>}
                    {entry.splitLabel && (
                      <span className="text-xs text-muted-foreground">
                        ({entry.splitLabel})
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-lg font-bold tabular-nums">
                    {formatBRL(entry.total)}
                  </span>
                </div>
                {!isSingleAmount && (
                  <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>Itens: {formatBRL(entry.itemTotal)}</span>
                    {entry.serviceFee > 0 && (
                      <span>Garçom: {formatBRL(entry.serviceFee)}</span>
                    )}
                    {entry.fixedFee > 0 && (
                      <span>Couvert: {formatBRL(entry.fixedFee)}</span>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
