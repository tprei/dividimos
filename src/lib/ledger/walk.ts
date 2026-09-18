import { allocateByWeights } from "@/lib/expense-money";
import {
  type LedgerFact,
  projectBalances,
  projectTransfers,
} from "@/lib/ledger/model";

/**
 * Deterministic walks over the ledger, planned entirely in memory.
 *
 * A journey is a list of actions a bot could legally take, chosen by a seeded
 * generator that consults the in-memory projection before every step: it only
 * proposes a settlement someone can actually make, only edits an expense that
 * exists, and closes every episode by settling until no balance is left. The
 * plan is produced without touching a database, so the same seed yields the
 * same journey in a unit test, against a local Postgres, and against
 * production.
 *
 * Planning is separate from executing on purpose. A red production run can
 * report a seed, and that seed reproduces the exact journey offline.
 */

export interface ExpensePlan {
  totalCents: number;
  /** member indexes, in payload order; the first one is the actor */
  participants: number[];
  shares: number[];
  payers: { participantIndex: number; amountCents: number }[];
  serviceFeeBps: number;
  title: string;
}

export type WalkAction =
  | { kind: "create"; key: string; actor: number; plan: ExpensePlan }
  | { kind: "edit"; key: string; actor: number; targetKey: string; shares: number[]; title: string }
  | { kind: "delete"; key: string; actor: number; targetKey: string }
  | { kind: "restore"; key: string; actor: number; targetKey: string }
  | {
      kind: "settle";
      key: string;
      actor: number;
      from: number;
      to: number;
      amountCents: number;
      allowOverpay: boolean;
    }
  | { kind: "void"; key: string; actor: number; targetKey: string };

export interface EpisodePlan {
  seed: number;
  memberCount: number;
  actions: WalkAction[];
  /** How many of the actions are the closing settlements. */
  closingActions: number;
}

export interface PlanOptions {
  seed: number;
  memberCount: number;
  /** Random actions before the closing settlements. */
  steps: number;
}

// Mulberry32: tiny, fast, and good enough to pick actions. The point is
// reproducibility from a single 32-bit seed, not cryptographic quality.
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
  };
}

const TITLES = [
  "Padaria da esquina",
  "Uber pro aeroporto",
  "Mercado do mês",
  "Pizza de domingo",
  "Gasolina da viagem",
  "Ingresso do show",
  "Café da tarde",
  "Conta do bar",
];

interface PlannedExpense {
  key: string;
  creator: number;
  participants: number[];
  totalCents: number;
  shares: number[];
  payers: { participantIndex: number; amountCents: number }[];
  status: "active" | "deleted";
  versionNo: number;
}

interface PlannedSettlement {
  key: string;
  from: number;
  to: number;
  amountCents: number;
  status: "confirmed" | "voided";
}

function weightsFor(random: () => number, count: number): number[] {
  return Array.from({ length: count }, () => 1 + Math.floor(random() * 5));
}

function sharesFor(totalCents: number, weights: number[]): number[] {
  const allocated = allocateByWeights(totalCents, weights);
  if (!allocated.ok) {
    throw new Error(`walk share allocation failed: ${allocated.issue.code}`);
  }
  return allocated.value.map((cents) => cents as number);
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

/** Distinct member indexes, the actor first. */
function participantsFor(random: () => number, memberCount: number): number[] {
  const wanted = 2 + Math.floor(random() * (memberCount - 1));
  const pool = Array.from({ length: memberCount }, (_, index) => index);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(wanted, memberCount));
}

function payersFor(
  random: () => number,
  participants: number[],
  totalCents: number,
): { participantIndex: number; amountCents: number }[] {
  if (participants.length < 2 || totalCents < 2 || random() < 0.5) {
    return [{ participantIndex: 0, amountCents: totalCents }];
  }
  const [first] = sharesFor(totalCents, weightsFor(random, 2));
  const firstAmount = Math.min(Math.max(first, 1), totalCents - 1);
  return [
    { participantIndex: 0, amountCents: firstAmount },
    { participantIndex: 1, amountCents: totalCents - firstAmount },
  ];
}

