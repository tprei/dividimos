import type { Client } from "pg";
import { afterEach, beforeAll } from "vitest";

import {
  applyExpenseDelta,
  applySettlementDelta,
  hasUnresolvedParticipants,
} from "@/lib/ledger/apply";
import { transfersFromBalances } from "@/lib/ledger/transfers";
import type { BalanceRow, ExpensePayload, ParticipantKind, Transfer } from "@/types/ledger";

import { withPg } from "./integration-helpers";
import { isIntegrationTestReady, isTestGroupExempt } from "./integration-setup";

interface BalanceRecord {
  kind: ParticipantKind;
  participant_id: string;
  net_cents: string;
}

interface ExpenseRecord {
  id: string;
  payload: ExpensePayload;
}

interface SettlementRecord {
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
}

interface ParticipantRecord {
  expense_id: string;
  participant_index: number;
  kind: ParticipantKind;
  user_id: string | null;
  guest_id: string | null;
  share_cents: number;
  paid_cents: number;
}

interface TransferRecord {
  from_kind: ParticipantKind;
  from_id: string;
  to_id: string;
  amount_cents: string;
}

function compareBalances(a: BalanceRow, b: BalanceRow): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.participantId === b.participantId) return 0;
  return a.participantId < b.participantId ? -1 : 1;
}

function compareTransfers(a: Transfer, b: Transfer): number {
  if (a.fromId !== b.fromId) return a.fromId < b.fromId ? -1 : 1;
  if (a.toId !== b.toId) return a.toId < b.toId ? -1 : 1;
  return a.amountCents - b.amountCents;
}

async function readBalances(client: Client, groupId: string): Promise<BalanceRow[]> {
  const result = await client.query<BalanceRecord>(
    "select kind, participant_id, net_cents::text as net_cents " +
      "from public.group_balances where group_id = $1 order by kind, participant_id",
    [groupId],
  );
  return result.rows.map((row) => ({
    kind: row.kind,
    participantId: row.participant_id,
    netCents: Number(row.net_cents),
  }));
}

async function readActiveExpenses(client: Client, groupId: string): Promise<ExpenseRecord[]> {
  const result = await client.query<ExpenseRecord>(
    "select e.id, ev.payload " +
      "from public.expenses e " +
      "join public.expense_versions ev on ev.expense_id = e.id and ev.version_no = e.current_version_no " +
      "where e.group_id = $1 and e.status = 'active' order by e.id",
    [groupId],
  );
  return result.rows;
}

async function readConfirmedSettlements(
  client: Client,
  groupId: string,
): Promise<SettlementRecord[]> {
  const result = await client.query<SettlementRecord>(
    "select from_user_id, to_user_id, amount_cents " +
      "from public.settlements where group_id = $1 and status = 'confirmed' order by id",
    [groupId],
  );
  return result.rows;
}

function checkZeroSum(balances: readonly BalanceRow[], violations: string[]): void {
  const sum = balances.reduce((total, row) => total + row.netCents, 0);
  if (sum !== 0) {
    violations.push(
      `[1] group_balances does not sum to zero: ${sum} (${JSON.stringify(balances)})`,
    );
  }
}

function checkNoZeroRows(balances: readonly BalanceRow[], violations: string[]): void {
  const zeroRows = balances.filter((row) => row.netCents === 0);
  if (zeroRows.length > 0) {
    violations.push(`[2] group_balances holds zero rows: ${JSON.stringify(zeroRows)}`);
  }
}

function balanceKeys(rows: readonly BalanceRow[]): string[] {
  return rows.map((row) => `${row.kind}:${row.participantId}:${row.netCents}`);
}

function checkProjectionMatchesFacts(
  balances: readonly BalanceRow[],
  expenses: readonly ExpenseRecord[],
  settlements: readonly SettlementRecord[],
  violations: string[],
): void {
  let expected: BalanceRow[] = [];
  for (const expense of expenses) {
    if (hasUnresolvedParticipants(expense.payload)) {
      violations.push(
        `[3] active expense ${expense.id} stores a payload with an unresolved participant: ` +
          `${JSON.stringify(expense.payload.participants)}`,
      );
      continue;
    }
    expected = applyExpenseDelta(expected, expense.payload, 1);
  }
  for (const settlement of settlements) {
    expected = applySettlementDelta(
      expected,
      {
        fromUserId: settlement.from_user_id,
        toUserId: settlement.to_user_id,
        amountCents: settlement.amount_cents,
      },
      1,
    );
  }
  const actual = balanceKeys([...balances].sort(compareBalances));
  const recomputed = balanceKeys(expected.sort(compareBalances));
  if (actual.join("|") !== recomputed.join("|")) {
    violations.push(
      `[3] group_balances does not match the facts recomputed from payloads and settlements.\n` +
        `  projection: ${JSON.stringify(actual)}\n` +
        `  recomputed: ${JSON.stringify(recomputed)}`,
    );
  }
}

