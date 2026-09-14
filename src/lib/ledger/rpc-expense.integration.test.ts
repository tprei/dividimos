import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTestUsers,
  createGroup,
  acceptInvitation,
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
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

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
  occurredOn: string;
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
    splitMethod?: string | null;
  };
};

type ExpenseDetail = {
  expense: {
    id: string;
    status: string;
    currentVersionNo: number;
    occurredOn: string;
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

  it("edit ONLY the date preserves version 1 old date and records new date on version 2", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const oldDate = "2026-08-01";
    const newDate = "2026-08-15";
    const payload = equalSplitPayload([alice.id, bruno.id], 2000);

    const created = await createExpense(alice, {
      groupId,
      totalCents: 2000,
      occurredOn: oldDate,
      payload,
    });

    const { error } = await callRpc(aliceClient, "edit_expense", {
      p_expense_id: created.expenseId,
      p_expected_version_no: 1,
      p_occurred_on: newDate,
      p_title: "Despesa teste",
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: 2000,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_payload: payload,
    });
    expect(error).toBeNull();

    // Verify through get_expense history and current version
    const detail = await getExpense(created.expenseId);
    expect(detail.expense.occurredOn).toBe(newDate);
    expect(detail.current.versionNo).toBe(2);
    expect(detail.current.occurredOn).toBe(newDate);
    expect(detail.versions).toHaveLength(2);

    const v2 = detail.versions.find((v) => v.versionNo === 2);
    const v1 = detail.versions.find((v) => v.versionNo === 1);
    expect(v2?.occurredOn).toBe(newDate);
    expect(v1?.occurredOn).toBe(oldDate);

    // Verify through get_group_expenses summary header joining current
    const { data: pageData, error: pageErr } = await callRpc(aliceClient, "get_group_expenses", {
      p_group_id: groupId,
      p_limit: 10,
    });
    expect(pageErr).toBeNull();
    const pageObj = pageData as {
      expenses: Array<{ id: string; occurredOn: string; versionNo: number }>;
    };
    const summary = pageObj.expenses.find((e) => e.id === created.expenseId);
    expect(summary?.versionNo).toBe(2);
    expect(summary?.occurredOn).toBe(newDate);
  });

  it("deferred foreign keys: create, edit version bump, and claim tuple deletion maintain consistency", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const guestName = "Convidado FK Test";
    const payloadWithGuest = {
      items: [],
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "guest", displayName: guestName },
      ],
      shares: [1000, 1000],
      payers: [{ participantIndex: 0, amountCents: 2000 }],
      itemAssignments: null,
    };

    // 1. Create flow works with deferred FK (expenses row inserted before expense_versions in same tx)
    const created = await createExpense(alice, {
      groupId,
      totalCents: 2000,
      occurredOn: "2026-08-01",
      payload: payloadWithGuest,
    });
    expect(created.expenseId).toBeDefined();

    // Find the guest id
    const detailBefore = await getExpense(created.expenseId);
    const guestPart = detailBefore.participants.find((p) => p.kind === "guest");
    expect(guestPart?.guest?.id).toBeDefined();
    const guestId = guestPart!.guest!.id;

    // Issue claim token and claim the guest
    const { data: tokenData } = await callRpc(
      aliceClient,
      "create_guest_claim_token",
      { p_guest_id: guestId },
    );
    const tokenObj = tokenData as { token: string };
    expect(tokenObj?.token).toBeDefined();

    const { error: claimErr } = await callRpc(brunoClient, "claim_guest", {
      p_token: tokenObj.token,
    });
    expect(claimErr).toBeNull();

    // 2. Editing bumps versions without violation
    const { error: editErr } = await callRpc(aliceClient, "edit_expense", {
      p_expense_id: created.expenseId,
      p_expected_version_no: 1,
      p_occurred_on: "2026-08-02",
      p_title: "Despesa FK v2",
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: 3000,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_payload: equalSplitPayload([alice.id, bruno.id], 3000),
    });
    expect(editErr).toBeNull();

    const detailAfter = await getExpense(created.expenseId);
    expect(detailAfter.expense.currentVersionNo).toBe(2);

    // 3. Deleting a version-cited claim tuple is consistent
    await withPg(async (pg) => {
      const res = await pg.query("DELETE FROM public.guests WHERE id = $1", [guestId]);
      expect(res.rowCount).toBe(1);
    });
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

  it("rejects a JSON quantity with a fractional representation", async () => {
    const payload = `{"items":[{"description":"Item","quantityMilliunits":1000.0,"unitPriceCents":100,"totalPriceCents":100}],"participants":[{"kind":"user","userId":"${alice.id}"}],"shares":[100],"payers":[{"participantIndex":0,"amountCents":100}],"itemAssignments":null}`;
    const error = await withPg(async (client) => {
      try {
        await client.query(
          "select public.validate_expense_payload($1::jsonb, 'itemized'::public.expense_type, 100, 0, 0)",
          [payload],
        );
        return null;
      } catch (caught: unknown) {
        return caught instanceof Error ? caught : new Error(String(caught));
      }
    });
    expect(error?.message).toBe("invalid_payload");
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

describe("authored split method", () => {
  it("round-trips the method the author chose", async () => {
    if (!isIntegrationTestReady) return;
    const groupId = await createGroupWithMembers(alice, [bruno], "Método");
    const payload = equalSplitPayload([alice.id, bruno.id], 10000) as Record<string, unknown>;

    const ack = await createExpense(alice, {
      groupId,
      totalCents: 10000,
      occurredOn: OCCURRED_ON,
      payload: { ...payload, splitMethod: "percentage" },
    });

    const detail = (await authenticateAs(alice).rpc("get_expense", {
      p_expense_id: ack.expenseId,
    })) as { data: ExpenseDetail | null };
    expect(detail.data?.current.payload.splitMethod).toBe("percentage");
  });

  it("accepts a payload written before the method existed", async () => {
    if (!isIntegrationTestReady) return;
    const groupId = await createGroupWithMembers(alice, [bruno], "Sem método");

    const ack = await createExpense(alice, {
      groupId,
      totalCents: 8000,
      occurredOn: OCCURRED_ON,
      payload: equalSplitPayload([alice.id, bruno.id], 8000),
    });

    const detail = (await authenticateAs(alice).rpc("get_expense", {
      p_expense_id: ack.expenseId,
    })) as { data: ExpenseDetail | null };
    expect(detail.data?.current.payload.splitMethod ?? null).toBeNull();
  });

  it("rejects a method the division controls cannot produce", async () => {
    if (!isIntegrationTestReady) return;
    const payload = {
      ...(equalSplitPayload([alice.id], 1000) as Record<string, unknown>),
      splitMethod: "weighted",
    };
    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense", createArgs(validationGroupId, 1000, payload)),
      ),
    ).toBe("invalid_payload");
  });
});

