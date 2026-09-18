import type { BalanceRow, ExpensePayload, ParticipantRef, Transfer } from "@/types/ledger";
import {
  type LedgerFact,
  projectBalances,
  projectPairwiseEdges,
} from "@/lib/ledger/model";
import type { WalkAction } from "@/lib/ledger/walk";

/**
 * Executes a planned journey against whatever ledger is in front of it: a
 * local Postgres in the integration suite, production in the ambient run.
 * Both go through the same RPCs a person's phone would call, and both are
 * checked against the same in-memory model, so a disagreement means the
 * database and the model really disagree rather than the two harnesses
 * having drifted apart.
 *
 * The run keeps its own map from plan keys to the ids the database handed
 * back, so it never needs a read to find the expense an edit refers to.
 */

export interface WalkRpcResult {
  data: unknown;
  error: { message: string } | null;
}

export interface WalkRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<WalkRpcResult>;
}

export interface WalkTarget {
  groupId: string;
  /** Bot or test user ids, indexed the way the plan indexes members. */
  memberIds: readonly string[];
  clientFor(member: number): Promise<WalkRpcClient> | WalkRpcClient;
  /** Stable uuid per plan key, so a retried write is recognised. */
  uuidFor(key: string): string;
  occurredOn: string;
}

interface ExpenseHandle {
  expenseId: string;
  versionNo: number;
  participants: number[];
  shares: number[];
  payers: { participantIndex: number; amountCents: number }[];
  totalCents: number;
  serviceFeeBps: number;
  title: string;
}

function payloadOf(
  memberIds: readonly string[],
  participants: readonly number[],
  shares: readonly number[],
  payers: readonly { participantIndex: number; amountCents: number }[],
): ExpensePayload {
  const refs: ParticipantRef[] = participants.map((member) => ({
    kind: "user",
    userId: memberIds[member],
  }));
  return {
    items: [],
    participants: refs,
    shares: [...shares],
    payers: payers.map((payer) => ({ ...payer })),
    itemAssignments: null,
  };
}

export class WalkRun {
  private readonly expenses = new Map<string, ExpenseHandle>();
  private readonly settlements = new Map<string, string>();

  constructor(private readonly target: WalkTarget) {}

  async apply(action: WalkAction): Promise<void> {
    const client = await this.target.clientFor(action.actor);
    switch (action.kind) {
      case "create":
        return this.create(client, action);
      case "edit":
        return this.edit(client, action);
      case "delete":
        return this.setExpenseStatus(client, action.targetKey, "delete_expense", action.key);
      case "restore":
        return this.setExpenseStatus(client, action.targetKey, "restore_expense", action.key);
      case "settle":
        return this.settle(client, action);
      case "void":
        return this.voidSettlement(client, action);
    }
  }

  private async create(
    client: WalkRpcClient,
    action: Extract<WalkAction, { kind: "create" }>,
  ): Promise<void> {
    const { plan } = action;
    const { data, error } = await client.rpc("create_expense", {
      p_client_id: this.target.uuidFor(action.key),
      p_group_id: this.target.groupId,
      p_occurred_on: this.target.occurredOn,
      p_title: plan.title,
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: plan.totalCents,
      p_service_fee_bps: plan.serviceFeeBps,
      p_fixed_fee_cents: 0,
      p_payload: payloadOf(this.target.memberIds, plan.participants, plan.shares, plan.payers),
    });
    if (error) {
      throw new Error(`journey ${action.key} create_expense failed: ${error.message}`);
    }
    const ack = data as { expenseId: string; versionNo: number };
    this.expenses.set(action.key, {
      expenseId: ack.expenseId,
      versionNo: ack.versionNo,
      participants: plan.participants,
      shares: plan.shares,
      payers: plan.payers,
      totalCents: plan.totalCents,
      serviceFeeBps: plan.serviceFeeBps,
      title: plan.title,
    });
  }

