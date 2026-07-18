import { createClient } from "@/lib/supabase/client";
import type {
  Balance,
  RecordSettlementsRequest,
  RecordSettlementsResult,
  Settlement,
  SettlementAllocation,
} from "@/types";

type SettlementRow = {
  id: string;
  group_id: string;
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
  status: "pending" | "confirmed";
  created_at: string;
  confirmed_at: string | null;
};

type BalanceRow = {
  group_id: string;
  user_a: string;
  user_b: string;
  amount_cents: number;
  updated_at: string;
};

function mapBalanceRow(row: BalanceRow): Balance {
  return {
    groupId: row.group_id,
    userA: row.user_a,
    userB: row.user_b,
    amountCents: row.amount_cents,
    updatedAt: row.updated_at,
  };
}

function mapSettlementRow(row: SettlementRow): Settlement {
  return {
    id: row.id,
    groupId: row.group_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    amountCents: row.amount_cents,
    status: row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? undefined,
  };
}

// ============================================================
// Balance queries
// ============================================================

/**
 * Query all non-zero balances for a group.
 * Returns directed debt edges (who owes whom).
 */
export async function queryBalances(groupId: string): Promise<Balance[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("balances")
    .select("*")
    .eq("group_id", groupId)
    .neq("amount_cents", 0);

  if (error) {
    throw new Error(`Failed to query balances: ${error.message}`);
  }

  return (data as BalanceRow[] ?? []).map(mapBalanceRow);
}

/**
 * Query the balance between two specific users in a group.
 * Handles canonical ordering (user_a < user_b) internally.
 * Returns null if no balance exists (they have no history).
 */
