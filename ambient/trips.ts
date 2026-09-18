import { createHash } from "node:crypto";
import type { SeededUser } from "../e2e/seed-helper";
import { formatBRL } from "../src/lib/currency";
import { decodeGroupSnapshot } from "../src/lib/ledger/decode";
import {
  type ExpenseRow,
  type LedgerFact,
  projectBalances,
  projectPairwiseEdges,
  projectTransfers,
} from "../src/lib/ledger/model";
import type { ExpensePayload, ExpenseType, ParticipantRef } from "../src/types/ledger";
import type { Troupe } from "./bots";
import { firstName, note } from "./diary";

/**
 * Bot trips: a group per trip, a scripted arc of expenses and settlements
 * that ends with every balance back at zero, and the pure ledger model as
 * the oracle. Every run replays the trip's facts from the database, checks
 * production against the model, then advances the script a few steps.
 *
 * A trip group is never deleted: delete_group refuses any group that carries
 * financial history. Finished trips simply stay at zero and a new trip
 * starts the next UTC day.
 */

export const TRIP_GROUP_PREFIX = "Viagem dos bots";

export interface ExpenseRecord {
  expenseId: string;
  clientId: string;
  status: "active" | "deleted";
  versionNo: number;
  occurredOn: string;
  title: string;
  expenseType: ExpenseType;
  totalCents: number;
  serviceFeeBps: number;
  fixedFeeCents: number;
  payload: ExpensePayload;
}

