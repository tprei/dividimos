"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Calculator, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { DebtGraph } from "@/components/settlement/debt-graph";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatBRL } from "@/lib/currency";
import type { DebtEdge, ExpenseWithDetails, UserProfile } from "@/types";

export function ExpenseChargeExplanation({
  expense,
  allParticipants,
  debts,
  currentUserId,
}: {
  expense: ExpenseWithDetails;
  allParticipants: UserProfile[];
  debts: DebtEdge[];
  currentUserId?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
      >
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">De onde veio esse valor</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="border-t px-4 pb-4 pt-3 space-y-5">
              {debts.length > 0 && allParticipants.length >= 2 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Quem paga quem
                  </p>
                  <DebtGraph participants={allParticipants} edges={debts} />
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Quanto cada um consumiu
                </p>
                <div className="space-y-1.5">
                  {expense.shares.map((share) => {
                    const payer = expense.payers.find((p) => p.userId === share.userId);
                    const isMe = share.userId === currentUserId;
                    return (
                      <div
                        key={share.userId}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                          isMe ? "bg-primary/5" : "bg-muted/30"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <UserAvatar name={share.user.name} avatarUrl={share.user.avatarUrl} size="xs" />
                          <span className={isMe ? "font-medium" : ""}>
                            {share.user.name.split(" ")[0]}
                            {isMe && " (você)"}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="tabular-nums font-medium">
                            {formatBRL(share.shareAmountCents)}
                          </span>
                          {payer && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              pagou {formatBRL(payer.amountCents)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Saldo líquido
                </p>
                <div className="space-y-1">
                  {expense.shares.map((share) => {
                    const payer = expense.payers.find((p) => p.userId === share.userId);
                    const net = (payer?.amountCents ?? 0) - share.shareAmountCents;
                    if (Math.abs(net) < 2) return null;
                    return (
                      <div
                        key={share.userId}
                        className="flex items-center justify-between text-sm px-3 py-1"
                      >
                        <span className="text-muted-foreground">
                          {share.user.name.split(" ")[0]}
                        </span>
                        <span
                          className={`font-medium tabular-nums ${
                            net > 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {net > 0 ? "+" : ""}
                          {formatBRL(Math.abs(net))}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            {net > 0 ? "a receber" : "a pagar"}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg bg-muted/30 p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total da conta</span>
                  <span className="font-bold tabular-nums">{formatBRL(expense.totalAmount)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Quem pagou</span>
                  <span>
                    {expense.payers.map((py) => {
                      const name = py.user.name.split(" ")[0];
                      return `${name} (${formatBRL(py.amountCents)})`;
                    }).join(", ")}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
