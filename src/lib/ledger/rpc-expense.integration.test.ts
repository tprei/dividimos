import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTestUsers,
  createGroupWithMembers,
  createExpense,
  equalSplitPayload,
  getBalances,
  expectRpcError,
  authenticateAs,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";

type ExpenseAck = {
  expenseId: string;
  groupId: string;
  versionNo: number;
  ledgerVersion: number;
  eventId: number | null;
};

type ChangeSummary = {
  title: [string, string] | null;
  totalCents: [number, number] | null;
  participantsAdded: string[];
  participantsRemoved: string[];
  payersChanged: boolean;
};

type ExpenseVersionJson = {
  versionNo: number;
  totalCents: number;
  changeSummary: ChangeSummary | null;
  payload: {
    participants: Array<{
      kind: string;
      userId?: string;
      guestId?: string | null;
      displayName?: string;
    }>;
    itemAssignments: Array<{
      itemIndex: number;
      participantIndex: number;
      amountCents: number;
    }> | null;
  };
};

type ExpenseDetail = {
  expense: {
    id: string;
    status: string;
    currentVersionNo: number;
    deletedAt: string | null;
    deletedBy: string | null;
  };
  current: ExpenseVersionJson;
  versions: ExpenseVersionJson[];
  participants: Array<{
    participantIndex: number;
    kind: string;
    shareCents: number;
    paidCents: number;
    guest: {
      id: string;
      displayName: string;
      claimedBy: string | null;
      claimLinkGeneration: number;
    } | null;
  }>;
};

type RpcResult = { data: unknown; error: { message: string } | null };

const OCCURRED_ON = "2026-09-01";

let alice: TestUser;
let bruno: TestUser;
let carla: TestUser;
let outsider: TestUser;
let aliceClient: SupabaseClient;
let brunoClient: SupabaseClient;
let carlaClient: SupabaseClient;
let outsiderClient: SupabaseClient;
// Shared fixture for the pure-validation tests: every payload-rule error is
// raised before any row is written, so the group is never mutated by them.
let validationGroupId: string;

async function callRpc(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = (await client.rpc(fn, args)) as RpcResult;
  return { data, error };
}

async function getExpense(expenseId: string): Promise<ExpenseDetail> {
  const { data, error } = await callRpc(aliceClient, "get_expense", {
    p_expense_id: expenseId,
  });
  expect(error).toBeNull();
  return data as ExpenseDetail;
}

function createArgs(
  groupId: string,
  totalCents: number,
  payload: unknown,
  overrides: Partial<{
    expenseType: "single_amount" | "itemized";
    feeBps: number;
    fixedFee: number;
    clientId: string;
    receiptAccessKey: string | null;
  }> = {},
): Record<string, unknown> {
  return {
    p_client_id: overrides.clientId ?? crypto.randomUUID(),
    p_group_id: groupId,
    p_occurred_on: OCCURRED_ON,
    p_title: "Despesa teste",
    p_merchant_name: null,
    p_expense_type: overrides.expenseType ?? "single_amount",
    p_total_cents: totalCents,
    p_service_fee_bps: overrides.feeBps ?? 0,
    p_fixed_fee_cents: overrides.fixedFee ?? 0,
    p_payload: payload,
    p_chave_acesso: overrides.receiptAccessKey ?? null,
  };
}

function editArgs(
  expenseId: string,
  expectedVersionNo: number,
  totalCents: number,
  payload: unknown,
): Record<string, unknown> {
  return {
    p_expense_id: expenseId,
    p_expected_version_no: expectedVersionNo,
    p_occurred_on: OCCURRED_ON,
    p_title: "Despesa teste",
    p_merchant_name: null,
    p_expense_type: "single_amount",
    p_total_cents: totalCents,
    p_service_fee_bps: 0,
    p_fixed_fee_cents: 0,
    p_payload: payload,
  };
}