export interface SettlementRecord {
  settlementId: string;
  operationId: string;
  status: "confirmed" | "voided";
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

export interface TripState {
  facts: LedgerFact[];
  expenses: ExpenseRecord[];
  settlements: SettlementRecord[];
}

export interface TripContext {
  troupe: Troupe;
  groupId: string;
  tripIndex: number;
  members: SeededUser[];
  state: TripState;
}

export interface CreateSpec {
  title: string;
  totalCents: number;
  /** member indexes, in payload order */
  participants: number[];
  shares: number[];
  payers: { participantIndex: number; amountCents: number }[];
  serviceFeeBps?: number;
  fixedFeeCents?: number;
}

export type TripStep =
  | { key: string; kind: "create"; actor: number; spec: (ctx: TripContext) => CreateSpec }
  | {
      key: string;
      kind: "edit";
      actor: number;
      targetKey: string;
      title?: string;
      mutate: (payload: ExpensePayload) => ExpensePayload;
    }
  | { key: string; kind: "delete"; actor: number; targetKey: string }
  | { key: string; kind: "restore"; actor: number; targetKey: string }
  | {
      key: string;
      kind: "settle";
      actor: number;
      from: number;
      to: number;
      amount: (ctx: TripContext) => number;
      allowOverpay?: boolean;
    }
  | { key: string; kind: "void"; actor: number; targetKey: string }
  | { key: string; kind: "settleAll" }
  | { key: string; kind: "probe"; run: (ctx: TripContext) => Promise<void> };

export interface Trip {
  name: string;
  memberCount: number;
  steps: TripStep[];
}

/**
 * Stable uuid for a step's fact. create_expense is idempotent by client id
 * and record_settlement by operation id, so a retry after a lost response
 * finds the existing fact instead of writing a second one.
 */
export function factId(groupId: string, key: string): string {
  const hex = createHash("sha256").update(`${groupId}:${key}`).digest("hex");
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export function netOf(ctx: TripContext, member: number): number {
  const id = ctx.members[member].id;
  return projectBalances(ctx.state.facts).find((row) => row.participantId === id)?.netCents ?? 0;
}

export function debt(ctx: TripContext, member: number): number {
  return Math.max(0, -netOf(ctx, member));
}

export function owed(ctx: TripContext, member: number): number {
  return Math.max(0, netOf(ctx, member));
}


function rowsFromPayload(payload: ExpensePayload): ExpenseRow[] {
  return payload.participants.map((participant, index) => {
    if (participant.kind !== "user") {
      throw new Error("trip expense has a guest participant; trips are user only");
    }
    return {
      participantId: participant.userId,
      shareCents: payload.shares[index],
      paidCents: payload.payers
        .filter((payer) => payer.participantIndex === index)
        .reduce((sum, payer) => sum + payer.amountCents, 0),
    };
  });
}

interface ExpenseTableRow {
  id: string;
  client_id: string;
  status: "active" | "deleted";
  current_version_no: number;
}

interface VersionRow {
  expense_id: string;
  version_no: number;
  occurred_on: string;
  title: string;
  expense_type: ExpenseType;
  total_cents: number;
  service_fee_bps: number;
  fixed_fee_cents: number;
  payload: ExpensePayload;
}

interface SettlementRow {
  id: string;
  operation_id: string;
  status: "confirmed" | "voided";
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
}

/**
 * Rebuilds the trip's facts from the database with the service-role client,
 * the same read-only use the expense prune already makes of it. Expenses and
 * settlements are read together; the version bodies need the expense ids, so
 * they follow in a second read.
 */
export async function replayTrip(troupe: Troupe, groupId: string): Promise<TripState> {
  const [expenseResult, settlementResult] = await Promise.all([
    troupe.admin
      .from("expenses")
      .select("id,client_id,status,current_version_no")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true })
      .returns<ExpenseTableRow[]>(),
    troupe.admin
      .from("settlements")
      .select("id,operation_id,status,from_user_id,to_user_id,amount_cents")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true })
      .returns<SettlementRow[]>(),
  ]);

  if (expenseResult.error) {
    throw new Error(`trip replay: list expenses failed: ${expenseResult.error.message}`);
  }
  if (settlementResult.error) {
    throw new Error(`trip replay: list settlements failed: ${settlementResult.error.message}`);
  }

  const expenseRows = expenseResult.data ?? [];
  const settlementRows = settlementResult.data ?? [];

  let versionRows: VersionRow[] = [];
  if (expenseRows.length > 0) {
    const { data, error } = await troupe.admin
      .from("expense_versions")
      .select(
        "expense_id,version_no,occurred_on,title,expense_type,total_cents,service_fee_bps,fixed_fee_cents,payload",
      )
      .in(
        "expense_id",
        expenseRows.map((row) => row.id),
      )
      .returns<VersionRow[]>();
    if (error) {
      throw new Error(`trip replay: list expense versions failed: ${error.message}`);
    }
    versionRows = data ?? [];
  }

  const expenses = expenseRows.map((row): ExpenseRecord => {
    const version = versionRows.find(
      (candidate) =>
        candidate.expense_id === row.id && candidate.version_no === row.current_version_no,
    );
    if (!version) {
      throw new Error(`trip replay: expense ${row.id} has no version ${row.current_version_no}`);
    }
    return {
      expenseId: row.id,
      clientId: row.client_id,
      status: row.status,
      versionNo: row.current_version_no,
      occurredOn: version.occurred_on,
      title: version.title,
      expenseType: version.expense_type,
      totalCents: version.total_cents,
      serviceFeeBps: version.service_fee_bps,
      fixedFeeCents: version.fixed_fee_cents,
      payload: version.payload,
    };
  });

  const settlements = settlementRows.map(
    (row): SettlementRecord => ({
      settlementId: row.id,
      operationId: row.operation_id,
      status: row.status,
      fromUserId: row.from_user_id,
      toUserId: row.to_user_id,
      amountCents: row.amount_cents,
    }),
  );

  const facts: LedgerFact[] = [
    ...expenses.map(
      (expense): LedgerFact => ({
        kind: "expense",
        expenseId: expense.expenseId,
        clientId: expense.clientId,
        status: expense.status,
        versionNo: expense.versionNo,
        rows: rowsFromPayload(expense.payload),
      }),
    ),
    ...settlements.map(
      (settlement): LedgerFact => ({
        kind: "settlement",
        settlementId: settlement.settlementId,
        operationId: settlement.operationId,
        status: settlement.status,
        fromUserId: settlement.fromUserId,
        toUserId: settlement.toUserId,
        amountCents: settlement.amountCents,
      }),
    ),
  ];

  return { facts, expenses, settlements };
}

