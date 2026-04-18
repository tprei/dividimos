"use client";

import { motion } from "framer-motion";
import { Receipt } from "lucide-react";
import { PayerSummaryCard } from "@/components/bill/payer-summary-card";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatBRL } from "@/lib/currency";
import type { ExpenseWithDetails, UserProfile } from "@/types";

export function ExpenseSharesSummary({
  expense,
  allParticipants,
}: {
  expense: ExpenseWithDetails;
  allParticipants: UserProfile[];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Receipt className="h-4 w-4 text-primary" />
          Por pessoa
        </div>
        <div className="mt-3 space-y-3">
          {expense.shares.map((share, idx) => {
            const payer = expense.payers.find((p) => p.userId === share.userId);
            const net = (payer?.amountCents ?? 0) - share.shareAmountCents;

            return (
              <motion.div
                key={share.userId}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="rounded-xl bg-muted/50 p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UserAvatar name={share.user.name} avatarUrl={share.user.avatarUrl} size="xs" />
                    <span className="font-medium text-sm">
                      {share.user.name.split(" ")[0]}
                    </span>
                  </div>
                  <span className="text-lg font-bold tabular-nums">
                    {formatBRL(share.shareAmountCents)}
                  </span>
                </div>
                <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
                  <span>Consumo: {formatBRL(share.shareAmountCents)}</span>
                  {payer && (
                    <span>Pagou: {formatBRL(payer.amountCents)}</span>
                  )}
                  {Math.abs(net) > 1 && (
                    <span className={net > 0 ? "text-success" : "text-destructive"}>
                      {net > 0 ? "+" : ""}{formatBRL(Math.abs(net))} {net > 0 ? "a receber" : "a pagar"}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {expense.payers.length > 0 && (
        <PayerSummaryCard
          payers={expense.payers.map((p) => ({ userId: p.userId, amountCents: p.amountCents }))}
          participants={allParticipants}
        />
      )}
    </div>
  );
}
