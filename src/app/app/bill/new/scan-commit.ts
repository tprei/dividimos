import { useBillStore } from "@/stores/bill-store";
import type { ScanDraftCandidate } from "./scan-replacement";

/**
 * Commits a scanned receipt draft replacement in exactly ONE store transition.
 *
 * Persist partialize (bill-store.ts:1283-1295) observes a single snapshot,
 * guaranteeing a single atomic localStorage write with no intermediate states.
 * Note: frozen store; setState is the deliberate seam for atomic draft replacement.
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