/** Production must answer exactly what the model says, every step. */
export async function verifyAgainstProduction(ctx: TripContext, label: string): Promise<void> {
  const client = await ctx.troupe.seed.authenticateAs(ctx.members[0].id);
  const { data, error } = await client.rpc("get_group", { p_group_id: ctx.groupId });
  if (error) {
    throw new Error(`trip get_group failed at ${label}: ${error.message}`);
  }
  const decoded = decodeGroupSnapshot(data);
  if (!decoded.ok) {
    throw new Error(
      `trip snapshot rejected at ${label}: ${decoded.issue.path.join(".") || "<root>"}`,
    );
  }

  const expectedBalances = projectBalances(ctx.state.facts);
  const expectedEdges = projectPairwiseEdges(ctx.state.facts);
  const actualBalances = decoded.value.balances;
  const actualEdges = decoded.value.pairwiseEdges;

  if (JSON.stringify(actualBalances) !== JSON.stringify(expectedBalances)) {
    note(`Trip diverged at ${label}: balances do not match the model`);
    throw new Error(
      `trip ${ctx.groupId} diverged at ${label}: balances expected ` +
        `${JSON.stringify(expectedBalances)} got ${JSON.stringify(actualBalances)}`,
    );
  }
  if (JSON.stringify(actualEdges) !== JSON.stringify(expectedEdges)) {
    note(`Trip diverged at ${label}: pairwise edges do not match the model`);
    throw new Error(
      `trip ${ctx.groupId} diverged at ${label}: pairwise edges expected ` +
        `${JSON.stringify(expectedEdges)} got ${JSON.stringify(actualEdges)}`,
    );
  }
}

export function expenseFor(ctx: TripContext, key: string): ExpenseRecord {
  const clientId = factId(ctx.groupId, key);
  const record = ctx.state.expenses.find((expense) => expense.clientId === clientId);
  if (!record) {
    throw new Error(`trip step ${key} has no expense to work on`);
  }
  return record;
}

function settlementFor(ctx: TripContext, key: string): SettlementRecord | undefined {
  const operationId = factId(ctx.groupId, key);
  return ctx.state.settlements.find((settlement) => settlement.operationId === operationId);
}

function closeSettlementCount(ctx: TripContext): number {
  let count = 0;
  while (settlementFor(ctx, `close-${count}`)) {
    count += 1;
  }
  return count;
}

function isDone(ctx: TripContext, step: TripStep, restorable: Set<string>): boolean {
  switch (step.kind) {
    case "create":
      return ctx.state.expenses.some(
        (expense) => expense.clientId === factId(ctx.groupId, step.key),
      );
    case "edit":
      return expenseFor(ctx, step.targetKey).versionNo > 1;
    case "delete":
      return expenseFor(ctx, step.targetKey).status === "deleted";
    case "restore":
      return restorable.has(step.targetKey) && expenseFor(ctx, step.targetKey).status === "active";
    case "settle":
      return settlementFor(ctx, step.key) !== undefined;
    case "void":
      return settlementFor(ctx, step.targetKey)?.status === "voided";
    case "settleAll":
      return projectTransfers(ctx.state.facts).length === 0;
    case "probe":
      return false;
  }
}

/** Steps still to run, in script order. Probes never count as pending. */
export function pendingSteps(ctx: TripContext, trip: Trip): TripStep[] {
  const restorable = new Set<string>();
  const pending: TripStep[] = [];
  for (const step of trip.steps) {
    if (step.kind === "probe") continue;
    try {
      if (isDone(ctx, step, restorable)) {
        if (step.kind === "delete") restorable.add(step.targetKey);
        continue;
      }
    } catch {
      // A step whose target does not exist yet is pending by definition.
      pending.push(step);
      continue;
    }
    pending.push(step);
  }
  return pending;
}

const TOLERATED_REPEATS: Record<string, true> = {
  expense_deleted: true,
  expense_not_deleted: true,
  settlement_voided: true,
};

async function callStep(
  ctx: TripContext,
  actor: number,
  rpcName: string,
  args: Record<string, unknown>,
  key: string,
): Promise<void> {
  const client = await ctx.troupe.seed.authenticateAs(ctx.members[actor].id);
  const { error } = await client.rpc(rpcName, args);
  if (error && !TOLERATED_REPEATS[error.message]) {
    throw new Error(`trip step ${key} (${rpcName}) failed: ${error.message}`);
  }
}

