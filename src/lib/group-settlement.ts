import type { DebtEdge } from "./simplify";
import type { LedgerEntry, User } from "@/types";

/**
 * Convert ledger entries to raw DebtEdge[] — consolidating same-direction
 * edges but preserving reverse pairs for step-by-step simplification.
 */
export function ledgerToRawEdges(ledgerEntries: LedgerEntry[]): DebtEdge[] {
  const map = new Map<string, number>();
  for (const entry of ledgerEntries) {
    if (entry.status === "settled") continue;
    const remaining = entry.amountCents - (entry.paidAmountCents ?? 0);
    if (remaining <= 0) continue;
    const key = `${entry.fromUserId}->${entry.toUserId}`;
    map.set(key, (map.get(key) || 0) + remaining);
  }
  return Array.from(map.entries())
    .filter(([, amount]) => amount > 0)
    .map(([key, amountCents]) => {
      const [fromUserId, toUserId] = key.split("->");
      return { fromUserId, toUserId, amountCents };
    });
}

export function computeGroupNetEdges(
  ledgerEntries: LedgerEntry[],
  participants: User[],
): DebtEdge[] {
  const balances = new Map<string, number>();
  for (const p of participants) {
    balances.set(p.id, 0);
  }

  for (const entry of ledgerEntries) {
    if (entry.status === "settled") continue;
    balances.set(entry.fromUserId, (balances.get(entry.fromUserId) ?? 0) - entry.amountCents);
    balances.set(entry.toUserId, (balances.get(entry.toUserId) ?? 0) + entry.amountCents);
  }

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
