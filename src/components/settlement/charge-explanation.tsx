"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Calculator, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { DebtGraph } from "./debt-graph";
import { formatBRL, distributeProportionally, distributeEvenly } from "@/lib/currency";
import type { DebtEdge, SimplificationResult } from "@/lib/simplify";
import type { Bill, BillItem, BillSplit, ItemSplit, User } from "@/types";

interface ChargeExplanationProps {
  bill: Bill;
  participants: User[];
  items: BillItem[];
  splits: ItemSplit[];
  billSplits: BillSplit[];
  ledger: { fromUserId: string; toUserId: string; amountCents: number; paidAmountCents: number }[];
  simplificationResult: SimplificationResult | null;
  currentUserId?: string;
}

export function ChargeExplanation({
  bill,
  participants,
  items,
  splits,
  billSplits,
  ledger,
  simplificationResult,
  currentUserId,
}: ChargeExplanationProps) {
  const [expanded, setExpanded] = useState(false);

  const isSingleAmount = bill.billType === "single_amount";
  const itemsTotal = items.reduce((sum, i) => sum + i.totalPriceCents, 0);
  const serviceFee = Math.round((itemsTotal * bill.serviceFeePercent) / 100);
  const grandTotal = isSingleAmount
    ? bill.totalAmountInput
    : itemsTotal + serviceFee + bill.fixedFees;

  const consumption = new Map<string, number>();
  for (const p of participants) consumption.set(p.id, 0);
  if (isSingleAmount) {
    for (const bs of billSplits) {
      consumption.set(bs.userId, (consumption.get(bs.userId) || 0) + bs.computedAmountCents);
    }
  } else {
    for (const s of splits) {
      consumption.set(s.userId, (consumption.get(s.userId) || 0) + s.computedAmountCents);
    }
    if (bill.serviceFeePercent > 0 && itemsTotal > 0) {
      const weights = participants.map((p) => consumption.get(p.id) || 0);
      const fees = distributeProportionally(serviceFee, weights);
      participants.forEach((p, i) => {
        consumption.set(p.id, (consumption.get(p.id) || 0) + fees[i]);
      });
    }
    if (bill.fixedFees > 0) {
      const fees = distributeEvenly(bill.fixedFees, participants.length);
      participants.forEach((p, i) => {
        consumption.set(p.id, (consumption.get(p.id) || 0) + fees[i]);
      });
    }
  }

  const payers = bill.payers.length > 0
    ? bill.payers
    : [{ userId: bill.creatorId, amountCents: grandTotal }];

  const payment = new Map<string, number>();
  for (const p of participants) payment.set(p.id, 0);
  for (const payer of payers) {
    payment.set(payer.userId, (payment.get(payer.userId) || 0) + payer.amountCents);
  }

  const finalEdges: DebtEdge[] = simplificationResult
    ? simplificationResult.simplifiedEdges
    : ledger
        .map((e) => ({
          fromUserId: e.fromUserId,
          toUserId: e.toUserId,
          amountCents: e.amountCents - e.paidAmountCents,
        }))
        .filter((e) => e.amountCents > 0);

  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
      >
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Como chegamos nesse valor</span>
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
              {finalEdges.length > 0 && participants.length >= 2 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Fluxo de pagamentos
                  </p>
                  <DebtGraph participants={participants} edges={finalEdges} />
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Consumo por pessoa
                </p>
                <div className="space-y-1.5">
                  {participants.map((p) => {
                    const consumed = consumption.get(p.id) || 0;
                    const paid = payment.get(p.id) || 0;
                    const isMe = p.id === currentUserId;
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                          isMe ? "bg-primary/5" : "bg-muted/30"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                            {p.name.charAt(0)}
                          </span>
                          <span className={isMe ? "font-medium" : ""}>
                            {p.name.split(" ")[0]}
                            {isMe && " (voce)"}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="tabular-nums font-medium">
                            {formatBRL(consumed)}
                          </span>
                          {paid > 0 && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              pagou {formatBRL(paid)}
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
                  Saldo liquido
                </p>
                <div className="space-y-1">
                  {participants.map((p) => {
                    const consumed = consumption.get(p.id) || 0;
                    const paid = payment.get(p.id) || 0;
                    const net = paid - consumed;
                    if (Math.abs(net) < 2) return null;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-sm px-3 py-1"
                      >
                        <span className="text-muted-foreground">
                          {p.name.split(" ")[0]}
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

              {simplificationResult && simplificationResult.steps.length > 2 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Simplificacao
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {simplificationResult.originalCount} cobranca{simplificationResult.originalCount !== 1 ? "s" : ""}{" "}
                    reduzida{simplificationResult.originalCount !== 1 ? "s" : ""} para{" "}
                    {simplificationResult.simplifiedCount}
                  </p>
                </div>
              )}

              <div className="rounded-lg bg-muted/30 p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total da conta</span>
                  <span className="font-bold tabular-nums">{formatBRL(grandTotal)}</span>
                </div>
                {!isSingleAmount && bill.serviceFeePercent > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Inclui {bill.serviceFeePercent}% servico</span>
                    <span className="tabular-nums">{formatBRL(serviceFee)}</span>
                  </div>
                )}
                {!isSingleAmount && bill.fixedFees > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Couvert</span>
                    <span className="tabular-nums">{formatBRL(bill.fixedFees)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Pagadores</span>
                  <span>
                    {payers.map((py) => {
                      const name = participants.find((p) => p.id === py.userId)?.name.split(" ")[0] ?? "?";
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
