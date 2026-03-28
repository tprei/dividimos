import type { DebtEdge } from "./simplify";
import type { ExpenseShare, User } from "@/types";

/**
 * Compute net settlement edges from ExpenseShare[] for a group.
 *
 * In the Splitwise model, each expense_share has a net_cents:
 *   positive = creditor (owed money), negative = debtor (owes money)
 *
 * We aggregate net_cents per user across all shares, then use greedy
 * matching to produce DebtEdge[].
 */
export function computeGroupNetEdges(
  shares: ExpenseShare[],
  participants: User[],
): DebtEdge[] {
  const balances = new Map<string, number>();
  for (const p of participants) {
    balances.set(p.id, 0);
  }

  for (const share of shares) {
    balances.set(share.userId, (balances.get(share.userId) ?? 0) + share.netCents);
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
