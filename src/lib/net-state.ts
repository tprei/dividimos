import type { DebtEdge } from "./simplify";
import type { DebtStatus, LedgerEntry, User } from "@/types";

/**
 * A directed edge representing money owed, with payment/settlement status.
 */
export interface NetEdge extends DebtEdge {
  paidAmountCents: number;
  status: DebtStatus;
}

/**
 * Per-bill view of debts derived from ledger entries.
 */
export interface BillDebtEntry {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  paidAmountCents: number;
  status: DebtStatus;
  ledgerEntryId: string;
}

// --- internal helpers ---

function pairKey(from: string, to: string): string {
  return `${from}:${to}`;
}

function deriveStatus(amountCents: number, paidAmountCents: number, confirmedAt: string | undefined): DebtStatus {
  if (confirmedAt && paidAmountCents >= amountCents) return "settled";
  if (paidAmountCents >= amountCents) return "paid_unconfirmed";
  if (paidAmountCents > 0) return "partially_paid";
  return "pending";
}

// --- public API ---

/**
 * Compute the net state of a group from its ledger entries.
 *
 * Processes both debt and payment entries to produce simplified edges
 * representing who currently owes whom. This is the core "event sourcing"
 * function: events (debts + payments) in, derived state out.
 *
 * The algorithm:
 * 1. For each (from, to) pair, accumulate total debt and total payments.
 * 2. Remaining = debt - payments for each directed pair.
 * 3. Net opposing pairs (A→B vs B→A).
 * 4. Greedy-match debtors to creditors to minimize edges.
 */
export function computeGroupNetState(
  entries: LedgerEntry[],
  participants: User[],
): DebtEdge[] {
  // Accumulate net balance per participant.
  // Positive = net creditor, negative = net debtor.
  const balances = new Map<string, number>();
  for (const p of participants) {
    balances.set(p.id, 0);
  }

  for (const entry of entries) {
    if (entry.entryType === "debt") {
      // fromUser owes toUser
      const remaining = entry.amountCents - entry.paidAmountCents;
      if (entry.status === "settled" || remaining <= 0) continue;
      balances.set(entry.fromUserId, (balances.get(entry.fromUserId) ?? 0) - remaining);
      balances.set(entry.toUserId, (balances.get(entry.toUserId) ?? 0) + remaining);
    }
    // Payment entries are already reflected in paidAmountCents of their
    // corresponding debt entries (via DB trigger), so we don't double-count.
  }

  return greedyMatch(balances);
}

/**
 * Compute the net state of a group purely from entry amounts,
 * without relying on the mutable paidAmountCents/status fields.
 *
 * This is useful when you want a fully event-sourced derivation:
 * debt entries add to balances, payment entries subtract.
 */
export function computeGroupNetStateFromEvents(
  entries: LedgerEntry[],
  participants: User[],
): DebtEdge[] {
  const balances = new Map<string, number>();
  for (const p of participants) {
    balances.set(p.id, 0);
  }

  for (const entry of entries) {
    if (entry.entryType === "debt") {
      balances.set(entry.fromUserId, (balances.get(entry.fromUserId) ?? 0) - entry.amountCents);
      balances.set(entry.toUserId, (balances.get(entry.toUserId) ?? 0) + entry.amountCents);
    } else {
      // payment: fromUser paid toUser, reducing the debt
      balances.set(entry.fromUserId, (balances.get(entry.fromUserId) ?? 0) + entry.amountCents);
      balances.set(entry.toUserId, (balances.get(entry.toUserId) ?? 0) - entry.amountCents);
    }
  }

  return greedyMatch(balances);
}

/**
 * Compute per-debt settlement status for a specific bill.
 *
 * Returns one BillDebtEntry per debt ledger row for the given bill,
 * with status derived from the entry's payment progress.
 */
export function computeBillDebtView(
  entries: LedgerEntry[],
  billId: string,
): BillDebtEntry[] {
  return entries
    .filter((e) => e.entryType === "debt" && e.billId === billId)
    .map((e) => ({
      fromUserId: e.fromUserId,
      toUserId: e.toUserId,
      amountCents: e.amountCents,
      paidAmountCents: e.paidAmountCents,
      status: deriveStatus(e.amountCents, e.paidAmountCents, e.confirmedAt),
      ledgerEntryId: e.id,
    }));
}

/**
 * Compute detailed net edges between participants, preserving
 * payment progress per directed pair.
 *
 * Unlike computeGroupNetState (which returns minimal DebtEdges),
 * this returns NetEdges with paidAmountCents and status — useful
 * for rendering the settlement view with payment progress bars.
 */
export function computeGroupNetEdgesDetailed(
  entries: LedgerEntry[],
  participants: User[],
): NetEdge[] {
  // Accumulate total debt and total paid per directed pair
  const debtByPair = new Map<string, number>();
  const paidByPair = new Map<string, number>();

  for (const entry of entries) {
    if (entry.entryType === "debt") {
      const key = pairKey(entry.fromUserId, entry.toUserId);
      debtByPair.set(key, (debtByPair.get(key) ?? 0) + entry.amountCents);
      paidByPair.set(key, (paidByPair.get(key) ?? 0) + entry.paidAmountCents);
    }
  }

  // Net opposing pairs: if A owes B $100 and B owes A $30,
  // the result is A owes B $70
  const processed = new Set<string>();
  const edges: NetEdge[] = [];

  const participantIds = new Set(participants.map((p) => p.id));

  for (const [key, totalDebt] of debtByPair) {
    if (processed.has(key)) continue;
    const [from, to] = key.split(":");
    if (!participantIds.has(from) || !participantIds.has(to)) continue;

    const reverseKey = pairKey(to, from);
    processed.add(key);
    processed.add(reverseKey);

    const totalPaid = paidByPair.get(key) ?? 0;
    const reverseDebt = debtByPair.get(reverseKey) ?? 0;
    const reversePaid = paidByPair.get(reverseKey) ?? 0;

    const netForward = (totalDebt - totalPaid) - (reverseDebt - reversePaid);

    if (netForward > 1) {
      edges.push({
        fromUserId: from,
        toUserId: to,
        amountCents: netForward,
        paidAmountCents: 0,
        status: "pending",
      });
    } else if (netForward < -1) {
      edges.push({
        fromUserId: to,
        toUserId: from,
        amountCents: Math.abs(netForward),
        paidAmountCents: 0,
        status: "pending",
      });
    }
    // |netForward| <= 1 means the pair is settled (rounding tolerance)
  }

  return edges;
}

// --- internal ---

function greedyMatch(balances: Map<string, number>): DebtEdge[] {
  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];

  for (const [id, balance] of balances) {
    if (balance < -1) debtors.push({ id, amount: Math.abs(balance) });
    if (balance > 1) creditors.push({ id, amount: balance });
  }

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const edges: DebtEdge[] = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
    if (transfer <= 0) break;
    edges.push({
      fromUserId: debtors[di].id,
      toUserId: creditors[ci].id,
      amountCents: transfer,
    });
    debtors[di].amount -= transfer;
    creditors[ci].amount -= transfer;
    if (debtors[di].amount <= 1) di++;
    if (creditors[ci].amount <= 1) ci++;
  }

  return edges;
}