function factsOf(
  expenses: readonly PlannedExpense[],
  settlements: readonly PlannedSettlement[],
  memberIds: readonly string[],
): LedgerFact[] {
  return [
    ...expenses.map(
      (expense): LedgerFact => ({
        kind: "expense",
        expenseId: expense.key,
        clientId: expense.key,
        status: expense.status,
        versionNo: expense.versionNo,
        rows: expense.participants.map((member, index) => ({
          participantId: memberIds[member],
          shareCents: expense.shares[index],
          paidCents: expense.payers
            .filter((payer) => payer.participantIndex === index)
            .reduce((sum, payer) => sum + payer.amountCents, 0),
        })),
      }),
    ),
    ...settlements.map(
      (settlement): LedgerFact => ({
        kind: "settlement",
        settlementId: settlement.key,
        operationId: settlement.key,
        status: settlement.status,
        fromUserId: memberIds[settlement.from],
        toUserId: memberIds[settlement.to],
        amountCents: settlement.amountCents,
      }),
    ),
  ];
}

/**
 * Plans one self-contained journey: `steps` random actions, then settlements
 * until every balance is zero. Actions are legal by construction, so an
 * executor that follows the plan never provokes a validation error from the
 * RPCs; anything the database refuses is a real disagreement.
 */
export function planEpisode(options: PlanOptions): EpisodePlan {
  const { seed, memberCount, steps } = options;
  if (memberCount < 2) {
    throw new Error(`a journey needs at least two members, got ${memberCount}`);
  }
  const random = createRandom(seed);
  // Planning only needs stable identities, and the executor maps these onto
  // the real bot ids in journey order.
  const memberIds = Array.from({ length: memberCount }, (_, index) => `m${index}`);

  const expenses: PlannedExpense[] = [];
  const settlements: PlannedSettlement[] = [];
  const actions: WalkAction[] = [];
  const facts = () => factsOf(expenses, settlements, memberIds);

  const createExpense = (key: string): WalkAction => {
    const participants = participantsFor(random, memberCount);
    const totalCents = 100 + Math.floor(random() * 49_900);
    const shares = sharesFor(totalCents, weightsFor(random, participants.length));
    const payers = payersFor(random, participants, totalCents);
    const plan: ExpensePlan = {
      totalCents,
      participants,
      shares,
      payers,
      serviceFeeBps: random() < 0.3 ? 500 + Math.floor(random() * 1_000) : 0,
      title: pick(random, TITLES),
    };
    expenses.push({
      key,
      creator: participants[0],
      participants,
      totalCents,
      shares,
      payers,
      status: "active",
      versionNo: 1,
    });
    return { kind: "create", key, actor: participants[0], plan };
  };

  for (let step = 0; step < steps; step++) {
    const key = `a${step}`;
    const active = expenses.filter((expense) => expense.status === "active");
    const deleted = expenses.filter((expense) => expense.status === "deleted");
    const confirmed = settlements.filter((settlement) => settlement.status === "confirmed");
    const transfers = projectTransfers(facts());

    /** Every action the ledger would accept right now. */
    const choices: (() => WalkAction)[] = [() => createExpense(key)];

    if (active.length > 0) {
      choices.push(() => {
        const target = pick(random, active);
        const shares = sharesFor(target.totalCents, weightsFor(random, target.participants.length));
        target.shares = shares;
        target.versionNo += 1;
        return {
          kind: "edit",
          key,
          actor: target.creator,
          targetKey: target.key,
          shares,
          title: `${pick(random, TITLES)} (revisado)`,
        };
      });
      choices.push(() => {
        const target = pick(random, active);
        target.status = "deleted";
        return { kind: "delete", key, actor: target.creator, targetKey: target.key };
      });
    }

    if (deleted.length > 0) {
      choices.push(() => {
        const target = pick(random, deleted);
        target.status = "active";
        return { kind: "restore", key, actor: target.creator, targetKey: target.key };
      });
    }

    if (transfers.length > 0) {
      choices.push(() => {
        const transfer = pick(random, transfers);
        const from = memberIds.indexOf(transfer.fromId);
        const to = memberIds.indexOf(transfer.toId);
        // Part of the debt, or all of it.
        const amountCents =
          random() < 0.4
            ? Math.max(1, Math.floor(transfer.amountCents * (0.2 + random() * 0.6)))
            : transfer.amountCents;
        settlements.push({ key, from, to, amountCents, status: "confirmed" });
        return { kind: "settle", key, actor: from, from, to, amountCents, allowOverpay: false };
      });
      // Overpaying on purpose: the debt flips direction and the closing
      // settlements have to walk it back.
      choices.push(() => {
        const transfer = pick(random, transfers);
        const from = memberIds.indexOf(transfer.fromId);
        const to = memberIds.indexOf(transfer.toId);
        const amountCents = transfer.amountCents + 1 + Math.floor(random() * 500);
        settlements.push({ key, from, to, amountCents, status: "confirmed" });
        return { kind: "settle", key, actor: from, from, to, amountCents, allowOverpay: true };
      });
    }

    if (confirmed.length > 0) {
      choices.push(() => {
        const target = pick(random, confirmed);
        target.status = "voided";
        return { kind: "void", key, actor: target.from, targetKey: target.key };
      });
    }

    actions.push(pick(random, choices)());
  }

  // Close out: the greedy pairing is deterministic, so this terminates with
  // one settlement per participant at worst.
  const closingStart = actions.length;
  for (let round = 0; round < memberCount * 4; round++) {
    const transfers = projectTransfers(facts());
    if (transfers.length === 0) break;
    const transfer = transfers[0];
    const from = memberIds.indexOf(transfer.fromId);
    const to = memberIds.indexOf(transfer.toId);
    const key = `close${round}`;
    settlements.push({ key, from, to, amountCents: transfer.amountCents, status: "confirmed" });
    actions.push({
      kind: "settle",
      key,
      actor: from,
      from,
      to,
      amountCents: transfer.amountCents,
      allowOverpay: false,
    });
  }

  const leftover = projectBalances(facts());
  if (leftover.length > 0) {
    throw new Error(`walk ${seed} could not settle: ${JSON.stringify(leftover)}`);
  }

  return {
    seed,
    memberCount,
    actions,
    closingActions: actions.length - closingStart,
  };
}

