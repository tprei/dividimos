import { useBillStore } from "@/stores/bill-store";
import type { ScanDraftCandidate } from "./scan-replacement";

/**
 * Commits a scanned receipt draft replacement in exactly ONE store transition.
 *
 * Persist partialize (bill-store.ts:1283-1295) observes a single snapshot,
 * guaranteeing a single atomic localStorage write with no intermediate states.
 *
 * SWAP POINT:
 * This UI-side setState is a substitute for the frozen store action
 * `replaceFromReceiptScan`. When the freeze on bill-store.ts lifts,
 * swap this implementation to delegate directly to `useBillStore.getState().replaceFromReceiptScan(candidate)`.
 */
export function commitScanReplacement(candidate: ScanDraftCandidate): void {
  useBillStore.setState({
    expense: candidate.expense,
    totalAmountInput: 0,
    participants: candidate.participants,
    guests: candidate.guests,
    items: candidate.items,
    payers: [],
    splits: [],
    billSplits: [],
    occurredOn: candidate.occurredOn,
    draftKey: crypto.randomUUID(),
    receiptAccessKey: null,
  });
}
