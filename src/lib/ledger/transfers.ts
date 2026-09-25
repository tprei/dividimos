import type { BalanceRow, Transfer } from "@/types/ledger";

function byIdAsc(a: { participantId: string }, b: { participantId: string }): number {
  if (a.participantId < b.participantId) return -1;
  if (a.participantId > b.participantId) return 1;
  return 0;
}

interface OpenPosition {
  kind: BalanceRow["kind"];
  participantId: string;
  open: number;
}

export function transfersFromBalances(balances: readonly BalanceRow[]): Transfer[] {
  const debtors = balances
    .filter((row) => row.netCents < 0)
    .sort((a, b) => a.netCents - b.netCents || byIdAsc(a, b))
    .map((row): OpenPosition => ({ kind: row.kind, participantId: row.participantId, open: -row.netCents }));
  const creditors = balances
    .filter((row) => row.netCents > 0)
    .sort((a, b) => b.netCents - a.netCents || byIdAsc(a, b))
    .map((row): OpenPosition => ({ kind: row.kind, participantId: row.participantId, open: row.netCents }));

  const transfers: Transfer[] = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const amount = Math.min(debtors[di].open, creditors[ci].open);
    if (amount <= 0) break;
    transfers.push({
      fromKind: debtors[di].kind,
      fromId: debtors[di].participantId,
      toId: creditors[ci].participantId,
      amountCents: amount,
    });
    debtors[di].open -= amount;
    creditors[ci].open -= amount;
    if (debtors[di].open <= 0) di++;
    if (creditors[ci].open <= 0) ci++;
  }
  return transfers;
}

export function transfersInvolving(
  transfers: readonly Transfer[],
  userId: string,
): { owes: Transfer[]; owed: Transfer[] } {
  return {
    owes: transfers.filter((transfer) => transfer.fromId === userId),
    owed: transfers.filter((transfer) => transfer.toId === userId),
  };
}
