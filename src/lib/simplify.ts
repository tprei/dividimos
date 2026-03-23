import { formatBRL } from "./currency";
import type { User } from "@/types";

export interface DebtEdge {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

export interface SimplificationStep {
  balances: Map<string, number>;
  edges: DebtEdge[];
  description: string;
}

export interface SimplificationResult {
  originalEdges: DebtEdge[];
  steps: SimplificationStep[];
  simplifiedEdges: DebtEdge[];
  originalCount: number;
  simplifiedCount: number;
}

function cloneBalances(m: Map<string, number>): Map<string, number> {
  return new Map(m);
}

function getUserName(userId: string, participants: User[]): string {
  const user = participants.find((p) => p.id === userId);
  return user?.name.split(" ")[0] || "?";
}

export function simplifyDebts(
  edges: DebtEdge[],
  participants: User[],
): SimplificationResult {
  const balances = new Map<string, number>();

  for (const p of participants) {
    balances.set(p.id, 0);
  }

  for (const edge of edges) {
    balances.set(edge.fromUserId, (balances.get(edge.fromUserId) || 0) - edge.amountCents);
    balances.set(edge.toUserId, (balances.get(edge.toUserId) || 0) + edge.amountCents);
  }

  const steps: SimplificationStep[] = [
    {
      balances: cloneBalances(balances),
      edges: [...edges],
      description: "Dividas originais",
    },
  ];

  const simplifiedEdges: DebtEdge[] = [];
  const workBalances = cloneBalances(balances);

  while (true) {
    const debtors: { id: string; amount: number }[] = [];
    const creditors: { id: string; amount: number }[] = [];

    for (const [id, balance] of workBalances) {
      if (balance < -1) debtors.push({ id, amount: balance });
      if (balance > 1) creditors.push({ id, amount: balance });
    }

    if (debtors.length === 0 || creditors.length === 0) break;

    debtors.sort((a, b) => a.amount - b.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const debtor = debtors[0];
    const creditor = creditors[0];
    const transfer = Math.min(Math.abs(debtor.amount), creditor.amount);

    simplifiedEdges.push({
      fromUserId: debtor.id,
      toUserId: creditor.id,
      amountCents: transfer,
    });

    workBalances.set(debtor.id, (workBalances.get(debtor.id) || 0) + transfer);
    workBalances.set(creditor.id, (workBalances.get(creditor.id) || 0) - transfer);

    const debtorName = getUserName(debtor.id, participants);
    const creditorName = getUserName(creditor.id, participants);

    steps.push({
      balances: cloneBalances(workBalances),
      edges: [...simplifiedEdges],
      description: `${debtorName} paga ${formatBRL(transfer)} para ${creditorName}`,
    });
  }

  return {
    originalEdges: edges,
    steps,
    simplifiedEdges,
    originalCount: edges.length,
    simplifiedCount: simplifiedEdges.length,
  };
}