describe.skipIf(!isIntegrationTestReady)("ledger expense RPCs", () => {
  beforeAll(async () => {
    [alice, bruno, carla, outsider] = await createTestUsers(4);
    aliceClient = authenticateAs(alice);
    brunoClient = authenticateAs(bruno);
    carlaClient = authenticateAs(carla);
    outsiderClient = authenticateAs(outsider);
    validationGroupId = await createGroupWithMembers(alice, [bruno, carla]);
  });

  it("create returns the exact mutation ack and equal-split balances around the payer", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const ack = (await createExpense(alice, {
      groupId,
      totalCents: 3000,
      payload: equalSplitPayload([alice.id, bruno.id], 3000),
    })) as unknown as ExpenseAck;

    expect(Object.keys(ack).sort()).toEqual([
      "eventId",
      "expenseId",
      "groupId",
      "ledgerVersion",
      "versionNo",
    ]);
    expect(ack.versionNo).toBe(1);
    expect(ack.eventId).not.toBeNull();

    const balances = await getBalances(groupId);
    expect(balances.find((row) => row.participant_id === alice.id)?.net_cents).toBe(1500);
    expect(balances.find((row) => row.participant_id === bruno.id)?.net_cents).toBe(-1500);
    expect(balances.reduce((sum, row) => sum + row.net_cents, 0)).toBe(0);
  });

  it("replaying the same p_client_id returns the same expense without a new version or event", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const clientId = crypto.randomUUID();
    const payload = equalSplitPayload([alice.id, bruno.id], 2000);
    const first = (await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload,
      clientId,
    })) as unknown as ExpenseAck;
    const replay = (await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload,
      clientId,
    })) as unknown as ExpenseAck;

    expect(replay.expenseId).toBe(first.expenseId);
    expect(replay.eventId).toBeNull();
    expect(replay.versionNo).toBe(1);
    expect(replay.ledgerVersion).toBe(first.ledgerVersion);

    const detail = await getExpense(first.expenseId);
    expect(detail.expense.currentVersionNo).toBe(1);
    expect(detail.versions).toHaveLength(1);
  });
  it("persists a valid receipt key and scopes duplicate detection to the creator", async () => {
    const aliceGroupId = await createGroupWithMembers(alice, [bruno]);
    const receiptKey = "12345678901234567890123456789012345678901234";
    const clientId = crypto.randomUUID();
    const aliceExpense = (await createExpense(alice, {
      groupId: aliceGroupId,
      totalCents: 2000,
      payload: equalSplitPayload([alice.id, bruno.id], 2000),
      clientId,
      receiptAccessKey: receiptKey,
    })) as unknown as ExpenseAck;

    const persisted = await withPg((client) =>
      client.query<{ chave_acesso: string | null }>(
        "select chave_acesso from public.expenses where id = $1",
        [aliceExpense.expenseId],
      ),
    );
    expect(persisted.rows[0]?.chave_acesso).toBe(receiptKey);
    const malformedReplay = await callRpc(
      aliceClient,
      "create_expense",
      createArgs(aliceGroupId, 2000, equalSplitPayload([alice.id, bruno.id], 2000), {
        clientId,
        receiptAccessKey: "123",
      }),
    );
    expect(malformedReplay.error).toBeNull();
    expect((malformedReplay.data as ExpenseAck).expenseId).toBe(aliceExpense.expenseId);


    const secondAliceGroupId = await createGroupWithMembers(alice, [bruno]);
    expect(
      await expectRpcError(
        callRpc(
          aliceClient,
          "create_expense",
          createArgs(secondAliceGroupId, 2000, equalSplitPayload([alice.id, bruno.id], 2000), {
            receiptAccessKey: receiptKey,
          }),
        ),
      ),
    ).toBe("duplicate_receipt");

    const brunoGroupId = await createGroupWithMembers(bruno, [carla]);
    const brunoExpense = await createExpense(bruno, {
      groupId: brunoGroupId,
      totalCents: 2000,
      payload: equalSplitPayload([bruno.id, carla.id], 2000),
      receiptAccessKey: receiptKey,
    });
    expect(brunoExpense.expenseId).not.toBe(aliceExpense.expenseId);
  });
  it("serializes the same receipt key across groups for one creator", async () => {
    const [groupA, groupB] = await Promise.all([
      createGroupWithMembers(alice, [bruno]),
      createGroupWithMembers(alice, [bruno]),
    ]);
    const receiptKey = "11223344556677889900112233445566778899001122";
    const payload = equalSplitPayload([alice.id, bruno.id], 2000);
    const clientIdA = crypto.randomUUID();
    const clientIdB = crypto.randomUUID();
    const results = await Promise.all([
      callRpc(
        aliceClient,
        "create_expense",
        createArgs(groupA, 2000, payload, { clientId: clientIdA, receiptAccessKey: receiptKey }),
      ),
      callRpc(
        aliceClient,
        "create_expense",
        createArgs(groupB, 2000, payload, { clientId: clientIdB, receiptAccessKey: receiptKey }),
      ),
    ]);

    const successful = results.filter((result) => result.error === null);
    const rejected = results.filter((result) => result.error !== null);
    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error?.message).toBe("duplicate_receipt");

    const activeRows = await withPg((client) =>
      client.query<{ count: number }>(
        "select count(*)::int as count from public.expenses " +
          "where creator_id = $1 and chave_acesso = $2 and status = 'active'",
        [alice.id, receiptKey],
      ),
    );
    expect(activeRows.rows[0]?.count).toBe(1);

    const winningResult = successful[0]?.data as ExpenseAck;
    const winningClientId = winningResult.groupId === groupA ? clientIdA : clientIdB;
    const replay = await callRpc(
      aliceClient,
      "create_expense",
      createArgs(winningResult.groupId, 2000, payload, {
        clientId: winningClientId,
        receiptAccessKey: receiptKey,
      }),
    );
    expect(replay.error).toBeNull();
    expect((replay.data as ExpenseAck).expenseId).toBe(winningResult.expenseId);
  });


  it("rejects malformed receipt keys and preserves member authorization before key validation", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const payload = equalSplitPayload([alice.id, bruno.id], 2000);

    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense", createArgs(groupId, 2000, payload, {
          receiptAccessKey: "123",
        })),
      ),
    ).toBe("invalid_argument");

    expect(
      await expectRpcError(
        callRpc(
          outsiderClient,
          "create_expense",
          createArgs(groupId, 2000, payload, {
            receiptAccessKey: "not-a-receipt-key",
          }),
        ),
      ),
    ).toBe("not_a_member");
  });

  it("allows an active key after deletion and rejects restoring the older duplicate", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const receiptKey = "98765432109876543210987654321098765432109876";
    const payload = equalSplitPayload([alice.id, bruno.id], 2000);
    const first = (await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload,
      receiptAccessKey: receiptKey,
    })) as unknown as ExpenseAck;

    expect(
      (await callRpc(aliceClient, "delete_expense", { p_expense_id: first.expenseId })).error,
    ).toBeNull();

    const second = (await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload,
      receiptAccessKey: receiptKey,
    })) as unknown as ExpenseAck;
    expect(second.expenseId).not.toBe(first.expenseId);

    expect(
      await expectRpcError(
        callRpc(aliceClient, "restore_expense", { p_expense_id: first.expenseId }),
      ),
    ).toBe("duplicate_receipt");

    expect(
      (await callRpc(aliceClient, "delete_expense", { p_expense_id: second.expenseId })).error,
    ).toBeNull();
    expect(
      (await callRpc(aliceClient, "restore_expense", { p_expense_id: first.expenseId })).error,
    ).toBeNull();
  });


  it("replaying a deleted p_client_id raises expense_deleted while an active one stays idempotent", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const clientId = crypto.randomUUID();
    const payload = equalSplitPayload([alice.id, bruno.id], 2000);
    const first = (await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload,
      clientId,
    })) as unknown as ExpenseAck;
    const replay = (await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload,
      clientId,
    })) as unknown as ExpenseAck;
    expect(replay.expenseId).toBe(first.expenseId);
    expect(replay.eventId).toBeNull();

    const { error: deleteError } = await callRpc(aliceClient, "delete_expense", {
      p_expense_id: first.expenseId,
    });
    expect(deleteError).toBeNull();

    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense", createArgs(groupId, 2000, payload, { clientId })),
      ),
    ).toBe("expense_deleted");

    const afterReplay = await getExpense(first.expenseId);
    expect(afterReplay.expense.status).toBe("deleted");
    expect(afterReplay.versions).toHaveLength(1);
  });

  it("create rejects a payload whose participants exclude the creator", async () => {
    const payload = {
      items: [],
      participants: [
        { kind: "user", userId: bruno.id },
        { kind: "user", userId: carla.id },
      ],
      shares: [1000, 1000],
      payers: [{ participantIndex: 0, amountCents: 2000 }],
      itemAssignments: null,
    };
    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense", createArgs(validationGroupId, 2000, payload)),
      ),
    ).toBe("creator_not_participant");
  });

  it("edit total recomputes balances and records [old, new] in changeSummary.totalCents", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([alice.id, bruno.id], 2000),
    });

    const { error } = await callRpc(
      aliceClient,
      "edit_expense",
      editArgs(created.expenseId, 1, 5000, equalSplitPayload([alice.id, bruno.id], 5000)),
    );
    expect(error).toBeNull();

    const balances = await getBalances(groupId);
    expect(balances.find((row) => row.participant_id === alice.id)?.net_cents).toBe(2500);
    expect(balances.find((row) => row.participant_id === bruno.id)?.net_cents).toBe(-2500);

    const detail = await getExpense(created.expenseId);
    expect(detail.current.changeSummary?.totalCents).toEqual([2000, 5000]);
    expect(detail.versions).toHaveLength(2);
    expect(detail.versions[0]?.versionNo).toBe(2);
  });

  it("edit swapping only the payer reports payersChanged without a total change", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([alice.id, bruno.id], 2000, 0),
    });

    const { error } = await callRpc(
      aliceClient,
      "edit_expense",
      editArgs(created.expenseId, 1, 2000, equalSplitPayload([alice.id, bruno.id], 2000, 1)),
    );
    expect(error).toBeNull();

    const balances = await getBalances(groupId);
    expect(balances.find((row) => row.participant_id === alice.id)?.net_cents).toBe(-1000);
    expect(balances.find((row) => row.participant_id === bruno.id)?.net_cents).toBe(1000);

    const detail = await getExpense(created.expenseId);
    expect(detail.current.changeSummary?.payersChanged).toBe(true);
    expect(detail.current.changeSummary?.totalCents).toBeNull();
  });

  it("edit adding a participant reports them in participantsAdded and balances", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno, carla]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([alice.id, bruno.id], 2000),
    });

    const { error } = await callRpc(
      aliceClient,
      "edit_expense",
      editArgs(
        created.expenseId,
        1,
        2000,
        equalSplitPayload([alice.id, bruno.id, carla.id], 2000),
      ),
    );
    expect(error).toBeNull();

    const detail = await getExpense(created.expenseId);
    expect(detail.current.changeSummary?.participantsAdded).toEqual([carla.id]);

    const balances = await getBalances(groupId);
    expect(balances.find((row) => row.participant_id === carla.id)?.net_cents).toBe(-666);
  });

  it("edit removing a participant reports participantsRemoved and drops their balance", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno, carla]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 3000,
      payload: equalSplitPayload([alice.id, bruno.id, carla.id], 3000),
    });

    const { error } = await callRpc(
      aliceClient,
      "edit_expense",
      editArgs(created.expenseId, 1, 3000, equalSplitPayload([alice.id, bruno.id], 3000)),
    );
    expect(error).toBeNull();

    const detail = await getExpense(created.expenseId);
    expect(detail.current.changeSummary?.participantsRemoved).toEqual([carla.id]);

    const balances = await getBalances(groupId);
    expect(balances.find((row) => row.participant_id === carla.id)).toBeUndefined();
    expect(balances.find((row) => row.participant_id === alice.id)?.net_cents).toBe(1500);
    expect(balances.find((row) => row.participant_id === bruno.id)?.net_cents).toBe(-1500);
  });

  it("edit rejects a stale p_expected_version_no", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([alice.id, bruno.id], 2000),
    });
    expect(
      await expectRpcError(
        callRpc(
          aliceClient,
          "edit_expense",
          editArgs(created.expenseId, 9, 2000, equalSplitPayload([alice.id, bruno.id], 2000)),
        ),
      ),
    ).toBe("stale_version");
  });

  it("editing a deleted expense fails with expense_deleted", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([alice.id, bruno.id], 2000),
    });
    const { error: deleteError } = await callRpc(aliceClient, "delete_expense", {
      p_expense_id: created.expenseId,
    });
    expect(deleteError).toBeNull();

    expect(
      await expectRpcError(
        callRpc(
          aliceClient,
          "edit_expense",
          editArgs(created.expenseId, 1, 3000, equalSplitPayload([alice.id, bruno.id], 3000)),
        ),
      ),
    ).toBe("expense_deleted");
  });

  it("delete empties balances and marks the expense deleted by the actor; restore reverses both", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([alice.id, bruno.id], 2000),
    });
    const balancesBefore = await getBalances(groupId);
    expect(balancesBefore).not.toHaveLength(0);

    const { error: deleteError } = await callRpc(aliceClient, "delete_expense", {
      p_expense_id: created.expenseId,
    });
    expect(deleteError).toBeNull();

    expect(await getBalances(groupId)).toHaveLength(0);
    const deleted = await getExpense(created.expenseId);
    expect(deleted.expense.status).toBe("deleted");
    expect(deleted.expense.deletedBy).toBe(alice.id);
    expect(deleted.expense.deletedAt).not.toBeNull();
    expect(deleted.participants).toHaveLength(0);

    const { error: restoreError } = await callRpc(aliceClient, "restore_expense", {
      p_expense_id: created.expenseId,
    });
    expect(restoreError).toBeNull();

    expect(await getBalances(groupId)).toEqual(balancesBefore);
    const restored = await getExpense(created.expenseId);
    expect(restored.expense.status).toBe("active");
    expect(restored.expense.deletedBy).toBeNull();
    expect(restored.expense.deletedAt).toBeNull();
  });

  it("a second delete and a second restore fail idempotently with exactly one event each", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([alice.id, bruno.id], 2000),
    });

    const { error: deleteError } = await callRpc(aliceClient, "delete_expense", {
      p_expense_id: created.expenseId,
    });
    expect(deleteError).toBeNull();
    expect(
      await expectRpcError(
        callRpc(aliceClient, "delete_expense", { p_expense_id: created.expenseId }),
      ),
    ).toBe("expense_deleted");

    const { error: restoreError } = await callRpc(aliceClient, "restore_expense", {
      p_expense_id: created.expenseId,
    });
    expect(restoreError).toBeNull();
    expect(
      await expectRpcError(
        callRpc(aliceClient, "restore_expense", { p_expense_id: created.expenseId }),
      ),
    ).toBe("expense_not_deleted");

    const { rows } = await withPg((client) =>
      client.query<{ kind: string; count: number }>(
        "select kind, count(*)::int as count from public.group_events " +
          "where group_id = $1 and expense_id = $2 " +
          "and kind in ('expense_deleted','expense_restored') group by kind",
        [groupId, created.expenseId],
      ),
    );
    expect(rows.sort((x, y) => x.kind.localeCompare(y.kind))).toEqual([
      { kind: "expense_deleted", count: 1 },
      { kind: "expense_restored", count: 1 },
    ]);
  });

  it("a non-member cannot create, edit, delete or read a group expense", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([alice.id, bruno.id], 2000),
    });
    const payload = equalSplitPayload([alice.id, bruno.id], 2000);

    expect(
      await expectRpcError(
        callRpc(outsiderClient, "create_expense", createArgs(groupId, 2000, payload)),
      ),
    ).toBe("not_a_member");
    expect(
      await expectRpcError(
        callRpc(outsiderClient, "edit_expense", editArgs(created.expenseId, 1, 2000, payload)),
      ),
    ).toBe("not_a_member");
    expect(
      await expectRpcError(
        callRpc(outsiderClient, "delete_expense", { p_expense_id: created.expenseId }),
      ),
    ).toBe("not_a_member");
    expect(
      await expectRpcError(
        callRpc(outsiderClient, "get_expense", { p_expense_id: created.expenseId }),
      ),
    ).toBe("not_a_member");
  });

  it("a member who is neither author nor participant is refused with not_expense_party on edit, delete and restore", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno, carla]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([alice.id, bruno.id], 2000),
    });
    const payload = equalSplitPayload([alice.id, bruno.id], 2000);

    expect(
      await expectRpcError(
        callRpc(carlaClient, "edit_expense", editArgs(created.expenseId, 1, 2000, payload)),
      ),
    ).toBe("not_expense_party");
    expect(
      await expectRpcError(
        callRpc(carlaClient, "delete_expense", { p_expense_id: created.expenseId }),
      ),
    ).toBe("not_expense_party");

    const untouched = await getExpense(created.expenseId);
    expect(untouched.expense.status).toBe("active");
    expect(untouched.expense.currentVersionNo).toBe(1);
    expect(untouched.versions).toHaveLength(1);

    const { error: deleteError } = await callRpc(aliceClient, "delete_expense", {
      p_expense_id: created.expenseId,
    });
    expect(deleteError).toBeNull();

    expect(
      await expectRpcError(
        callRpc(carlaClient, "restore_expense", { p_expense_id: created.expenseId }),
      ),
    ).toBe("not_expense_party");

    const { error: restoreError } = await callRpc(aliceClient, "restore_expense", {
      p_expense_id: created.expenseId,
    });
    expect(restoreError).toBeNull();
    expect((await getExpense(created.expenseId)).expense.status).toBe("active");
  });

  it("a historical participant who is not the creator may restore a deleted expense; an unrelated member may not", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno, carla]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([alice.id, bruno.id], 2000),
    });

    const { error: brunoEdit } = await callRpc(
      brunoClient,
      "edit_expense",
      editArgs(created.expenseId, 1, 3000, equalSplitPayload([alice.id, bruno.id], 3000)),
    );
    expect(brunoEdit).toBeNull();

    const { error: brunoDelete } = await callRpc(brunoClient, "delete_expense", {
      p_expense_id: created.expenseId,
    });
    expect(brunoDelete).toBeNull();

    const { error: brunoRestore } = await callRpc(brunoClient, "restore_expense", {
      p_expense_id: created.expenseId,
    });
    expect(brunoRestore).toBeNull();

    const restored = await getExpense(created.expenseId);
    expect(restored.expense.status).toBe("active");
    expect(restored.expense.currentVersionNo).toBe(2);
    expect(restored.versions).toHaveLength(2);
    const balances = await getBalances(groupId);
    expect(balances.find((row) => row.participant_id === alice.id)?.net_cents).toBe(1500);
    expect(balances.find((row) => row.participant_id === bruno.id)?.net_cents).toBe(-1500);

    const { error: secondDelete } = await callRpc(brunoClient, "delete_expense", {
      p_expense_id: created.expenseId,
    });
    expect(secondDelete).toBeNull();

    expect(
      await expectRpcError(
        callRpc(carlaClient, "restore_expense", { p_expense_id: created.expenseId }),
      ),
    ).toBe("not_expense_party");

    const { error: creatorRestore } = await callRpc(aliceClient, "restore_expense", {
      p_expense_id: created.expenseId,
    });
    expect(creatorRestore).toBeNull();
    expect((await getExpense(created.expenseId)).expense.status).toBe("active");
  });

  it("shares that do not sum to the total fail with share_total_mismatch", async () => {
    const payload = {
      items: [],
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "user", userId: bruno.id },
      ],
      shares: [1000, 1001],
      payers: [{ participantIndex: 0, amountCents: 2000 }],
      itemAssignments: null,
    };
    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense", createArgs(validationGroupId, 2000, payload)),
      ),
    ).toBe("share_total_mismatch");
  });

  it("payers that do not sum to the total fail with payer_total_mismatch", async () => {
    const payload = {
      items: [],
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "user", userId: bruno.id },
      ],
      shares: [1000, 1000],
      payers: [{ participantIndex: 0, amountCents: 1999 }],
      itemAssignments: null,
    };
    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense", createArgs(validationGroupId, 2000, payload)),
      ),
    ).toBe("payer_total_mismatch");
  });

  it("an itemized expense whose items + fee + fixed fee miss the total fails with itemized_total_mismatch", async () => {
    const subtotal = 10000;
    const feeBps = 1000;
    // Contract: fee = floor((subtotal * bps + 5000) / 10000).
    const fee = Math.floor((subtotal * feeBps + 5000) / 10000);
    const consistentTotal = subtotal + fee;
    const payload = {
      items: [
        {
          description: "Pão de queijo",
          quantityMilliunits: 1000,
          unitPriceCents: subtotal,
          totalPriceCents: subtotal,
        },
      ],
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "user", userId: bruno.id },
      ],
      shares: [5500, 5501],
      payers: [{ participantIndex: 0, amountCents: consistentTotal + 1 }],
      itemAssignments: [{ itemIndex: 0, participantIndex: 0, amountCents: subtotal }],
    };
    expect(
      await expectRpcError(
        callRpc(
          aliceClient,
          "create_expense",
          createArgs(validationGroupId, consistentTotal + 1, payload, {
            expenseType: "itemized",
            feeBps,
          }),
        ),
      ),
    ).toBe("itemized_total_mismatch");
  });

  it("a payer pointing at a guest fails with guest_cannot_pay", async () => {
    const payload = {
      items: [],
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "user", userId: bruno.id },
        { kind: "guest", guestId: null, displayName: "Zé" },
      ],
      shares: [1000, 1000, 1000],
      payers: [{ participantIndex: 2, amountCents: 3000 }],
      itemAssignments: null,
    };
    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense", createArgs(validationGroupId, 3000, payload)),
      ),
    ).toBe("guest_cannot_pay");
  });

  it("a repeated participant fails with duplicate_participant", async () => {
    const payload = {
      items: [],
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "user", userId: bruno.id },
        { kind: "user", userId: bruno.id },
      ],
      shares: [1000, 500, 500],
      payers: [{ participantIndex: 0, amountCents: 2000 }],
      itemAssignments: null,
    };
    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense", createArgs(validationGroupId, 2000, payload)),
      ),
    ).toBe("duplicate_participant");
  });

  it("accepts an itemized expense whose assignments reconcile per item and persists them", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    // subtotal 5000, fee 10% = 500, total 5500; assignments cover both items.
    // Fee follows item share: alice 3000 -> +300, bruno 2000 -> +200, so
    // shares must reconcile as items + allocated fee: [3300, 2200].
    const payload = {
      items: [
        {
          description: "Pão de queijo",
          quantityMilliunits: 1000,
          unitPriceCents: 3000,
          totalPriceCents: 3000,
        },
        {
          description: "Café",
          quantityMilliunits: 2000,
          unitPriceCents: 1000,
          totalPriceCents: 2000,
        },
      ],
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "user", userId: bruno.id },
      ],
      shares: [3300, 2200],
      payers: [{ participantIndex: 0, amountCents: 5500 }],
      itemAssignments: [
        { itemIndex: 0, participantIndex: 0, amountCents: 3000 },
        { itemIndex: 1, participantIndex: 1, amountCents: 2000 },
      ],
    };
    const ack = (await createExpense(alice, {
      groupId,
      totalCents: 5500,
      expenseType: "itemized",
      serviceFeeBps: 1000,
      payload,
    })) as unknown as ExpenseAck;
    expect(ack.versionNo).toBe(1);

    const balances = await getBalances(groupId);
    expect(balances.find((row) => row.participant_id === alice.id)?.net_cents).toBe(2200);
    expect(balances.find((row) => row.participant_id === bruno.id)?.net_cents).toBe(-2200);

    const detail = await getExpense(ack.expenseId);
    expect(detail.current.payload.itemAssignments).toEqual([
      { itemIndex: 0, participantIndex: 0, amountCents: 3000 },
      { itemIndex: 1, participantIndex: 1, amountCents: 2000 },
    ]);
  });

  it("more than 50 participants fails with too_many_participants", async () => {
    // Membership is validated after payload validation, so synthetic uuids
    // still reach (and trip) the participant-count rule.
    const fakeIds = Array.from({ length: 51 }, () => crypto.randomUUID());
    const payload = {
      items: [],
      participants: fakeIds.map((userId) => ({ kind: "user", userId })),
      shares: fakeIds.map(() => 0),
      payers: [],
      itemAssignments: null,
    };
    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense", createArgs(validationGroupId, 1000, payload)),
      ),
    ).toBe("too_many_participants");
  });

  it("a payload missing the shares key fails with invalid_payload", async () => {
    const payload = {
      items: [],
      participants: [{ kind: "user", userId: alice.id }],
      payers: [{ participantIndex: 0, amountCents: 1000 }],
      itemAssignments: null,
    };
    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense", createArgs(validationGroupId, 1000, payload)),
      ),
    ).toBe("invalid_payload");
  });

  it("more than 5000 itemAssignments fails with invalid_payload", async () => {
    const payload = {
      items: [
        {
          description: "Item único",
          quantityMilliunits: 1000,
          unitPriceCents: 1,
          totalPriceCents: 1,
        },
      ],
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "user", userId: bruno.id },
      ],
      shares: [1, 0],
      payers: [{ participantIndex: 0, amountCents: 1 }],
      itemAssignments: Array.from({ length: 5001 }, () => ({
        itemIndex: 0,
        participantIndex: 0,
        amountCents: 0,
      })),
    };
    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense", createArgs(validationGroupId, 1, payload, {
          expenseType: "itemized",
        })),
      ),
    ).toBe("invalid_payload");
  });

  it("duplicate (itemIndex, participantIndex) assignments fail with invalid_payload", async () => {
    const payload = {
      items: [
        {
          description: "Jantar",
          quantityMilliunits: 1000,
          unitPriceCents: 2000,
          totalPriceCents: 2000,
        },
      ],
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "user", userId: bruno.id },
      ],
      shares: [2000, 0],
      payers: [{ participantIndex: 0, amountCents: 2000 }],
      itemAssignments: [
        { itemIndex: 0, participantIndex: 0, amountCents: 1200 },
        { itemIndex: 0, participantIndex: 0, amountCents: 800 },
      ],
    };
    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense", createArgs(validationGroupId, 2000, payload, {
          expenseType: "itemized",
        })),
      ),
    ).toBe("invalid_payload");
  });

  it("an item with no assignments fails with invalid_payload", async () => {
    const payload = {
      items: [
        {
          description: "Pão",
          quantityMilliunits: 1000,
          unitPriceCents: 1000,
          totalPriceCents: 1000,
        },
        {
          description: "Café",
          quantityMilliunits: 2000,
          unitPriceCents: 1000,
          totalPriceCents: 2000,
        },
      ],
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "user", userId: bruno.id },
      ],
      shares: [3000, 0],
      payers: [{ participantIndex: 0, amountCents: 3000 }],
      itemAssignments: [{ itemIndex: 0, participantIndex: 0, amountCents: 1000 }],
    };
    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense", createArgs(validationGroupId, 3000, payload, {
          expenseType: "itemized",
        })),
      ),
    ).toBe("invalid_payload");
  });

  it("an unclaimed guest is materialized with a filled guestId and shows up as a guest balance", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const payload = {
      items: [],
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "guest", guestId: null, displayName: "Zé" },
      ],
      shares: [1500, 1500],
      payers: [{ participantIndex: 0, amountCents: 3000 }],
      itemAssignments: null,
    };
    const ack = (await createExpense(alice, {
      groupId,
      totalCents: 3000,
      payload,
    })) as unknown as ExpenseAck;

    const balances = await getBalances(groupId);
    const guestRow = balances.find(
      (row) => row.kind === "guest" && row.participant_id !== alice.id,
    );
    expect(guestRow).toBeDefined();
    expect(guestRow?.net_cents).toBe(-1500);
    expect(balances.find((row) => row.participant_id === alice.id)?.net_cents).toBe(1500);

    const detail = await getExpense(ack.expenseId);
    const guestParticipant = detail.participants[1];
    expect(guestParticipant?.kind).toBe("guest");
    expect(guestParticipant?.guest?.displayName).toBe("Zé");
    expect(guestParticipant?.guest?.claimedBy).toBeNull();
    expect(guestParticipant?.guest?.claimLinkGeneration).toBe(0);
    expect(typeof detail.current.payload.participants[1]?.guestId).toBe("string");
  });
});