function checkParticipantsMatchPayload(
  expenses: readonly ExpenseRecord[],
  participants: readonly ParticipantRecord[],
  violations: string[],
): void {
  const byExpense = new Map<string, ParticipantRecord[]>();
  for (const row of participants) {
    const bucket = byExpense.get(row.expense_id);
    if (bucket) bucket.push(row);
    else byExpense.set(row.expense_id, [row]);
  }
  for (const expense of expenses) {
    const rows = byExpense.get(expense.id) ?? [];
    const payload = expense.payload;
    if (rows.length !== payload.participants.length) {
      violations.push(
        `[4] expense ${expense.id} has ${rows.length} materialized participants ` +
          `but the payload declares ${payload.participants.length}`,
      );
      continue;
    }
    payload.participants.forEach((participant, index) => {
      const row = rows[index];
      const expectedId =
        participant.kind === "user" ? participant.userId : participant.guestId;
      const actualId = row.kind === "user" ? row.user_id : row.guest_id;
      const expectedPaid = payload.payers
        .filter((payer) => payer.participantIndex === index)
        .reduce((total, payer) => total + payer.amountCents, 0);
      if (
        row.participant_index !== index ||
        row.kind !== participant.kind ||
        actualId !== expectedId ||
        row.share_cents !== (payload.shares[index] ?? 0) ||
        row.paid_cents !== expectedPaid
      ) {
        violations.push(
          `[4] expense ${expense.id} participant ${index} drifted from its payload.\n` +
            `  materialized: ${JSON.stringify(row)}\n` +
            `  payload: ${JSON.stringify({
              kind: participant.kind,
              participantId: expectedId,
              shareCents: payload.shares[index] ?? 0,
              paidCents: expectedPaid,
            })}`,
        );
      }
    });
  }
}

function checkTransfers(
  balances: readonly BalanceRow[],
  transfers: readonly TransferRecord[],
  violations: string[],
): void {
  const sqlTransfers: Transfer[] = transfers.map((row) => ({
    fromKind: row.from_kind,
    fromId: row.from_id,
    toId: row.to_id,
    amountCents: Number(row.amount_cents),
  }));

  const degenerate = sqlTransfers.filter(
    (transfer) => transfer.amountCents < 1 || transfer.fromId === transfer.toId,
  );
  if (degenerate.length > 0) {
    violations.push(`[6] group_transfers produced degenerate rows: ${JSON.stringify(degenerate)}`);
  }

  const nonZeroCount = balances.filter((row) => row.netCents !== 0).length;
  const maxTransfers = Math.max(0, nonZeroCount - 1);
  if (sqlTransfers.length > maxTransfers) {
    violations.push(
      `[6] group_transfers returned ${sqlTransfers.length} rows for ${nonZeroCount} ` +
        `nonzero balances (at most ${maxTransfers} are ever needed)`,
    );
  }

  const remaining = new Map(balances.map((row) => [row.participantId, row.netCents]));
  for (const transfer of sqlTransfers) {
    remaining.set(transfer.fromId, (remaining.get(transfer.fromId) ?? 0) + transfer.amountCents);
    remaining.set(transfer.toId, (remaining.get(transfer.toId) ?? 0) - transfer.amountCents);
  }
  const unsettled = Array.from(remaining).filter(([, net]) => net !== 0);
  if (unsettled.length > 0) {
    violations.push(
      `[6] applying group_transfers left nonzero balances: ${JSON.stringify(unsettled)}`,
    );
  }

  const transferKeys = (rows: readonly Transfer[]): string =>
    rows
      .map((row) => `${row.fromKind}:${row.fromId}>${row.toId}:${row.amountCents}`)
      .join("|");
  const tsTransfers = transferKeys(transfersFromBalances(balances).sort(compareTransfers));
  const sqlSorted = transferKeys([...sqlTransfers].sort(compareTransfers));
  if (sqlSorted !== tsTransfers) {
    violations.push(
      `[6] group_transfers disagrees with transfersFromBalances.\n` +
        `  sql: ${sqlSorted}\n` +
        `  ts: ${tsTransfers}`,
    );
  }
}