async function recordSettlement(
  ctx: TripContext,
  actor: number,
  key: string,
  fromMember: number,
  toMember: number,
  amountCents: number,
  allowOverpay: boolean,
): Promise<void> {
  await callStep(
    ctx,
    actor,
    "record_settlement",
    {
      p_operation_id: factId(ctx.groupId, key),
      p_group_id: ctx.groupId,
      p_from_user_id: ctx.members[fromMember].id,
      p_to_user_id: ctx.members[toMember].id,
      p_amount_cents: amountCents,
      p_allow_overpay: allowOverpay,
    },
    key,
  );
}

function memberIndexOf(ctx: TripContext, userId: string): number {
  const index = ctx.members.findIndex((member) => member.id === userId);
  if (index < 0) {
    throw new Error(`trip settlement names ${userId}, who is not on this trip`);
  }
  return index;
}

/**
 * Advances the script by at most `maxFactSteps` writes, verifying production
 * against the model after each one. Already-applied steps are recognised from
 * the replayed facts, so a retried or resumed run repeats nothing.
 */
export async function runPendingSteps(
  ctx: TripContext,
  trip: Trip,
  maxFactSteps: number,
): Promise<number> {
  const restorable = new Set<string>();
  let executed = 0;
  let notesLeft = 2;

  for (const step of trip.steps) {
    if (step.kind === "probe") {
      // Probes assert a guardrail without writing a fact, and only make
      // sense once everything before them has actually happened.
      if (pendingSteps(ctx, trip).some((pending) => trip.steps.indexOf(pending) < trip.steps.indexOf(step))) {
        continue;
      }
      await step.run(ctx);
      continue;
    }

    let done = false;
    try {
      done = isDone(ctx, step, restorable);
    } catch {
      done = false;
    }
    if (done) {
      if (step.kind === "delete") restorable.add(step.targetKey);
      continue;
    }
    if (executed >= maxFactSteps) break;

    switch (step.kind) {
      case "create": {
        const spec = step.spec(ctx);
        const participants: ParticipantRef[] = spec.participants.map((member) => ({
          kind: "user",
          userId: ctx.members[member].id,
        }));
        const payload: ExpensePayload = {
          items: [],
          participants,
          shares: spec.shares,
          payers: spec.payers,
          itemAssignments: null,
        };
        await callStep(
          ctx,
          step.actor,
          "create_expense",
          {
            p_client_id: factId(ctx.groupId, step.key),
            p_group_id: ctx.groupId,
            p_occurred_on: new Date().toISOString().slice(0, 10),
            p_title: spec.title,
            p_merchant_name: null,
            p_expense_type: "single_amount",
            p_total_cents: spec.totalCents,
            p_service_fee_bps: spec.serviceFeeBps ?? 0,
            p_fixed_fee_cents: spec.fixedFeeCents ?? 0,
            p_payload: payload,
          },
          step.key,
        );
        if (notesLeft > 0) {
          note(
            `${firstName(ctx.troupe.bots, ctx.members[step.actor].id)} paid ` +
              `${formatBRL(spec.totalCents)} for "${spec.title}", split ${spec.participants.length} ways`,
          );
          notesLeft -= 1;
        }
        break;
      }
      case "edit": {
        const record = expenseFor(ctx, step.targetKey);
        await callStep(
          ctx,
          step.actor,
          "edit_expense",
          {
            p_expense_id: record.expenseId,
            p_expected_version_no: record.versionNo,
            p_occurred_on: record.occurredOn,
            p_title: step.title ?? record.title,
            p_merchant_name: "",
            p_expense_type: record.expenseType,
            p_total_cents: record.totalCents,
            p_service_fee_bps: record.serviceFeeBps,
            p_fixed_fee_cents: record.fixedFeeCents,
            p_payload: step.mutate(record.payload),
          },
          step.key,
        );
        break;
      }
      case "delete": {
        await callStep(
          ctx,
          step.actor,
          "delete_expense",
          { p_expense_id: expenseFor(ctx, step.targetKey).expenseId },
          step.key,
        );
        restorable.add(step.targetKey);
        break;
      }
      case "restore": {
        await callStep(
          ctx,
          step.actor,
          "restore_expense",
          { p_expense_id: expenseFor(ctx, step.targetKey).expenseId },
          step.key,
        );
        break;
      }
      case "settle": {
        const amountCents = step.amount(ctx);
        if (amountCents < 1) {
          // Nothing left between these two; the arc moves on.
          continue;
        }
        await recordSettlement(
          ctx,
          step.actor,
          step.key,
          step.from,
          step.to,
          amountCents,
          step.allowOverpay ?? false,
        );
        if (notesLeft > 0) {
          note(
            `${firstName(ctx.troupe.bots, ctx.members[step.from].id)} settled ` +
              `${formatBRL(amountCents)} with ${firstName(ctx.troupe.bots, ctx.members[step.to].id)}`,
          );
          notesLeft -= 1;
        }
        break;
      }
      case "void": {
        const target = settlementFor(ctx, step.targetKey);
        if (!target) {
          // Its settle step resolved to nothing to pay; there is no
          // settlement to take back.
          continue;
        }
        await callStep(
          ctx,
          step.actor,
          "void_settlement",
          { p_settlement_id: target.settlementId },
          step.key,
        );
        break;
      }
      case "settleAll": {
        while (executed < maxFactSteps) {
          const transfers = projectTransfers(ctx.state.facts);
          if (transfers.length === 0) break;
          const transfer = transfers[0];
          const from = memberIndexOf(ctx, transfer.fromId);
          const to = memberIndexOf(ctx, transfer.toId);
          const key = `close-${closeSettlementCount(ctx)}`;
          await recordSettlement(ctx, from, key, from, to, transfer.amountCents, false);
          executed += 1;
          ctx.state = await replayTrip(ctx.troupe, ctx.groupId);
          await verifyAgainstProduction(ctx, key);
        }
        continue;
      }
    }

    executed += 1;
    ctx.state = await replayTrip(ctx.troupe, ctx.groupId);
    await verifyAgainstProduction(ctx, step.key);
  }

  if (executed > 0 && pendingSteps(ctx, trip).length === 0) {
    note(
      `Trip ${ctx.tripIndex + 1} settled: every balance back to zero after ` +
        `${ctx.state.facts.length} events`,
    );
  }

  return executed;
}

