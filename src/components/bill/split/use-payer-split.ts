"use client";

import { useEffect } from "react";
import { evenSplitBalance } from "@/lib/split-balance";
import type { ExpensePayer } from "@/types";
import { useSplitDraft, type SplitDraftSeed } from "./use-split-draft";

/**
 * Reopens who paid: nobody yet means the viewer paid it all; an even split
 * reopens as "Igual", anything else as amounts.
 */
function payerSeed(payers: readonly ExpensePayer[], fallbackId: string): SplitDraftSeed {
  const paying = payers.filter((payer) => payer.amountCents > 0);
  if (paying.length === 0) return { mode: "equal", included: [fallbackId] };
  const included = paying.map((payer) => payer.userId);
  const total = paying.reduce((sum, payer) => sum + payer.amountCents, 0);
  const even = evenSplitBalance(total, included);
  if (paying.every((payer) => even.shares[payer.userId] === payer.amountCents)) {
    return { mode: "equal", included };
  }
  const centsById: Record<string, number> = {};
  for (const payer of paying) centsById[payer.userId] = payer.amountCents;
  return { mode: "fixed", included, centsById };
}

export interface PayerStoreActions {
  setPayerFull: (userId: string) => unknown;
  splitPaymentEqually: (userIds: string[]) => unknown;
  setPayerAmount: (userId: string, amountCents: number) => unknown;
  removePayerEntry: (userId: string) => void;
}

/**
 * Who paid, edited with the same balancing as the consumption split and
 * written to the bill store as exact centavos on every change. Percentages
 * reach the store through the same basis-point allocation the store uses.
 */
export function usePayerSplit({
  participantIds,
  totalCents,
  initialPayers,
  fallbackId,
  actions,
}: {
  participantIds: readonly string[];
  totalCents: number;
  initialPayers: () => readonly ExpensePayer[];
  fallbackId: string;
  actions: PayerStoreActions;
}) {
  const editor = useSplitDraft({
    peopleIds: participantIds,
    totalCents,
    includeNewcomers: false,
    seed: () => payerSeed(initialPayers(), fallbackId),
  });
  const { draft, centsById } = editor;
  const { setPayerFull, splitPaymentEqually, setPayerAmount, removePayerEntry } = actions;

  useEffect(() => {
    if (totalCents <= 0 || draft.included.length === 0) return;
    if (draft.mode === "equal") {
      if (draft.included.length === 1) setPayerFull(draft.included[0]);
      else splitPaymentEqually([...draft.included]);
      return;
    }
    for (const id of participantIds) {
      const cents = centsById[id] ?? 0;
      if (cents > 0) setPayerAmount(id, cents);
      else removePayerEntry(id);
    }
  }, [centsById, draft, participantIds, removePayerEntry, setPayerAmount, setPayerFull, splitPaymentEqually, totalCents]);

  return editor;
}