async function collectViolations(client: Client, groupId: string): Promise<string[]> {
  const violations: string[] = [];

  const balances = await readBalances(client, groupId);
  const expenses = await readActiveExpenses(client, groupId);
  const settlements = await readConfirmedSettlements(client, groupId);

  const participants = await client.query<ParticipantRecord>(
    "select ep.expense_id, ep.participant_index, ep.kind, ep.user_id, ep.guest_id, " +
      "ep.share_cents, ep.paid_cents " +
      "from public.expense_participants ep " +
      "join public.expenses e on e.id = ep.expense_id " +
      "where e.group_id = $1 and e.status = 'active' " +
      "order by ep.expense_id, ep.participant_index",
    [groupId],
  );
  const orphaned = await client.query<{ expense_id: string }>(
    "select distinct ep.expense_id from public.expense_participants ep " +
      "join public.expenses e on e.id = ep.expense_id " +
      "where e.group_id = $1 and e.status = 'deleted'",
    [groupId],
  );
  const transfers = await client.query<TransferRecord>(
    "select from_kind, from_id, to_id, amount_cents::text as amount_cents " +
      "from public.group_transfers($1)",
    [groupId],
  );

  checkZeroSum(balances, violations);
  checkNoZeroRows(balances, violations);
  checkProjectionMatchesFacts(balances, expenses, settlements, violations);
  checkParticipantsMatchPayload(expenses, participants.rows, violations);
  if (orphaned.rows.length > 0) {
    violations.push(
      `[5] deleted expenses still hold participant rows: ` +
        `${JSON.stringify(orphaned.rows.map((row) => row.expense_id))}`,
    );
  }
  checkTransfers(balances, transfers.rows, violations);

  return violations;
}

/**
 * Assert every ledger invariant that must hold for a group after any sequence
 * of mutations, successful or rejected. Recomputes the balance projection from
 * the underlying facts rather than trusting the SQL that wrote it.
 */
export async function assertLedgerInvariants(groupId: string): Promise<void> {
  const violations = await withPg((client) => collectViolations(client, groupId));
  if (violations.length > 0) {
    throw new Error(`Ledger invariants violated for group ${groupId}:\n${violations.join("\n")}`);
  }
}

/**
 * Check the invariants after each test against every group this file created,
 * skipping groups whose ledger_version has not moved since the last sweep.
 * Rejected mutations must leave the ledger as consistent as accepted ones, so
 * this runs regardless of what the test itself asserted, and it finds groups
 * by creation time so a test that calls create_group or get_or_create_dm
 * directly is covered too.
 */
export function assertLedgerInvariantsAfterEach(): void {
  const sweptVersions = new Map<string, string>();
  let startedAt = "";

  beforeAll(async () => {
    if (!isIntegrationTestReady) return;
    startedAt = await withPg(async (client) => {
      const { rows } = await client.query<{ now: string }>("select now()::text as now");
      return rows[0].now;
    });
  });

  afterEach(async () => {
    if (!isIntegrationTestReady) return;
    const failures = await withPg(async (client) => {
      const { rows } = await client.query<{ id: string; ledger_version: string }>(
        "select id, ledger_version::text as ledger_version from public.groups " +
          "where created_at >= $1 order by created_at",
        [startedAt],
      );
      const found: string[] = [];
      for (const row of rows) {
        if (isTestGroupExempt(row.id)) continue;
        if (sweptVersions.get(row.id) === row.ledger_version) continue;
        const violations = await collectViolations(client, row.id);
        sweptVersions.set(row.id, row.ledger_version);
        if (violations.length > 0) {
          found.push(`group ${row.id}:\n${violations.join("\n")}`);
        }
      }
      return found;
    });
    if (failures.length > 0) {
      throw new Error(`Ledger invariants violated:\n${failures.join("\n")}`);
    }
  });
}
