import type { BalanceRow, ExpensePayload, ParticipantKind } from "@/types/ledger";

export interface SettlementDelta {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

interface PendingDelta {
  kind: ParticipantKind;
  participantId: string;
  delta: number;
}

function rowKey(kind: ParticipantKind, participantId: string): string {
  return `${kind}:${participantId}`;
}

function compareRows(a: BalanceRow, b: BalanceRow): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.participantId < b.participantId) return -1;
  if (a.participantId > b.participantId) return 1;
  return 0;
}

function mergeDeltas(balances: readonly BalanceRow[], deltas: readonly PendingDelta[]): BalanceRow[] {
  const rows = new Map<string, BalanceRow>();
  for (const row of balances) {
    rows.set(rowKey(row.kind, row.participantId), { ...row });
  }
  for (const delta of deltas) {
    const key = rowKey(delta.kind, delta.participantId);
    const existing = rows.get(key);
    if (existing) {
      existing.netCents += delta.delta;
    } else {
      rows.set(key, { kind: delta.kind, participantId: delta.participantId, netCents: delta.delta });
    }
  }
  return Array.from(rows.values())
    .filter((row) => row.netCents !== 0)
    .sort(compareRows);
}

export function hasUnresolvedParticipants(payload: ExpensePayload): boolean {
  return payload.participants.some(
    (participant) => (participant.kind === "user" ? participant.userId : participant.guestId) === null,
  );
}

export function applyExpenseDelta(
  balances: readonly BalanceRow[],
  payload: ExpensePayload,
  sign: 1 | -1,
): BalanceRow[] {
  if (hasUnresolvedParticipants(payload)) return [...balances];
  const paid = new Array<number>(payload.participants.length).fill(0);
  for (const payer of payload.payers) {
    if (payer.participantIndex >= 0 && payer.participantIndex < paid.length) {
      paid[payer.participantIndex] += payer.amountCents;
    }
  }
  const deltas: PendingDelta[] = [];
  payload.participants.forEach((participant, index) => {
    const participantId = participant.kind === "user" ? participant.userId : participant.guestId;
    if (participantId === null) return;
    deltas.push({
      kind: participant.kind,
      participantId,
      delta: (paid[index] - (payload.shares[index] ?? 0)) * sign,
    });
  });
  return mergeDeltas(balances, deltas);
}

export function applySettlementDelta(
  balances: readonly BalanceRow[],
  settlement: SettlementDelta,
  sign: 1 | -1,
): BalanceRow[] {
  return mergeDeltas(balances, [
    { kind: "user", participantId: settlement.fromUserId, delta: settlement.amountCents * sign },
    { kind: "user", participantId: settlement.toUserId, delta: -settlement.amountCents * sign },
  ]);
}
