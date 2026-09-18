import type { BalanceRow, Transfer } from "@/types/ledger";
import { transfersFromBalances } from "./transfers";

/**
 * Deterministic in-memory mirror of the ledger projection, with no I/O.
 *
 * `recompute_group_balances` sums `paid_cents - share_cents` over the
 * participants of every active expense plus every confirmed settlement, and
 * omits participants whose net lands on zero. `group_pairwise_edges` pairs
 * debtors with creditors inside each expense and then nets each unordered
 * pair, settlements included. Both rules are reproduced here so tests can
 * assert what production must answer without asking production first.
 */

export type ExpenseRow = Readonly<{
  participantId: string;
  shareCents: number;
  paidCents: number;
}>;

export type ExpenseFact = Readonly<{
  kind: "expense";
  expenseId: string;
  clientId: string;
  status: "active" | "deleted";
  versionNo: number;
  rows: readonly ExpenseRow[];
}>;

export type SettlementFact = Readonly<{
  kind: "settlement";
  settlementId: string;
  operationId: string;
  status: "confirmed" | "voided";
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}>;

export type LedgerFact = ExpenseFact | SettlementFact;

function requireInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${value}`);
  }
  return value;
}

function netsByParticipant(facts: readonly LedgerFact[]): Map<string, number> {
  const nets = new Map<string, number>();
  const add = (participantId: string, delta: number) =>
    nets.set(participantId, (nets.get(participantId) ?? 0) + delta);
  for (const fact of facts) {
    if (fact.kind === "expense") {
      if (fact.status !== "active") continue;
      for (const row of fact.rows) {
        requireInteger(row.shareCents, `share of ${row.participantId}`);
        requireInteger(row.paidCents, `paid of ${row.participantId}`);
        add(row.participantId, row.paidCents - row.shareCents);
      }
      continue;
    }
    if (fact.status !== "confirmed") continue;
    requireInteger(fact.amountCents, `settlement ${fact.settlementId}`);
    add(fact.fromUserId, fact.amountCents);
    add(fact.toUserId, -fact.amountCents);
  }
  return nets;
}

/** Signed net per participant, zeros dropped, ordered like the SQL projection. */
export function projectBalances(facts: readonly LedgerFact[]): BalanceRow[] {
  return Array.from(netsByParticipant(facts))
    .filter(([, netCents]) => netCents !== 0)
    .map(([participantId, netCents]): BalanceRow => ({
      kind: "user",
      participantId,
      netCents,
    }))
    .sort((a, b) => (a.participantId < b.participantId ? -1 : 1));
}

/** The minimized transfer set a client derives from the balances. */
export function projectTransfers(facts: readonly LedgerFact[]): Transfer[] {
  return transfersFromBalances(projectBalances(facts));
}

interface PairNet {
  leftId: string;
  rightId: string;
  net: number;
}

/**
 * Pair-level debts: each expense is minimized on its own, then every
 * unordered pair is netted across expenses and settlements. A positive net
 * means the lexicographically smaller id owes the larger one.
 */
export function projectPairwiseEdges(facts: readonly LedgerFact[]): Transfer[] {
  const pairs = new Map<string, PairNet>();

  const addPair = (fromId: string, toId: string, amountCents: number): void => {
    const leftFirst = fromId < toId;
    const leftId = leftFirst ? fromId : toId;
    const rightId = leftFirst ? toId : fromId;
    const key = `${leftId}|${rightId}`;
    const pair = pairs.get(key) ?? { leftId, rightId, net: 0 };
    pair.net += leftFirst ? amountCents : -amountCents;
    pairs.set(key, pair);
  };

  for (const fact of facts) {
    if (fact.kind === "expense") {
      if (fact.status !== "active") continue;
      const withinExpense = fact.rows.map((row): BalanceRow => ({
        kind: "user",
        participantId: row.participantId,
        netCents: requireInteger(row.paidCents, "paid") - requireInteger(row.shareCents, "share"),
      }));
      for (const edge of transfersFromBalances(withinExpense)) {
        addPair(edge.fromId, edge.toId, edge.amountCents);
      }
      continue;
    }
    if (fact.status !== "confirmed") continue;
    // A settlement pays down what the payer owes, so it moves the pair the
    // other way.
    addPair(fact.toUserId, fact.fromUserId, requireInteger(fact.amountCents, "settlement"));
  }

  return Array.from(pairs.values())
    .filter((pair) => pair.net !== 0)
    .map((pair): Transfer => ({
      fromKind: "user",
      fromId: pair.net > 0 ? pair.leftId : pair.rightId,
      toId: pair.net > 0 ? pair.rightId : pair.leftId,
      amountCents: Math.abs(pair.net),
    }))
    .sort((a, b) => (a.fromId === b.fromId ? (a.toId < b.toId ? -1 : 1) : a.fromId < b.fromId ? -1 : 1));
}
