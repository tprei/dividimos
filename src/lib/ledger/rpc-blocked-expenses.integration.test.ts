import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  equalSplitPayload,
  expectRpcError,
  getBalances,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

const OCCURRED_ON = "2026-09-26";

interface MutationAck {
  expenseId: string;
  versionNo: number;
  ledgerVersion: number;
  eventId: number | null;
}

type RpcResult<T> = { data: T | null; error: { message: string } | null };

async function rpcOk<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = (await client.rpc(fn, args)) as RpcResult<T>;
  if (error) {
    throw new Error(`${fn} failed: ${error.message}`);
  }
  return data as T;
}

async function rpcErrorCode(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<string> {
  return expectRpcError(Promise.resolve(client.rpc(fn, args)));
}

function editArgs(
  expenseId: string,
  expectedVersionNo: number,
  title: string,
  totalCents: number,
  payload: unknown,
): Record<string, unknown> {
  return {
    p_expense_id: expenseId,
    p_expected_version_no: expectedVersionNo,
    p_occurred_on: OCCURRED_ON,
    p_title: title,
    p_merchant_name: null,
    p_expense_type: "single_amount",
    p_total_cents: totalCents,
    p_service_fee_bps: 0,
    p_fixed_fee_cents: 0,
    p_payload: payload,
  };
}

async function guestIdFor(expenseId: string): Promise<string> {
  return withPg(async (client) => {
    const result = await client.query<{ id: string }>(
      "select id from public.guests where expense_id = $1",
      [expenseId],
    );
    if (result.rows.length !== 1) {
      throw new Error("fixture failure: expected exactly one guest row");
    }
    return result.rows[0].id;
  });
}

async function versionCount(expenseId: string): Promise<number> {
  return withPg(async (client) => {
    const result = await client.query<{ count: string }>(
      "select count(*)::text as count from public.expense_versions where expense_id = $1",
      [expenseId],
    );
    return Number(result.rows[0].count);
  });
}

async function claimGuestAs(
  issuer: SupabaseClient,
  claimant: TestUser,
  guestId: string,
): Promise<void> {
  const issued = await rpcOk<{ token: string }>(issuer, "create_guest_claim_token", {
    p_guest_id: guestId,
  });
  await rpcOk(authenticateAs(claimant), "claim_guest", { p_token: issued.token });
}

describe.skipIf(!isIntegrationTestReady)("blocked expenses — participants", () => {
  it("rejects new blocked participants in create and edit in both directions", async () => {
    const [ana, bruno, carla] = await createTestUsers(3);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);
    const groupId = await createGroupWithMembers(ana, [bruno, carla], "Grupo contas");

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    expect(
      await rpcErrorCode(anaClient, "create_expense", {
        p_client_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_occurred_on: OCCURRED_ON,
        p_title: "Com bruno",
        p_merchant_name: null,
        p_expense_type: "single_amount",
        p_total_cents: 3000,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_chave_acesso: null,
        p_payload: equalSplitPayload([ana.id, bruno.id], 3000),
      }),
    ).toBe("member_excluded");

    const allowed = await createExpense(ana, {
      groupId,
      totalCents: 3000,
      payload: equalSplitPayload([ana.id, carla.id], 3000),
    });

    expect(
      await rpcErrorCode(anaClient, "edit_expense", editArgs(
        allowed.expenseId,
        allowed.versionNo,
        "Com bruno depois",
        4000,
        equalSplitPayload([ana.id, carla.id, bruno.id], 4000),
      )),
    ).toBe("member_excluded");

    expect(
      await rpcErrorCode(brunoClient, "create_expense", {
        p_client_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_occurred_on: OCCURRED_ON,
        p_title: "Bruno com ana",
        p_merchant_name: null,
        p_expense_type: "single_amount",
        p_total_cents: 2000,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_chave_acesso: null,
        p_payload: equalSplitPayload([bruno.id, ana.id], 2000),
      }),
    ).toBe("member_excluded");
  });

  it("allows an edit retaining existing blocked participant identities", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo edição");

    const created = await createExpense(ana, {
      groupId,
      title: "Jantar",
      totalCents: 10000,
      payload: equalSplitPayload([ana.id, bruno.id], 10000),
    });

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    const edited = await rpcOk<MutationAck>(anaClient, "edit_expense", editArgs(
      created.expenseId,
      created.versionNo,
      "Jantar ajustado",
      8000,
      equalSplitPayload([ana.id, bruno.id], 8000),
    ));
    expect(edited.versionNo).toBe(2);

    const balances = await getBalances(groupId);
    expect(balances.find((row) => row.participant_id === ana.id)?.net_cents).toBe(4000);
    expect(balances.find((row) => row.participant_id === bruno.id)?.net_cents).toBe(-4000);
    expect(await versionCount(created.expenseId)).toBe(2);
  });

  it("rejects readding a removed blocked identity despite historical participation", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo reinsert");

    const created = await createExpense(ana, {
      groupId,
      totalCents: 10000,
      payload: equalSplitPayload([ana.id, bruno.id], 10000),
    });

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    const removed = await rpcOk<MutationAck>(anaClient, "edit_expense", editArgs(
      created.expenseId,
      created.versionNo,
      "Sem bruno",
      5000,
      equalSplitPayload([ana.id], 5000),
    ));
    expect(removed.versionNo).toBe(2);

    expect(
      await rpcErrorCode(anaClient, "edit_expense", editArgs(
        created.expenseId,
        2,
        "Bruno de volta",
        10000,
        equalSplitPayload([ana.id, bruno.id], 10000),
      )),
    ).toBe("member_excluded");
  });

  it("retains a claimed guest identity when the effective current slot already contains it", async () => {
    const [ana, bruno, carla] = await createTestUsers(3);
    const anaClient = authenticateAs(ana);
    const groupId = await createGroupWithMembers(ana, [bruno, carla], "Grupo claim");

    const created = await createExpense(ana, {
      groupId,
      totalCents: 9000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: ana.id },
          { kind: "guest", guestId: null, displayName: "Zé" },
        ],
        shares: [4500, 4500],
        payers: [{ participantIndex: 0, amountCents: 9000 }],
        itemAssignments: null,
      },
    });

    const guestId = await guestIdFor(created.expenseId);
    await claimGuestAs(anaClient, carla, guestId);

    const edited = await rpcOk<MutationAck>(anaClient, "edit_expense", editArgs(
      created.expenseId,
      created.versionNo,
      "Zé virou carla",
      9000,
      {
        items: [],
        participants: [
          { kind: "user", userId: ana.id },
          { kind: "guest", guestId, displayName: "Zé" },
        ],
        shares: [4500, 4500],
        payers: [{ participantIndex: 0, amountCents: 9000 }],
        itemAssignments: null,
      },
    ));
    expect(edited.versionNo).toBe(2);

    const balances = await getBalances(groupId);
    expect(balances.find((row) => row.participant_id === carla.id)?.net_cents).toBe(-4500);
    expect(balances.find((row) => row.kind === "guest")).toBeUndefined();
  });

  it("does not let resolved guest identities bypass new-participant checking", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo claim bloqueado");

    const created = await createExpense(ana, {
      groupId,
      totalCents: 9000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: ana.id },
          { kind: "guest", guestId: null, displayName: "Zé" },
        ],
        shares: [4500, 4500],
        payers: [{ participantIndex: 0, amountCents: 9000 }],
        itemAssignments: null,
      },
    });

    const guestId = await guestIdFor(created.expenseId);
    await claimGuestAs(anaClient, bruno, guestId);
    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    const guestPayload = {
      items: [],
      participants: [
        { kind: "user", userId: ana.id },
        { kind: "guest", guestId, displayName: "Zé" },
      ],
      shares: [4500, 4500],
      payers: [{ participantIndex: 0, amountCents: 9000 }],
      itemAssignments: null,
    };
    const retained = await rpcOk<MutationAck>(anaClient, "edit_expense", editArgs(
      created.expenseId,
      created.versionNo,
      "Zé permanece",
      9000,
      guestPayload,
    ));
    expect(retained.versionNo).toBe(2);

    const removed = await rpcOk<MutationAck>(anaClient, "edit_expense", editArgs(
      created.expenseId,
      2,
      "Sem o slot do Zé",
      4500,
      equalSplitPayload([ana.id], 4500),
    ));
    expect(removed.versionNo).toBe(3);

    expect(
      await rpcErrorCode(anaClient, "edit_expense", editArgs(
        created.expenseId,
        3,
        "Bruno de volta pelo claim",
        9000,
        {
          items: [],
          participants: [
            { kind: "user", userId: ana.id },
            { kind: "user", userId: bruno.id },
          ],
          shares: [4500, 4500],
          payers: [{ participantIndex: 0, amountCents: 9000 }],
          itemAssignments: null,
        },
      )),
    ).toBe("member_excluded");

    expect(await versionCount(created.expenseId)).toBe(3);
  });

  it("preserves existing participants on restore", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo restore");

    const created = await createExpense(ana, {
      groupId,
      totalCents: 10000,
      payload: equalSplitPayload([ana.id, bruno.id], 10000),
    });

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });
    await rpcOk(anaClient, "delete_expense", { p_expense_id: created.expenseId });
    await rpcOk(anaClient, "restore_expense", { p_expense_id: created.expenseId });

    const balances = await getBalances(groupId);
    expect(balances.find((row) => row.participant_id === ana.id)?.net_cents).toBe(5000);
    expect(balances.find((row) => row.participant_id === bruno.id)?.net_cents).toBe(-5000);

    const participants = await withPg(async (client) => {
      const result = await client.query<{ user_id: string | null }>(
        "select user_id from public.current_expense_participants where expense_id = $1 and kind = 'user' order by user_id",
        [created.expenseId],
      );
      return result.rows.map((row) => row.user_id);
    });
    expect(participants.sort()).toEqual([ana.id, bruno.id].sort());
  });

  it("rolls back create-expense-with-group when its member list contains a blocked target", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    const clientId = crypto.randomUUID();
    expect(
      await rpcErrorCode(anaClient, "create_expense_with_group", {
        p_client_id: clientId,
        p_group_name: "Grupo novo",
        p_member_ids: [bruno.id],
        p_occurred_on: OCCURRED_ON,
        p_title: "Primeira conta",
        p_merchant_name: null,
        p_expense_type: "single_amount",
        p_total_cents: 6000,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: equalSplitPayload([ana.id, bruno.id], 6000),
      }),
    ).toBe("member_excluded");

    const residue = await withPg(async (client) => {
      const groups = await client.query<{ count: string }>(
        "select count(*)::text as count from public.groups where creator_id = $1 and name = 'Grupo novo'",
        [ana.id],
      );
      const expenses = await client.query<{ count: string }>(
        "select count(*)::text as count from public.expenses where client_id = $1",
        [clientId],
      );
      return {
        groups: Number(groups.rows[0].count),
        expenses: Number(expenses.rows[0].count),
      };
    });
    expect(residue).toEqual({ groups: 0, expenses: 0 });
  });

  it("denies unauthorized create and edit independently of blocking", async () => {
    const [ana, bruno, dave] = await createTestUsers(3);
    const daveClient = authenticateAs(dave);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo fechado");

    const created = await createExpense(ana, {
      groupId,
      totalCents: 4000,
      payload: equalSplitPayload([ana.id, bruno.id], 4000),
    });

    await rpcOk(daveClient, "block_user", { p_user_id: ana.id });

    expect(
      await rpcErrorCode(daveClient, "create_expense", {
        p_client_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_occurred_on: OCCURRED_ON,
        p_title: "Intruso",
        p_merchant_name: null,
        p_expense_type: "single_amount",
        p_total_cents: 1000,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_chave_acesso: null,
        p_payload: equalSplitPayload([dave.id], 1000),
      }),
    ).toBe("not_a_member");

    expect(
      await rpcErrorCode(daveClient, "edit_expense", editArgs(
        created.expenseId,
        created.versionNo,
        "Intruso editando",
        1000,
        equalSplitPayload([ana.id, bruno.id], 1000),
      )),
    ).toBe("not_a_member");
  });
});
