import { formatBRL, distributeProportionally, distributeEvenly } from "./currency";
import type { Bill, BillSplit, ItemSplit, User } from "@/types";

export interface DebtEdge {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

export interface SimplificationStep {
  edges: DebtEdge[];
  description: string;
  removedEdges?: DebtEdge[];
  addedEdge?: DebtEdge;
}

export interface SimplificationResult {
  originalEdges: DebtEdge[];
  steps: SimplificationStep[];
  simplifiedEdges: DebtEdge[];
  originalCount: number;
  simplifiedCount: number;
}

function getUserName(userId: string, participants: User[]): string {
  const user = participants.find((p) => p.id === userId);
  return user?.name.split(" ")[0] || "?";
}

function edgeKey(e: DebtEdge): string {
  return `${e.fromUserId}->${e.toUserId}`;
}

export function consolidateEdges(edges: DebtEdge[]): DebtEdge[] {
  const map = new Map<string, DebtEdge>();
  for (const e of edges) {
    const key = edgeKey(e);
    const existing = map.get(key);
    if (existing) {
      existing.amountCents += e.amountCents;
    } else {
      map.set(key, { ...e });
    }
  }
  return Array.from(map.values()).filter((e) => e.amountCents > 0);
}

function netAndMinimize(edges: DebtEdge[]): DebtEdge[] {
  const balances = new Map<string, number>();
  for (const e of edges) {
    balances.set(e.fromUserId, (balances.get(e.fromUserId) || 0) - e.amountCents);
    balances.set(e.toUserId, (balances.get(e.toUserId) || 0) + e.amountCents);
  }

  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];
  for (const [id, balance] of balances) {
    if (balance < 0) debtors.push({ id, amount: Math.abs(balance) });
    if (balance > 0) creditors.push({ id, amount: balance });
  }
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const result: DebtEdge[] = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
    if (transfer <= 0) break;
    result.push({ fromUserId: debtors[di].id, toUserId: creditors[ci].id, amountCents: transfer });
    debtors[di].amount -= transfer;
    creditors[ci].amount -= transfer;
    if (debtors[di].amount <= 0) di++;
    if (creditors[ci].amount <= 0) ci++;
  }
  return result;
}