  private async edit(
    client: WalkRpcClient,
    action: Extract<WalkAction, { kind: "edit" }>,
  ): Promise<void> {
    const handle = this.expenseFor(action.targetKey, action.key);
    const { error } = await client.rpc("edit_expense", {
      p_expense_id: handle.expenseId,
      p_expected_version_no: handle.versionNo,
      p_occurred_on: this.target.occurredOn,
      p_title: action.title,
      p_merchant_name: "",
      p_expense_type: "single_amount",
      p_total_cents: handle.totalCents,
      p_service_fee_bps: handle.serviceFeeBps,
      p_fixed_fee_cents: 0,
      p_payload: payloadOf(
        this.target.memberIds,
        handle.participants,
        action.shares,
        handle.payers,
      ),
    });
    if (error) {
      throw new Error(`journey ${action.key} edit_expense failed: ${error.message}`);
    }
    handle.shares = action.shares;
    handle.versionNo += 1;
    handle.title = action.title;
  }

  private async setExpenseStatus(
    client: WalkRpcClient,
    targetKey: string,
    rpcName: "delete_expense" | "restore_expense",
    key: string,
  ): Promise<void> {
    const handle = this.expenseFor(targetKey, key);
    const { error } = await client.rpc(rpcName, { p_expense_id: handle.expenseId });
    if (error) {
      throw new Error(`journey ${key} ${rpcName} failed: ${error.message}`);
    }
  }

  private async settle(
    client: WalkRpcClient,
    action: Extract<WalkAction, { kind: "settle" }>,
  ): Promise<void> {
    const { data, error } = await client.rpc("record_settlement", {
      p_operation_id: this.target.uuidFor(action.key),
      p_group_id: this.target.groupId,
      p_from_user_id: this.target.memberIds[action.from],
      p_to_user_id: this.target.memberIds[action.to],
      p_amount_cents: action.amountCents,
      p_allow_overpay: action.allowOverpay,
    });
    if (error) {
      throw new Error(`journey ${action.key} record_settlement failed: ${error.message}`);
    }
    this.settlements.set(action.key, (data as { settlementId: string }).settlementId);
  }

  private async voidSettlement(
    client: WalkRpcClient,
    action: Extract<WalkAction, { kind: "void" }>,
  ): Promise<void> {
    const settlementId = this.settlements.get(action.targetKey);
    if (!settlementId) {
      throw new Error(`journey ${action.key} voids unknown settlement ${action.targetKey}`);
    }
    const { error } = await client.rpc("void_settlement", { p_settlement_id: settlementId });
    if (error) {
      throw new Error(`journey ${action.key} void_settlement failed: ${error.message}`);
    }
  }

  private expenseFor(targetKey: string, key: string): ExpenseHandle {
    const handle = this.expenses.get(targetKey);
    if (!handle) {
      throw new Error(`journey ${key} refers to unknown expense ${targetKey}`);
    }
    return handle;
  }
}

/**
 * Compares a group snapshot with the model. Returns null when they agree and
 * a message naming both sides when they do not.
 */
export function compareToModel(
  snapshot: { balances: BalanceRow[]; pairwiseEdges: Transfer[] },
  facts: readonly LedgerFact[],
): string | null {
  const expectedBalances = projectBalances(facts);
  if (JSON.stringify(snapshot.balances) !== JSON.stringify(expectedBalances)) {
    return (
      `balances expected ${JSON.stringify(expectedBalances)} ` +
      `got ${JSON.stringify(snapshot.balances)}`
    );
  }
  const expectedEdges = projectPairwiseEdges(facts);
  if (JSON.stringify(snapshot.pairwiseEdges) !== JSON.stringify(expectedEdges)) {
    return (
      `pairwise edges expected ${JSON.stringify(expectedEdges)} ` +
      `got ${JSON.stringify(snapshot.pairwiseEdges)}`
    );
  }
  return null;
}