/**
 * The model state after the first `count` actions of a plan, as facts. Lets an
 * executor assert production against the plan step by step without re-running
 * the generator.
 */
export function factsAfter(
  plan: EpisodePlan,
  count: number,
  memberIds: readonly string[],
): LedgerFact[] {
  const expenses: PlannedExpense[] = [];
  const settlements: PlannedSettlement[] = [];

  for (const action of plan.actions.slice(0, count)) {
    switch (action.kind) {
      case "create":
        expenses.push({
          key: action.key,
          creator: action.actor,
          participants: action.plan.participants,
          totalCents: action.plan.totalCents,
          shares: action.plan.shares,
          payers: action.plan.payers,
          status: "active",
          versionNo: 1,
        });
        break;
      case "edit": {
        const target = expenses.find((expense) => expense.key === action.targetKey);
        if (!target) throw new Error(`plan edits unknown expense ${action.targetKey}`);
        target.shares = action.shares;
        target.versionNo += 1;
        break;
      }
      case "delete":
      case "restore": {
        const target = expenses.find((expense) => expense.key === action.targetKey);
        if (!target) throw new Error(`plan ${action.kind}s unknown expense ${action.targetKey}`);
        target.status = action.kind === "delete" ? "deleted" : "active";
        break;
      }
      case "settle":
        settlements.push({
          key: action.key,
          from: action.from,
          to: action.to,
          amountCents: action.amountCents,
          status: "confirmed",
        });
        break;
      case "void": {
        const target = settlements.find((settlement) => settlement.key === action.targetKey);
        if (!target) throw new Error(`plan voids unknown settlement ${action.targetKey}`);
        target.status = "voided";
        break;
      }
    }
  }

  return factsOf(expenses, settlements, memberIds);
}