export function computeRawEdges(
  bill: Bill,
  participants: User[],
  itemSplits: ItemSplit[],
  billSplits: BillSplit[],
  items: { totalPriceCents: number }[],
): DebtEdge[] {
  const consumption = new Map<string, number>();
  for (const p of participants) {
    consumption.set(p.id, 0);
  }

  if (bill.billType === "single_amount") {
    for (const bs of billSplits) {
      consumption.set(bs.userId, (consumption.get(bs.userId) || 0) + bs.computedAmountCents);
    }
  } else {
    const itemsTotal = items.reduce((sum, i) => sum + i.totalPriceCents, 0);
    for (const split of itemSplits) {
      consumption.set(split.userId, (consumption.get(split.userId) || 0) + split.computedAmountCents);
    }
    if (bill.serviceFeePercent > 0 && itemsTotal > 0) {
      const totalFee = Math.round((itemsTotal * bill.serviceFeePercent) / 100);
      const weights = participants.map((p) => consumption.get(p.id) || 0);
      const fees = distributeProportionally(totalFee, weights);
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
    : [{ userId: bill.creatorId, amountCents: participants.reduce((s, p) => s + (consumption.get(p.id) || 0), 0) }];

  const totalPaid = payers.reduce((s, p) => s + p.amountCents, 0);
  if (totalPaid <= 0) return [];

  const edges: DebtEdge[] = [];
  for (const p of participants) {
    const consumed = consumption.get(p.id) || 0;
    if (consumed <= 0) continue;

    for (const payer of payers) {
      if (payer.userId === p.id) continue;
      const payerShare = payer.amountCents / totalPaid;
      const owedToPayer = Math.round(consumed * payerShare);
      if (owedToPayer <= 0) continue;

      edges.push({
        fromUserId: p.id,
        toUserId: payer.userId,
        amountCents: owedToPayer,
      });
    }
  }

  return consolidateEdges(edges);
}

export function simplifyDebts(
  originalEdges: DebtEdge[],
  participants: User[],
): SimplificationResult {
  const steps: SimplificationStep[] = [
    {
      edges: [...originalEdges],
      description: "Dividas originais",
    },
  ];

  let currentEdges = [...originalEdges];

  let changed = true;
  while (changed) {
    changed = false;

    for (let i = 0; i < currentEdges.length && !changed; i++) {
      const a = currentEdges[i];

      const reverseIdx = currentEdges.findIndex(
        (e, j) => j !== i && e.fromUserId === a.toUserId && e.toUserId === a.fromUserId,
      );
      if (reverseIdx !== -1) {
        const b = currentEdges[reverseIdx];
        const net = a.amountCents - b.amountCents;
        const removed = [a, b];
        const next = currentEdges.filter((_, j) => j !== i && j !== reverseIdx);

        const nameA = getUserName(a.fromUserId, participants);
        const nameB = getUserName(a.toUserId, participants);

        if (Math.abs(net) > 0) {
          const newEdge: DebtEdge = net > 0
            ? { fromUserId: a.fromUserId, toUserId: a.toUserId, amountCents: net }
            : { fromUserId: a.toUserId, toUserId: a.fromUserId, amountCents: Math.abs(net) };
          next.push(newEdge);
          steps.push({
            edges: consolidateEdges(next),
            description: `${nameA} ↔ ${nameB}: compensado para ${formatBRL(Math.abs(net))}`,
            removedEdges: removed,
            addedEdge: newEdge,
          });
        } else {
          steps.push({
            edges: consolidateEdges(next),
            description: `${nameA} ↔ ${nameB}: dividas se cancelam`,
            removedEdges: removed,
          });
        }
        currentEdges = consolidateEdges(next);
        changed = true;
        break;
      }

      for (let j = 0; j < currentEdges.length && !changed; j++) {
        if (i === j) continue;
        const b = currentEdges[j];

        if (a.toUserId === b.fromUserId && a.fromUserId !== b.toUserId) {
          const transfer = Math.min(a.amountCents, b.amountCents);
          const removed = [
            { ...a, amountCents: transfer },
            { ...b, amountCents: transfer },
          ];
          const next = currentEdges.filter((_, k) => k !== i && k !== j);

          if (a.amountCents > transfer) {
            next.push({ ...a, amountCents: a.amountCents - transfer });
          }
          if (b.amountCents > transfer) {
            next.push({ ...b, amountCents: b.amountCents - transfer });
          }

          const newEdge: DebtEdge = {
            fromUserId: a.fromUserId,
            toUserId: b.toUserId,
            amountCents: transfer,
          };
          next.push(newEdge);

          const nameA = getUserName(a.fromUserId, participants);
          const nameMiddle = getUserName(a.toUserId, participants);
          const nameC = getUserName(b.toUserId, participants);

          steps.push({
            edges: consolidateEdges(next),
            description: `${nameA} → ${nameMiddle} → ${nameC} vira ${nameA} → ${nameC} (${formatBRL(transfer)})`,
            removedEdges: removed,
            addedEdge: newEdge,
          });

          currentEdges = consolidateEdges(next);
          changed = true;
          break;
        }
      }
    }
  }

  const simplifiedEdges = netAndMinimize(originalEdges);

  if (currentEdges.length > simplifiedEdges.length) {
    steps.push({
      edges: simplifiedEdges,
      description: "Resultado final otimizado",
    });
    currentEdges = simplifiedEdges;
  }

  return {
    originalEdges,
    steps,
    simplifiedEdges: currentEdges,
    originalCount: originalEdges.length,
    simplifiedCount: currentEdges.length,
  };
}