interface TripGroupRow {
  id: string;
  name: string;
}

function tripIndexFromName(name: string): number {
  const match = /#(\d+)$/.exec(name);
  if (!match) {
    throw new Error(`trip group "${name}" has no trip number`);
  }
  return Number(match[1]);
}

/**
 * Finds the trip in flight, or starts today's. A trip that has not finished
 * keeps going on later runs whatever the date; a finished trip is left alone
 * until the next UTC day brings a new one. The trip list is passed in so the
 * engine never depends on the scripts.
 */
export async function findOrStartTrip(
  troupe: Troupe,
  trips: readonly Trip[],
  todayUtc: string,
): Promise<TripContext> {
  const { data, error } = await troupe.admin
    .from("groups")
    .select("id,name")
    .like("name", `${TRIP_GROUP_PREFIX} %`)
    .order("created_at", { ascending: false })
    .returns<TripGroupRow[]>();
  if (error) {
    throw new Error(`trip lookup failed: ${error.message}`);
  }
  const groups = data ?? [];
  const newest = groups[0];

  if (newest) {
    const tripIndex = tripIndexFromName(newest.name);
    const trip = trips[tripIndex % trips.length];
    const ctx: TripContext = {
      troupe,
      groupId: newest.id,
      tripIndex,
      members: troupe.bots.slice(0, trip.memberCount),
      state: await replayTrip(troupe, newest.id),
    };
    if (pendingSteps(ctx, trip).length > 0 || newest.name.includes(todayUtc)) {
      return ctx;
    }
  }

  const tripIndex = groups.length;
  const trip = trips[tripIndex % trips.length];
  const members = troupe.bots.slice(0, trip.memberCount);
  const name = `${TRIP_GROUP_PREFIX} ${todayUtc} #${tripIndex}`;
  const group = await troupe.seed.createGroup(
    members[0].id,
    members.slice(1).map((member) => member.id),
    name,
  );
  note(
    `Trip ${tripIndex + 1} started: "${trip.name}" with ` +
      members.map((member) => firstName(troupe.bots, member.id)).join(", "),
  );

  return {
    troupe,
    groupId: group.id,
    tripIndex,
    members,
    state: await replayTrip(troupe, group.id),
  };
}