export async function queryBalanceBetween(
  groupId: string,
  userId1: string,
  userId2: string,
): Promise<Balance | null> {
  const [userA, userB] = userId1 < userId2
    ? [userId1, userId2]
    : [userId2, userId1];

  const supabase = createClient();

  const { data, error } = await supabase
    .from("balances")
    .select("*")
    .eq("group_id", groupId)
    .eq("user_a", userA)
    .eq("user_b", userB)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query balance: ${error.message}`);
  }

  if (!data) return null;

  return mapBalanceRow(data as BalanceRow);
}

export type SettlementDatabaseErrorCategory =
  | "settlement_operation_conflict"
  | "invalid_settlement_batch"
  | "settlement_operation_corrupt"
  | "invalid_amount"
  | "invalid_users"
  | "database_rejection";

export class SettlementDatabaseRejectionError extends Error {
  readonly category: SettlementDatabaseErrorCategory;
  readonly sqlstate: string;

  constructor(
    category: SettlementDatabaseErrorCategory,
    sqlstate: string,
    message: string,
  ) {
    super(message);
    this.name = "SettlementDatabaseRejectionError";
    this.category = category;
    this.sqlstate = sqlstate;
  }
}

export class SettlementOperationConflictError extends SettlementDatabaseRejectionError {
  constructor(message: string) {
    super("settlement_operation_conflict", "PST10", message);
    this.name = "SettlementOperationConflictError";
  }
}

export class SettlementOperationCorruptError extends SettlementDatabaseRejectionError {
  constructor(message: string) {
    super("settlement_operation_corrupt", "PST12", message);
    this.name = "SettlementOperationCorruptError";
  }
}

export class SettlementOutcomeUnknownError extends Error {
  constructor(message = "The settlement outcome is unknown") {
    super(message);
    this.name = "SettlementOutcomeUnknownError";
  }
}


const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSTGRES_SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function settlementAllocationCompare(
  first: SettlementAllocation,
  second: SettlementAllocation,
): number {
  const firstFields = [
    first.groupId,
    first.fromUserId,
    first.toUserId,
    String(first.amountCents),
  ];
  const secondFields = [
    second.groupId,
    second.fromUserId,
    second.toUserId,
    String(second.amountCents),
  ];

  for (let index = 0; index < firstFields.length; index += 1) {
    if (firstFields[index] < secondFields[index]) return -1;
    if (firstFields[index] > secondFields[index]) return 1;
  }

  return 0;
}

function validateSettlementRequest(request: RecordSettlementsRequest): void {
  if (!isUuid(request.operationId)) {
    throw new Error("Settlement operation ID must be a UUID");
  }

  if (request.allocations.length === 0) {
    throw new Error("Settlement request must contain at least one allocation");
  }

  const edges = new Set<string>();
  for (const allocation of request.allocations) {
    if (
      !isUuid(allocation.groupId) ||
      !isUuid(allocation.fromUserId) ||
      !isUuid(allocation.toUserId)
    ) {
      throw new Error("Settlement allocation IDs must be UUIDs");
    }

    if (allocation.fromUserId === allocation.toUserId) {
      throw new Error("Cannot settle with yourself");
    }

    if (!Number.isSafeInteger(allocation.amountCents) || allocation.amountCents <= 0) {
      throw new Error("Settlement amount must be a positive safe integer");
    }

    const edge = `${allocation.groupId}:${allocation.fromUserId}:${allocation.toUserId}`;
    if (edges.has(edge)) {
      throw new Error("Settlement request cannot contain duplicate directed edges");
    }
    edges.add(edge);
  }
}

function isTrustworthyPostgresSqlstate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    POSTGRES_SQLSTATE_PATTERN.test(value) &&
    !value.startsWith("PGRST")
  );
}

function settlementDatabaseRejection(
  error: Record<string, unknown>,
  sqlstate: string,
): SettlementDatabaseRejectionError {
  const message = isNonEmptyString(error.message)
    ? error.message
    : "Settlement operation was rejected by the database";

  if (sqlstate === "PST10") {
    return new SettlementOperationConflictError(message);
  }
  if (sqlstate === "PST12") {
    return new SettlementOperationCorruptError(message);
  }

  let category: SettlementDatabaseErrorCategory = "database_rejection";
  if (sqlstate === "PST11") {
    category = "invalid_settlement_batch";
  } else if (sqlstate === "PST13") {
    category = "invalid_amount";
  } else if (sqlstate === "PST14") {
    category = "invalid_users";
  }

  return new SettlementDatabaseRejectionError(category, sqlstate, message);
}

function mapSettlementOperationRows(
  rows: unknown,
  allocations: readonly SettlementAllocation[],
  requireReplayFlag: boolean,
): { settlements: Settlement[]; replayed: boolean } {
  if (!Array.isArray(rows) || rows.length !== allocations.length) {
    throw new SettlementOutcomeUnknownError("Settlement RPC returned an incomplete response");
  }

  const canonicalAllocations = [...allocations].sort(settlementAllocationCompare);
  const settlements: Settlement[] = [];
  let replayed: boolean | undefined;

  for (const rowValue of rows) {
    if (!isRecord(rowValue)) {
      throw new SettlementOutcomeUnknownError("Settlement RPC returned an invalid row");
    }

    const row = rowValue;
    if (
      !isSafeInteger(row.allocation_index) ||
      row.allocation_index < 0 ||
      row.allocation_index >= canonicalAllocations.length
    ) {
      throw new SettlementOutcomeUnknownError("Settlement RPC returned an invalid allocation index");
    }

    const allocation = canonicalAllocations[row.allocation_index];
    if (
      !isNonEmptyString(row.group_id) ||
      !isNonEmptyString(row.from_user_id) ||
      !isNonEmptyString(row.to_user_id) ||
      !isSafeInteger(row.amount_cents) ||
      row.amount_cents <= 0 ||
      !isNonEmptyString(row.settlement_id) ||
      !isUuid(row.settlement_id) ||
      row.status !== "confirmed" ||
      !isNonEmptyString(row.created_at) ||
      !isNonEmptyString(row.confirmed_at)
    ) {
      throw new SettlementOutcomeUnknownError("Settlement RPC returned malformed settlement data");
    }

    if (
      row.group_id !== allocation.groupId ||
      row.from_user_id !== allocation.fromUserId ||
      row.to_user_id !== allocation.toUserId ||
      row.amount_cents !== allocation.amountCents
    ) {
      throw new SettlementOutcomeUnknownError("Settlement RPC returned mismatched settlement data");
    }

    if (requireReplayFlag) {
      if (typeof row.was_replay !== "boolean") {
        throw new SettlementOutcomeUnknownError("Settlement RPC omitted replay state");
      }
      if (replayed !== undefined && replayed !== row.was_replay) {
        throw new SettlementOutcomeUnknownError("Settlement RPC returned mixed replay state");
      }
      replayed = row.was_replay;
    }

    settlements[row.allocation_index] = {
      id: row.settlement_id,
      groupId: row.group_id,
      fromUserId: row.from_user_id,
      toUserId: row.to_user_id,
      amountCents: row.amount_cents,
      status: "confirmed",
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
    };
  }

  for (let index = 0; index < canonicalAllocations.length; index += 1) {
    if (!settlements[index]) {
      throw new SettlementOutcomeUnknownError("Settlement RPC returned non-contiguous allocation indexes");
    }
  }

  return { settlements, replayed: replayed ?? false };
}

function isOutcomeError(error: unknown): error is SettlementOutcomeUnknownError {
  return error instanceof SettlementOutcomeUnknownError;
}

function isDatabaseRejection(
  error: unknown,
): error is SettlementDatabaseRejectionError {
  return error instanceof SettlementDatabaseRejectionError;
}

function toRpcFailure(error: unknown): SettlementDatabaseRejectionError | SettlementOutcomeUnknownError {
  if (isRecord(error) && isTrustworthyPostgresSqlstate(error.code)) {
    return settlementDatabaseRejection(error, error.code);
  }

  return new SettlementOutcomeUnknownError();
}

export async function recordSettlements(
  request: RecordSettlementsRequest,
): Promise<RecordSettlementsResult> {
  validateSettlementRequest(request);

  const supabase = createClient();
  let response;
  try {
    response = await supabase.rpc("record_settlements", {
      p_operation_id: request.operationId,
      p_allocations: request.allocations.map((allocation) => ({
        group_id: allocation.groupId,
        from_user_id: allocation.fromUserId,
        to_user_id: allocation.toUserId,
        amount_cents: allocation.amountCents,
      })),
    });
  } catch (error) {
    throw toRpcFailure(error);
  }

  if (response.error) {
    throw toRpcFailure(response.error);
  }

  try {
    const mapped = mapSettlementOperationRows(response.data, request.allocations, true);
    return {
      operationId: request.operationId,
      settlements: mapped.settlements,
      replayed: mapped.replayed,
    };
  } catch (error) {
    if (isOutcomeError(error) || isDatabaseRejection(error)) {
      throw error;
    }
    throw new SettlementOutcomeUnknownError();
  }
}

export async function getSettlementOperation(
  operationId: string,
): Promise<Settlement[] | null> {
  if (!isUuid(operationId)) {
    throw new Error("Settlement operation ID must be a UUID");
  }

  const supabase = createClient();
  let response;
  try {
    response = await supabase.rpc("get_settlement_operation", {
      p_operation_id: operationId,
    });
  } catch (error) {
    throw toRpcFailure(error);
  }

  if (response.error) {
    throw toRpcFailure(response.error);
  }

  try {
    if (!Array.isArray(response.data)) {
      throw new SettlementOutcomeUnknownError("Settlement RPC returned an invalid response");
    }
    if (response.data.length === 0) {
      return null;
    }

    const settlements = mapSettlementOperationRows(
      response.data,
      response.data.map((row) => {
        if (
          !isRecord(row) ||
          !isNonEmptyString(row.group_id) ||
          !isNonEmptyString(row.from_user_id) ||
          !isNonEmptyString(row.to_user_id) ||
          !isSafeInteger(row.amount_cents)
        ) {
          throw new SettlementOutcomeUnknownError("Settlement RPC returned an invalid row");
        }

        return {
          groupId: row.group_id,
          fromUserId: row.from_user_id,
          toUserId: row.to_user_id,
          amountCents: row.amount_cents,
        };
      }),
      false,
    ).settlements;

    return settlements;
  } catch (error) {
    if (isOutcomeError(error) || isDatabaseRejection(error)) {
      throw error;
    }
    throw new SettlementOutcomeUnknownError();
  }
}

// ============================================================
// Settlement history queries
// ============================================================

/**
 * Query all settlements for a group, ordered by most recent first.
 */
export async function querySettlements(
  groupId: string,
): Promise<Settlement[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("settlements")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to query settlements: ${error.message}`);
  }

  return (data as SettlementRow[] ?? []).map(mapSettlementRow);
}

