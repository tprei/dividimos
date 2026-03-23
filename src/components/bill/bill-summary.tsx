"use client";

import { motion } from "framer-motion";
import { Calculator, Percent, Receipt } from "lucide-react";
import { formatBRL } from "@/lib/currency";
import type { Bill, BillItem, ItemSplit, User } from "@/types";

interface BillSummaryProps {
  bill: Bill;
  items: BillItem[];
  splits: ItemSplit[];
  participants: User[];
}

export function BillSummary({ bill, items, splits, participants }: BillSummaryProps) {
  const itemsTotal = items.reduce((sum, i) => sum + i.totalPriceCents, 0);
  const serviceFee = Math.round((itemsTotal * bill.serviceFeePercent) / 100);
  const grandTotal = itemsTotal + serviceFee + bill.fixedFees;

  const perPerson = participants.map((user) => {
    const userSplits = splits.filter((s) => s.userId === user.id);
    const userItemTotal = userSplits.reduce((sum, s) => sum + s.computedAmountCents, 0);

    let userServiceFee = 0;
    if (bill.serviceFeePercent > 0 && itemsTotal > 0) {
      userServiceFee = Math.round(
        (userItemTotal / itemsTotal) * serviceFee,
      );
    }

    const fixedFeeShare =
      participants.length > 0
        ? Math.round(bill.fixedFees / participants.length)
        : 0;

    return {
      user,
      itemTotal: userItemTotal,
      serviceFee: userServiceFee,
      fixedFee: fixedFeeShare,
      total: userItemTotal + userServiceFee + fixedFeeShare,
    };
  });

  const unassigned = itemsTotal - splits.reduce((sum, s) => sum + s.computedAmountCents, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Calculator className="h-4 w-4 text-primary" />
          Resumo
        </div>

        <div className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal dos itens</span>
            <span className="tabular-nums">{formatBRL(itemsTotal)}</span>
          </div>
          {bill.serviceFeePercent > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Servico ({bill.serviceFeePercent}%)
              </span>
              <span className="tabular-nums">{formatBRL(serviceFee)}</span>
            </div>
          )}
          {bill.fixedFees > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Couvert / taxas fixas</span>
              <span className="tabular-nums">{formatBRL(bill.fixedFees)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-2 font-semibold">
            <span>Total</span>
            <span className="tabular-nums text-primary">{formatBRL(grandTotal)}</span>
          </div>
          {unassigned > 0 && (
            <div className="flex justify-between text-warning-foreground">
              <span className="text-xs">Valor nao atribuido</span>
              <span className="text-xs font-medium tabular-nums">
                {formatBRL(unassigned)}
              </span>
            </div>
          )}
        </div>
      </div>

      {perPerson.length > 0 && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Receipt className="h-4 w-4 text-primary" />
            Por pessoa
          </div>

          <div className="mt-3 space-y-3">
            {perPerson.map((entry, idx) => (
              <motion.div
                key={entry.user.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="rounded-xl bg-muted/50 p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                      {entry.user.name.charAt(0)}
                    </span>
                    <span className="font-medium">
                      {entry.user.name.split(" ")[0]}
                    </span>
                  </div>
                  <span className="text-lg font-bold tabular-nums">
                    {formatBRL(entry.total)}
                  </span>
                </div>
                <div className="mt-1.5 flex gap-3 text-[11px] text-muted-foreground">
                  <span>Itens: {formatBRL(entry.itemTotal)}</span>
                  {entry.serviceFee > 0 && (
                    <span>Servico: {formatBRL(entry.serviceFee)}</span>
                  )}
                  {entry.fixedFee > 0 && (
                    <span>Couvert: {formatBRL(entry.fixedFee)}</span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