describe("create_expense_with_group", () => {
  function args(clientId: string, payload: unknown, overrides: Record<string, unknown> = {}) {
    return {
      p_client_id: clientId,
      p_group_name: "Viagem",
      p_member_ids: [bruno.id],
      p_occurred_on: OCCURRED_ON,
      p_title: "Jantar",
      p_merchant_name: "Cantina",
      p_expense_type: "single_amount",
      p_total_cents: 10000,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_payload: payload,
      p_chave_acesso: null,
      ...overrides,
    };
  }

  it("creates the group and its first expense together", async () => {
    if (!isIntegrationTestReady) return;
    const clientId = crypto.randomUUID();
    const payload = equalSplitPayload([alice.id, bruno.id], 10000);

    const { data, error } = await callRpc(
      aliceClient,
      "create_expense_with_group",
      args(clientId, payload),
    );
    expect(error).toBeNull();
    const ack = data as ExpenseAck;

    expect(ack.groupId).toBeTruthy();
    expect(ack.expenseId).toBeTruthy();

    const row = await withPg((pg) =>
      pg.query("select group_id, status from expenses where id = $1", [ack.expenseId]),
    );
    expect(row.rows[0].group_id).toBe(ack.groupId);
    expect(row.rows[0].status).toBe("active");
  });

  it("leaves no group behind when the expense is invalid", async () => {
    if (!isIntegrationTestReady) return;
    const before = await withPg((pg) =>
      pg.query("select count(*)::int as n from groups where creator_id = $1", [alice.id]),
    );

    // Shares that do not add up to the total: create_expense rejects this.
    const badPayload = {
      items: [],
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "user", userId: bruno.id },
      ],
      shares: [4000, 4000],
      payers: [{ participantIndex: 0, amountCents: 10000 }],
      itemAssignments: null,
    };

    expect(
      await expectRpcError(
        callRpc(aliceClient, "create_expense_with_group", args(crypto.randomUUID(), badPayload)),
      ),
    ).toBe("share_total_mismatch");

    const after = await withPg((pg) =>
      pg.query("select count(*)::int as n from groups where creator_id = $1", [alice.id]),
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("returns the original pair when the same client id is replayed", async () => {
    if (!isIntegrationTestReady) return;
    const clientId = crypto.randomUUID();
    const payload = equalSplitPayload([alice.id, bruno.id], 10000);

    const first = (
      await callRpc(aliceClient, "create_expense_with_group", args(clientId, payload))
    ).data as ExpenseAck;
    const replay = (
      await callRpc(aliceClient, "create_expense_with_group", args(clientId, payload))
    ).data as ExpenseAck;

    expect(replay.expenseId).toBe(first.expenseId);
    expect(replay.groupId).toBe(first.groupId);

    const groups = await withPg((pg) =>
      pg.query("select count(*)::int as n from groups where id = $1", [first.groupId]),
    );
    expect(groups.rows[0].n).toBe(1);
  });

  it("refuses to replay another member's expense", async () => {
    if (!isIntegrationTestReady) return;
    const clientId = crypto.randomUUID();
    const payload = equalSplitPayload([alice.id, bruno.id], 10000);
    await callRpc(aliceClient, "create_expense_with_group", args(clientId, payload));

    // The outsider holds the same client id but no membership.
    expect(
      await expectRpcError(
        callRpc(
          authenticateAs(outsider),
          "create_expense_with_group",
          args(clientId, equalSplitPayload([outsider.id], 10000), {
            p_member_ids: [],
            p_payload: equalSplitPayload([outsider.id], 10000),
          }),
        ),
      ),
    ).toBe("not_a_member");
  });
});

describe("P7 decline metadata and restoration denial", () => {
  it("single decline then restore fails with invitation_not_accepted and facts unchanged", async () => {
    if (!isIntegrationTestReady) return;
    const [owner, invitee] = await createTestUsers(2);
    const ownerClient = authenticateAs(owner);
    const inviteeClient = authenticateAs(invitee);

    const { groupId } = await createGroup(owner, "P7 Single", [invitee.id]);
    const { expenseId } = await createExpense(owner, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([owner.id, invitee.id], 2000),
    });

    const { error: declineError } = await inviteeClient.rpc("decline_invitation", {
      p_group_id: groupId,
    });
    expect(declineError).toBeNull();

    // Verify soft-deleted with decliner recorded
    const beforeRestore = await withPg(async (pg) => {
      const { rows } = await pg.query<{
        status: string;
        deleted_by: string;
        declined_user_ids: string[];
      }>("SELECT status, deleted_by, declined_user_ids FROM public.expenses WHERE id = $1", [
        expenseId,
      ]);
      return rows[0];
    });
    expect(beforeRestore.status).toBe("deleted");
    expect(beforeRestore.deleted_by).toBe(invitee.id);
    expect(beforeRestore.declined_user_ids).toEqual([invitee.id]);

    const eventsBefore = await withPg(async (pg) => {
      const { rows } = await pg.query<{ count: number }>(
        "SELECT count(*)::int as count FROM public.group_events WHERE expense_id = $1",
        [expenseId],
      );
      return rows[0].count;
    });

    // Owner attempts to restore
    const err = await expectRpcError(
      callRpc(ownerClient, "restore_expense", { p_expense_id: expenseId }),
    );
    expect(err).toBe("invitation_not_accepted");

    // Facts unchanged: status still deleted, declined_user_ids still [invitee.id], no new event, balances empty
    const afterRestore = await withPg(async (pg) => {
      const { rows } = await pg.query<{
        status: string;
        deleted_by: string;
        declined_user_ids: string[];
      }>("SELECT status, deleted_by, declined_user_ids FROM public.expenses WHERE id = $1", [
        expenseId,
      ]);
      return rows[0];
    });
    expect(afterRestore.status).toBe("deleted");
    expect(afterRestore.declined_user_ids).toEqual([invitee.id]);

    const eventsAfter = await withPg(async (pg) => {
      const { rows } = await pg.query<{ count: number }>(
        "SELECT count(*)::int as count FROM public.group_events WHERE expense_id = $1",
        [expenseId],
      );
      return rows[0].count;
    });
    expect(eventsAfter).toBe(eventsBefore);

    const balances = await getBalances(groupId);
    expect(balances).toHaveLength(0);
  });

  it("two decliners: partial reacceptance still denied; full reacceptance restores and clears the list", async () => {
    if (!isIntegrationTestReady) return;
    const [owner, invitee1, invitee2] = await createTestUsers(3);
    const ownerClient = authenticateAs(owner);
    const c1 = authenticateAs(invitee1);
    const c2 = authenticateAs(invitee2);

    const { groupId } = await createGroup(owner, "P7 Dual", [invitee1.id, invitee2.id]);
    const { expenseId } = await createExpense(owner, {
      groupId,
      totalCents: 3000,
      payload: equalSplitPayload([owner.id, invitee1.id, invitee2.id], 3000),
    });

    // First user declines
    const { error: d1Err } = await c1.rpc("decline_invitation", { p_group_id: groupId });
    expect(d1Err).toBeNull();

    // Second user declines an already-deleted expense
    const { error: d2Err } = await c2.rpc("decline_invitation", { p_group_id: groupId });
    expect(d2Err).toBeNull();

    // Verify both decliners are recorded in order
    const rowAfterDeclines = await withPg(async (pg) => {
      const { rows } = await pg.query<{ declined_user_ids: string[] }>(
        "SELECT declined_user_ids FROM public.expenses WHERE id = $1",
        [expenseId],
      );
      return rows[0];
    });
    expect(rowAfterDeclines.declined_user_ids).toEqual([invitee1.id, invitee2.id]);

    // Re-invite first user and have them accept
    const { error: inv1Err } = await ownerClient.rpc("invite_member", {
      p_group_id: groupId,
      p_user_id: invitee1.id,
    });
    expect(inv1Err).toBeNull();
    await acceptInvitation(invitee1, groupId);

    // Restore still denied with partial reacceptance
    const partialErr = await expectRpcError(
      callRpc(ownerClient, "restore_expense", { p_expense_id: expenseId }),
    );
    expect(partialErr).toBe("invitation_not_accepted");

    // Re-invite second user, leaving status as 'invited' (not accepted)
    const { error: inv2Err } = await ownerClient.rpc("invite_member", {
      p_group_id: groupId,
      p_user_id: invitee2.id,
    });
    expect(inv2Err).toBeNull();

    // Still denied because second user has not accepted
    const stillInvitedErr = await expectRpcError(
      callRpc(ownerClient, "restore_expense", { p_expense_id: expenseId }),
    );
    expect(stillInvitedErr).toBe("invitation_not_accepted");

    // Second user accepts
    await acceptInvitation(invitee2, groupId);

    // Full reacceptance: restore succeeds!
    const { error: restoreErr } = await callRpc(ownerClient, "restore_expense", {
      p_expense_id: expenseId,
    });
    expect(restoreErr).toBeNull();

    // Verify expense is active and declined_user_ids is cleared
    const rowAfterRestore = await withPg(async (pg) => {
      const { rows } = await pg.query<{ status: string; declined_user_ids: string[] }>(
        "SELECT status, declined_user_ids FROM public.expenses WHERE id = $1",
        [expenseId],
      );
      return rows[0];
    });
    expect(rowAfterRestore.status).toBe("active");
    expect(rowAfterRestore.declined_user_ids).toEqual([]);

    const balances = await getBalances(groupId);
    expect(balances.find((b) => b.participant_id === owner.id)?.net_cents).toBe(2000);
    expect(balances.find((b) => b.participant_id === invitee1.id)?.net_cents).toBe(-1000);
    expect(balances.find((b) => b.participant_id === invitee2.id)?.net_cents).toBe(-1000);
  });

  it("manual delete then decline respects the refusal on restore", async () => {
    if (!isIntegrationTestReady) return;
    const [owner, invitee] = await createTestUsers(2);
    const ownerClient = authenticateAs(owner);
    const inviteeClient = authenticateAs(invitee);

    const { groupId } = await createGroup(owner, "P7 Manual Then Decline", [invitee.id]);
    const { expenseId } = await createExpense(owner, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([owner.id, invitee.id], 2000),
    });

    // Owner manually deletes the expense
    const { error: delErr } = await callRpc(ownerClient, "delete_expense", {
      p_expense_id: expenseId,
    });
    expect(delErr).toBeNull();

    const manualDeletedRow = await withPg(async (pg) => {
      const { rows } = await pg.query<{
        status: string;
        deleted_by: string;
        declined_user_ids: string[];
      }>("SELECT status, deleted_by, declined_user_ids FROM public.expenses WHERE id = $1", [
        expenseId,
      ]);
      return rows[0];
    });
    expect(manualDeletedRow.status).toBe("deleted");
    expect(manualDeletedRow.deleted_by).toBe(owner.id);
    expect(manualDeletedRow.declined_user_ids).toEqual([]);

    // Invitee declines the invitation
    const { error: decErr } = await inviteeClient.rpc("decline_invitation", {
      p_group_id: groupId,
    });
    expect(decErr).toBeNull();

    // Verify decliner was appended, but original deleted_by was preserved
    const afterDeclineRow = await withPg(async (pg) => {
      const { rows } = await pg.query<{
        status: string;
        deleted_by: string;
        declined_user_ids: string[];
      }>("SELECT status, deleted_by, declined_user_ids FROM public.expenses WHERE id = $1", [
        expenseId,
      ]);
      return rows[0];
    });
    expect(afterDeclineRow.status).toBe("deleted");
    expect(afterDeclineRow.deleted_by).toBe(owner.id);
    expect(afterDeclineRow.declined_user_ids).toEqual([invitee.id]);

    // Restore is rejected
    const err = await expectRpcError(
      callRpc(ownerClient, "restore_expense", { p_expense_id: expenseId }),
    );
    expect(err).toBe("invitation_not_accepted");
  });

  it("ordinary settled-departure restoration preserves historical participant restoration", async () => {
    if (!isIntegrationTestReady) return;
    const [owner, member] = await createTestUsers(2);
    const ownerClient = authenticateAs(owner);
    const memberClient = authenticateAs(member);

    const { groupId } = await createGroup(owner, "P7 Settled Departure", [member.id]);
    await acceptInvitation(member, groupId);

    const { expenseId } = await createExpense(owner, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([owner.id, member.id], 2000),
    });

    // Member settles debt
    const { error: setErr } = await memberClient.rpc("record_settlement", {
      p_operation_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_from_user_id: member.id,
      p_to_user_id: owner.id,
      p_amount_cents: 1000,
    });
    expect(setErr).toBeNull();

    // Member leaves group normally (zero balance)
    const { error: leaveErr } = await memberClient.rpc("leave_group", {
      p_group_id: groupId,
    });
    expect(leaveErr).toBeNull();

    // Owner manually deletes the expense
    const { error: delErr } = await callRpc(ownerClient, "delete_expense", {
      p_expense_id: expenseId,
    });
    expect(delErr).toBeNull();

    // Owner restores the expense: historical participant without decline restores fine!
    const { error: restoreErr } = await callRpc(ownerClient, "restore_expense", {
      p_expense_id: expenseId,
    });
    expect(restoreErr).toBeNull();

    const row = await withPg(async (pg) => {
      const { rows } = await pg.query<{ user_id: string }>(
        "SELECT user_id FROM public.current_expense_participants WHERE expense_id = $1 ORDER BY user_id",
        [expenseId],
      );
      return rows;
    });
    expect(row.map((r) => r.user_id).sort()).toEqual([owner.id, member.id].sort());
  });

  it("decline of an already-deleted expense records the decliner in the column", async () => {
    if (!isIntegrationTestReady) return;
    const [owner, invitee] = await createTestUsers(2);
    const ownerClient = authenticateAs(owner);
    const inviteeClient = authenticateAs(invitee);

    const { groupId } = await createGroup(owner, "P7 Already Deleted", [invitee.id]);
    const { expenseId } = await createExpense(owner, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([owner.id, invitee.id], 2000),
    });

    // Delete first
    await callRpc(ownerClient, "delete_expense", { p_expense_id: expenseId });

    // Assert empty initially
    const before = await withPg(async (pg) => {
      const { rows } = await pg.query<{ declined_user_ids: string[] }>(
        "SELECT declined_user_ids FROM public.expenses WHERE id = $1",
        [expenseId],
      );
      return rows[0];
    });
    expect(before.declined_user_ids).toEqual([]);

    // Decline
    await inviteeClient.rpc("decline_invitation", { p_group_id: groupId });

    // Assert decliner recorded in column
    const after = await withPg(async (pg) => {
      const { rows } = await pg.query<{ declined_user_ids: string[] }>(
        "SELECT declined_user_ids FROM public.expenses WHERE id = $1",
        [expenseId],
      );
      return rows[0];
    });
    expect(after.declined_user_ids).toEqual([invitee.id]);
  });

  it("only authenticated actor recorded and deduped on repeated decline", async () => {
    if (!isIntegrationTestReady) return;
    const [owner, invitee] = await createTestUsers(2);
    const ownerClient = authenticateAs(owner);
    const inviteeClient = authenticateAs(invitee);

    const { groupId } = await createGroup(owner, "P7 Dedup", [invitee.id]);
    const { expenseId } = await createExpense(owner, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([owner.id, invitee.id], 2000),
    });

    // First decline
    await inviteeClient.rpc("decline_invitation", { p_group_id: groupId });

    const firstDeclineRow = await withPg(async (pg) => {
      const { rows } = await pg.query<{ declined_user_ids: string[] }>(
        "SELECT declined_user_ids FROM public.expenses WHERE id = $1",
        [expenseId],
      );
      return rows[0];
    });
    expect(firstDeclineRow.declined_user_ids).toEqual([invitee.id]);

    // Re-invite
    await ownerClient.rpc("invite_member", {
      p_group_id: groupId,
      p_user_id: invitee.id,
    });

    // Second decline by same actor
    await inviteeClient.rpc("decline_invitation", { p_group_id: groupId });

    // Deduped: array length is still 1, contains invitee.id once
    const secondDeclineRow = await withPg(async (pg) => {
      const { rows } = await pg.query<{
        declined_user_ids: string[];
        cardinality: number;
      }>(
        "SELECT declined_user_ids, cardinality(declined_user_ids)::int as cardinality FROM public.expenses WHERE id = $1",
        [expenseId],
      );
      return rows[0];
    });
    expect(secondDeclineRow.declined_user_ids).toEqual([invitee.id]);
    expect(secondDeclineRow.cardinality).toBe(1);
  });

  it("delete/edit/recompute paths never resurrect refused debt", async () => {
    if (!isIntegrationTestReady) return;
    const [owner, invitee] = await createTestUsers(2);
    const ownerClient = authenticateAs(owner);
    const inviteeClient = authenticateAs(invitee);

    const { groupId } = await createGroup(owner, "P7 No Debt Resurrection", [invitee.id]);
    const { expenseId } = await createExpense(owner, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([owner.id, invitee.id], 2000),
    });

    await inviteeClient.rpc("decline_invitation", { p_group_id: groupId });

    // Edit rejected
    const editErr = await expectRpcError(
      callRpc(
        ownerClient,
        "edit_expense",
        editArgs(expenseId, 1, 2000, equalSplitPayload([owner.id, invitee.id], 2000)),
      ),
    );
    expect(editErr).toBe("expense_deleted");

    // Delete rejected
    const delErr = await expectRpcError(
      callRpc(ownerClient, "delete_expense", { p_expense_id: expenseId }),
    );
    expect(delErr).toBe("expense_deleted");

    // Restore rejected
    const restErr = await expectRpcError(
      callRpc(ownerClient, "restore_expense", { p_expense_id: expenseId }),
    );
    expect(restErr).toBe("invitation_not_accepted");

    // Balances remain empty
    const balances = await getBalances(groupId);
    expect(balances).toHaveLength(0);
  });
});