/**
 * Query settlement history between two specific users in a group.
 * Returns settlements in both directions (A→B and B→A).
 */
export async function querySettlementHistoryForBalance(
  groupId: string,
  userId1: string,
  userId2: string,
): Promise<Settlement[]> {
  const supabase = createClient();

  // Fetch settlements in both directions with a single query using OR
  const { data, error } = await supabase
    .from("settlements")
    .select("*")
    .eq("group_id", groupId)
    .or(
      `and(from_user_id.eq.${userId1},to_user_id.eq.${userId2}),and(from_user_id.eq.${userId2},to_user_id.eq.${userId1})`,
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to query settlement history: ${error.message}`);
  }

  return (data as SettlementRow[] ?? []).map(mapSettlementRow);
}


// ============================================================
// Cross-group balance between two users
// ============================================================

/**
 * Query all non-zero balance rows between two specific users across ALL groups.
 * Returns individual Balance rows plus the aggregated net amount.
 * netCents: positive = userId2 owes userId1, negative = userId1 owes userId2.
 */
export async function queryBalancesBetweenUsers(
  userId1: string,
  userId2: string,
): Promise<{ balances: Balance[]; netCents: number }> {
  const [userA, userB] = userId1 < userId2
    ? [userId1, userId2]
    : [userId2, userId1];

  const supabase = createClient();

  const { data, error } = await supabase
    .from("balances")
    .select("*")
    .eq("user_a", userA)
    .eq("user_b", userB)
    .neq("amount_cents", 0);

  if (error) {
    throw new Error(`Failed to query balances between users: ${error.message}`);
  }

  const balances = (data as BalanceRow[] ?? []).map(mapBalanceRow);

  // Compute net from userId1's perspective:
  // positive amountCents = userA owes userB
  // If userId1 === userA: they owe → negative for userId1
  // If userId1 === userB: they're owed → positive for userId1
  let netCents = 0;
  for (const b of balances) {
    if (userId1 === b.userA) {
      netCents -= b.amountCents;
    } else {
      netCents += b.amountCents;
    }
  }

  return { balances, netCents };
}

// ============================================================
// Per-contact balance summaries
// ============================================================

/**
 * For a given user, compute the net balance vs each counterparty within a single group.
 * Returns a Map<counterpartyId, netCents> where positive = counterparty owes you,
 * negative = you owe counterparty.
 */
export async function queryGroupBalancesForUser(
  groupId: string,
  userId: string,
): Promise<Map<string, number>> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("balances")
    .select("*")
    .eq("group_id", groupId)
    .neq("amount_cents", 0)
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);

  if (error) {
    throw new Error(`Failed to query user balances: ${error.message}`);
  }

  const result = new Map<string, number>();
  for (const row of (data as BalanceRow[]) ?? []) {
    const b = mapBalanceRow(row);
    if (b.userA === userId) {
      // positive amountCents = userA owes userB → I owe them → negative for me
      result.set(b.userB, (result.get(b.userB) ?? 0) - b.amountCents);
    } else {
      // userB === userId, positive amountCents = userA owes me → positive for me
      result.set(b.userA, (result.get(b.userA) ?? 0) + b.amountCents);
    }
  }
  return result;
}

/**
 * For a given user, compute the net balance vs each counterparty across ALL groups.
 * Returns a Map<counterpartyId, netCents> where positive = counterparty owes you,
 * negative = you owe counterparty.
 */
export async function queryAllBalancesForUser(
  userId: string,
): Promise<Map<string, number>> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("balances")
    .select("*")
    .neq("amount_cents", 0)
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);

  if (error) {
    throw new Error(`Failed to query all user balances: ${error.message}`);
  }

  const result = new Map<string, number>();
  for (const row of (data as BalanceRow[]) ?? []) {
    const b = mapBalanceRow(row);
    if (b.userA === userId) {
      result.set(b.userB, (result.get(b.userB) ?? 0) - b.amountCents);
    } else {
      result.set(b.userA, (result.get(b.userA) ?? 0) + b.amountCents);
    }
  }
  return result;
}

