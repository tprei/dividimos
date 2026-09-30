import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  acceptInvitation,
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUser,
  createTestUsers,
  equalSplitPayload,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

interface SharedSpending {
  expenseCount: number;
  totalCents: number;
  myShareCents: number;
  theirShareCents: number;
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

async function anonRpc(fn: string, args: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const body = (await response.json()) as { message?: string };
  expect(response.ok).toBe(false);
  expect(body.message).toMatch(new RegExp(`permission denied for function ${fn}`));
}

async function createDmExpense(
  initiator: TestUser,
  counterparty: TestUser,
  totalCents: number,
): Promise<string> {
  const dm = await rpcOk<{ groupId: string }>(
    authenticateAs(initiator),
    "get_or_create_dm",
    { p_user_id: counterparty.id },
  );
  await acceptInvitation(counterparty, dm.groupId);
  await createExpense(initiator, {
    groupId: dm.groupId,
    totalCents,
    payload: equalSplitPayload([initiator.id, counterparty.id], totalCents),
  });
  return dm.groupId;
}

describe.skipIf(!isIntegrationTestReady)("shared spending — summary", () => {
  it("counts only active co-participated expenses across group and dm, with exact shares", async () => {
    const [ana, bruno, carla] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(ana, [bruno, carla]);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);

    await createExpense(ana, {
      groupId,
      totalCents: 3000,
      payload: equalSplitPayload([ana.id, bruno.id], 3000),
    });
    await createExpense(ana, {
      groupId,
      totalCents: 2400,
      payload: equalSplitPayload([ana.id, carla.id], 2400),
    });
    const removed = await createExpense(bruno, {
      groupId,
      totalCents: 1001,
      payload: equalSplitPayload([ana.id, bruno.id], 1001),
    });
    await rpcOk(brunoClient, "delete_expense", { p_expense_id: removed.expenseId });
    await createDmExpense(ana, bruno, 2001);

    expect(
      await rpcOk<SharedSpending>(anaClient, "get_shared_spending", { p_user_id: bruno.id }),
    ).toEqual({ expenseCount: 2, totalCents: 5001, myShareCents: 2501, theirShareCents: 2500 });

    expect(
      await rpcOk<SharedSpending>(brunoClient, "get_shared_spending", { p_user_id: ana.id }),
    ).toEqual({ expenseCount: 2, totalCents: 5001, myShareCents: 2500, theirShareCents: 2501 });
  });

  it("excludes expenses from groups the caller does not belong to", async () => {
    const [ana, bruno, carla] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(bruno, [carla]);
    await createExpense(bruno, {
      groupId,
      totalCents: 1000,
      payload: equalSplitPayload([bruno.id, carla.id], 1000),
    });

    expect(
      await rpcOk<SharedSpending>(authenticateAs(ana), "get_shared_spending", {
        p_user_id: bruno.id,
      }),
    ).toEqual({ expenseCount: 0, totalCents: 0, myShareCents: 0, theirShareCents: 0 });
  });

  it("stops counting once the caller is no longer an accepted member", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(ana, [bruno]);
    const anaClient = authenticateAs(ana);

    await createExpense(ana, {
      groupId,
      totalCents: 3000,
      payload: equalSplitPayload([ana.id, bruno.id], 3000),
    });
    expect(
      await rpcOk<SharedSpending>(anaClient, "get_shared_spending", { p_user_id: bruno.id }),
    ).toEqual({ expenseCount: 1, totalCents: 3000, myShareCents: 1500, theirShareCents: 1500 });

    await withPg(async (client) => {
      await client.query(
        "update public.group_members set status = 'invited' where group_id = $1 and user_id = $2",
        [groupId, ana.id],
      );
    });

    expect(
      await rpcOk<SharedSpending>(anaClient, "get_shared_spending", { p_user_id: bruno.id }),
    ).toEqual({ expenseCount: 0, totalCents: 0, myShareCents: 0, theirShareCents: 0 });
  });

  it("reads totals and shares from the current version after an edit", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(ana, [bruno]);
    const anaClient = authenticateAs(ana);

    const created = await createExpense(ana, {
      groupId,
      totalCents: 3000,
      payload: equalSplitPayload([ana.id, bruno.id], 3000),
    });

    await rpcOk<{ groupId: string }>(anaClient, "edit_expense", {
      p_expense_id: created.expenseId,
      p_expected_version_no: created.versionNo,
      p_occurred_on: new Date().toISOString().slice(0, 10),
      p_title: "Despesa",
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: 4000,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_payload: equalSplitPayload([ana.id, bruno.id], 4000),
    });

    expect(
      await rpcOk<SharedSpending>(anaClient, "get_shared_spending", { p_user_id: bruno.id }),
    ).toEqual({ expenseCount: 1, totalCents: 4000, myShareCents: 2000, theirShareCents: 2000 });
  });

  it("rejects self and null targets and anonymous callers", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);

    expect(
      await rpcErrorCode(anaClient, "get_shared_spending", { p_user_id: ana.id }),
    ).toBe("invalid_argument");
    expect(await rpcErrorCode(anaClient, "get_shared_spending", { p_user_id: null })).toBe(
      "invalid_argument",
    );
    await anonRpc("get_shared_spending", { p_user_id: bruno.id });
  });

  it("returns all zeros for an unknown user id", async () => {
    const ana = await createTestUser();

    expect(
      await rpcOk<SharedSpending>(authenticateAs(ana), "get_shared_spending", {
        p_user_id: crypto.randomUUID(),
      }),
    ).toEqual({ expenseCount: 0, totalCents: 0, myShareCents: 0, theirShareCents: 0 });
  });
});