describe.skipIf(!isIntegrationTestReady)("P9 expense operation authorization matrix", () => {
  async function captureState(groupId: string, expenseId: string) {
    return await withPg(async (pg) => {
      const expense = (await pg.query("SELECT id, status, current_version_no, deleted_at, deleted_by FROM public.expenses WHERE id = $1", [expenseId])).rows[0];
      const versions = (await pg.query("SELECT version_no, payload FROM public.expense_versions WHERE expense_id = $1 ORDER BY version_no", [expenseId])).rows;
      const balances = (await pg.query("SELECT kind, participant_id, net_cents FROM public.group_balances WHERE group_id = $1 ORDER BY kind, participant_id", [groupId])).rows;
      const events = (await pg.query("SELECT id, kind, payload FROM public.group_events WHERE group_id = $1 ORDER BY id", [groupId])).rows;
      const members = (await pg.query("SELECT user_id, status FROM public.group_members WHERE group_id = $1 ORDER BY user_id", [groupId])).rows;
      return { expense, versions, balances, events, members };
    });
  }

  it("unknown expense returns expense_not_found on edit, delete, and restore", async () => {
    const unknownId = crypto.randomUUID();
    const [u] = await createTestUsers(1);
    const client = authenticateAs(u);

    expect(
      await expectRpcError(
        callRpc(client, "edit_expense", editArgs(unknownId, 1, 1000, equalSplitPayload([u.id], 1000))),
      ),
    ).toBe("expense_not_found");

    expect(
      await expectRpcError(
        callRpc(client, "delete_expense", { p_expense_id: unknownId }),
      ),
    ).toBe("expense_not_found");

    expect(
      await expectRpcError(
        callRpc(client, "restore_expense", { p_expense_id: unknownId }),
      ),
    ).toBe("expense_not_found");
  });

  it("enforces complete authorization matrix across all actor rows for active and deleted expense", async () => {
    const [creator, participant, acceptedNonParty, invitedMember, outsiderUser] =
      await createTestUsers(5);

    const cCreator = authenticateAs(creator);
    const cParticipant = authenticateAs(participant);
    const cNonParty = authenticateAs(acceptedNonParty);
    const cInvited = authenticateAs(invitedMember);
    const cOutsider = authenticateAs(outsiderUser);

    // Setup group with creator, participant, acceptedNonParty
    const groupId = await createGroupWithMembers(creator, [participant, acceptedNonParty]);

    // Add invited member
    await callRpc(cCreator, "invite_member", { p_group_id: groupId, p_email: invitedMember.email });

    // Active expense with creator and participant (50/50 split)
    const activeExpense = (await createExpense(creator, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([creator.id, participant.id], 2000),
    })) as unknown as ExpenseAck;
    const activeId = activeExpense.expenseId;

    // --- Active expense authorization tests ---
    // 1. Accepted non-party -> not_expense_party
    const stateBeforeNonPartyEdit = await captureState(groupId, activeId);
    expect(
      await expectRpcError(
        callRpc(cNonParty, "edit_expense", editArgs(activeId, 1, 2000, equalSplitPayload([creator.id, participant.id], 2000))),
      ),
    ).toBe("not_expense_party");
    expect(await captureState(groupId, activeId)).toEqual(stateBeforeNonPartyEdit);

    const stateBeforeNonPartyDelete = await captureState(groupId, activeId);
    expect(
      await expectRpcError(
        callRpc(cNonParty, "delete_expense", { p_expense_id: activeId }),
      ),
    ).toBe("not_expense_party");
    expect(await captureState(groupId, activeId)).toEqual(stateBeforeNonPartyDelete);

    // 2. Invited member -> not_a_member
    const stateBeforeInvitedEdit = await captureState(groupId, activeId);
    expect(
      await expectRpcError(
        callRpc(cInvited, "edit_expense", editArgs(activeId, 1, 2000, equalSplitPayload([creator.id, participant.id], 2000))),
      ),
    ).toBe("not_a_member");
    expect(await captureState(groupId, activeId)).toEqual(stateBeforeInvitedEdit);

    expect(
      await expectRpcError(
        callRpc(cInvited, "delete_expense", { p_expense_id: activeId }),
      ),
    ).toBe("not_a_member");

    // 3. Outsider -> not_a_member
    expect(
      await expectRpcError(
        callRpc(cOutsider, "edit_expense", editArgs(activeId, 1, 2000, equalSplitPayload([creator.id, participant.id], 2000))),
      ),
    ).toBe("not_a_member");
    expect(
      await expectRpcError(
        callRpc(cOutsider, "delete_expense", { p_expense_id: activeId }),
      ),
    ).toBe("not_a_member");

    // 4. Current non-creator participant -> allowed to edit
    const partEdit = await callRpc(
      cParticipant,
      "edit_expense",
      editArgs(activeId, 1, 2000, equalSplitPayload([creator.id, participant.id], 2000)),
    );
    expect(partEdit.error).toBeNull();
    expect((partEdit.data as ExpenseAck).versionNo).toBe(2);

    // 5. Creator -> allowed to edit (now expected version is 2)
    const creatorEdit = await callRpc(
      cCreator,
      "edit_expense",
      editArgs(activeId, 2, 2000, equalSplitPayload([creator.id, participant.id], 2000)),
    );
    expect(creatorEdit.error).toBeNull();
    expect((creatorEdit.data as ExpenseAck).versionNo).toBe(3);

    // --- Deleted expense & restore tests ---
    // Non-creator participant deletes expense
    const partDel = await callRpc(cParticipant, "delete_expense", { p_expense_id: activeId });
    expect(partDel.error).toBeNull();

    // Now activeId is deleted. Test restore authorization:
    // Non-party -> not_expense_party
    const stateBeforeNonPartyRestore = await captureState(groupId, activeId);
    expect(
      await expectRpcError(
        callRpc(cNonParty, "restore_expense", { p_expense_id: activeId }),
      ),
    ).toBe("not_expense_party");
    expect(await captureState(groupId, activeId)).toEqual(stateBeforeNonPartyRestore);

    // Invited -> not_a_member
    expect(
      await expectRpcError(
        callRpc(cInvited, "restore_expense", { p_expense_id: activeId }),
      ),
    ).toBe("not_a_member");

    // Outsider -> not_a_member
    expect(
      await expectRpcError(
        callRpc(cOutsider, "restore_expense", { p_expense_id: activeId }),
      ),
    ).toBe("not_a_member");

    // Non-creator participant -> allowed to restore!
    const partRestore = await callRpc(cParticipant, "restore_expense", { p_expense_id: activeId });
    expect(partRestore.error).toBeNull();

    // Creator deletes again
    const creatorDel = await callRpc(cCreator, "delete_expense", { p_expense_id: activeId });
    expect(creatorDel.error).toBeNull();

    // Creator restores
    const creatorRestore = await callRpc(cCreator, "restore_expense", { p_expense_id: activeId });
    expect(creatorRestore.error).toBeNull();
  });

  it("enforces not_a_member on departed creator and departed participant", async () => {
    const [creator, participant] = await createTestUsers(2);
    const cCreator = authenticateAs(creator);
    const cParticipant = authenticateAs(participant);

    const groupId = await createGroupWithMembers(creator, [participant]);
    const exp = (await createExpense(creator, {
      groupId,
      totalCents: 2000,
      payload: equalSplitPayload([creator.id, participant.id], 2000),
    })) as unknown as ExpenseAck;

    // Simulate departed participant by removing their membership row
    await withPg(async (pg) => {
      await pg.query("DELETE FROM public.group_members WHERE group_id = $1 AND user_id = $2", [
        groupId,
        participant.id,
      ]);
    });

    // Departed participant denied on edit, delete, restore
    expect(
      await expectRpcError(
        callRpc(cParticipant, "edit_expense", editArgs(exp.expenseId, 1, 2000, equalSplitPayload([creator.id], 2000))),
      ),
    ).toBe("not_a_member");

    expect(
      await expectRpcError(
        callRpc(cParticipant, "delete_expense", { p_expense_id: exp.expenseId }),
      ),
    ).toBe("not_a_member");

    expect(
      await expectRpcError(
        callRpc(cParticipant, "restore_expense", { p_expense_id: exp.expenseId }),
      ),
    ).toBe("not_a_member");

    // Simulate departed creator by removing creator membership row
    await withPg(async (pg) => {
      await pg.query("DELETE FROM public.group_members WHERE group_id = $1 AND user_id = $2", [
        groupId,
        creator.id,
      ]);
    });

    // Departed creator denied on edit, delete, restore
    expect(
      await expectRpcError(
        callRpc(cCreator, "edit_expense", editArgs(exp.expenseId, 1, 2000, equalSplitPayload([creator.id], 2000))),
      ),
    ).toBe("not_a_member");

    expect(
      await expectRpcError(
        callRpc(cCreator, "delete_expense", { p_expense_id: exp.expenseId }),
      ),
    ).toBe("not_a_member");

    expect(
      await expectRpcError(
        callRpc(cCreator, "restore_expense", { p_expense_id: exp.expenseId }),
      ),
    ).toBe("not_a_member");
  });

  it("claimed guest authorization: party rights on active and restore, revoked when removed", async () => {
    const [creator, claimant] = await createTestUsers(2);
    const cCreator = authenticateAs(creator);
    const cClaimant = authenticateAs(claimant);
    const groupId = await createGroupWithMembers(creator, [claimant]);

    // Create expense with guest
    const exp = (await createExpense(creator, {
      groupId,
      totalCents: 2000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: creator.id },
          { kind: "guest", guestId: null, displayName: "Guest Claim Matrix" },
        ],
        shares: [1000, 1000],
        payers: [{ participantIndex: 0, amountCents: 2000 }],
        itemAssignments: null,
      },
    })) as unknown as ExpenseAck;

    const detailRes = await callRpc(cCreator, "get_expense", { p_expense_id: exp.expenseId });
    const detail = detailRes.data as ExpenseDetail;
    const guestId = detail.current.payload.participants[1].guestId!;

    // Before claim: claimant has accepted membership in group, but is not an expense party
    expect(
      await expectRpcError(
        callRpc(cClaimant, "edit_expense", editArgs(exp.expenseId, 1, 2000, detail.current.payload)),
      ),
    ).toBe("not_expense_party");

    expect(
      await expectRpcError(
        callRpc(cClaimant, "delete_expense", { p_expense_id: exp.expenseId }),
      ),
    ).toBe("not_expense_party");

    // Claimant claims guest
    const tokenRes = await callRpc(cCreator, "create_guest_claim_token", { p_guest_id: guestId });
    const token = (tokenRes.data as { token: string }).token;
    await callRpc(cClaimant, "claim_guest", { p_token: token });

    // Now claimant is recognized on the effective current version (v1)!
    // Can edit
    const editRes = await callRpc(cClaimant, "edit_expense", {
      p_expense_id: exp.expenseId,
      p_expected_version_no: 1,
      p_occurred_on: "2026-09-01",
      p_title: "Edited By Claimed Guest",
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: 2000,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_payload: {
        items: [],
        participants: [
          { kind: "user", userId: creator.id },
          { kind: "user", userId: claimant.id },
        ],
        shares: [1000, 1000],
        payers: [{ participantIndex: 0, amountCents: 2000 }],
        itemAssignments: null,
      },
    });
    expect(editRes.error).toBeNull();
    expect((editRes.data as ExpenseAck).versionNo).toBe(2);

    // Can delete
    const delRes = await callRpc(cClaimant, "delete_expense", { p_expense_id: exp.expenseId });
    expect(delRes.error).toBeNull();

    // Can restore (identity from effective current version v2)
    const restoreRes = await callRpc(cClaimant, "restore_expense", { p_expense_id: exp.expenseId });
    expect(restoreRes.error).toBeNull();
  });
});
