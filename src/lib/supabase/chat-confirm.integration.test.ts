import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { isIntegrationTestReady, adminClient } from "@/test/integration-setup";
import {
  createTestUser,
  createTestGroupWithMembers,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";

interface ConfirmationResult {
  operation_id: string;
  outcome: "committed" | "cancelled" | "retired" | "not_found";
  created: boolean;
  operation_created_at: string | null;
  terminal_code: string | null;
  expense: { id: string; status: string; created_at: string } | null;
  system_message_id: string | null;
}

type RpcResult = { data: ConfirmationResult | null; error: { code?: string; message: string } | null };

function makeRpc(user: TestUser) {
  const client = authenticateAs(user);
  return client.rpc.bind(client) as unknown as (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<RpcResult>;
}

function request(groupId: string, alice: TestUser, bob: TestUser, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    group_id: groupId,
    title: "Pizza",
    merchant_name: null,
    expense_type: "single_amount",
    total_amount_cents: 10000,
    items: [],
    shares: [
      { user_id: alice.id, share_amount_cents: 5000 },
      { user_id: bob.id, share_amount_cents: 5000 },
    ],
    payers: [{ user_id: alice.id, amount_cents: 10000 }],
    ...overrides,
  };
}

async function makeDmGroup(a: TestUser, b: TestUser): Promise<string> {
  const dmGroup = await createTestGroupWithMembers(a, [b]);
  await adminClient!.from("groups").update({ is_dm: true }).eq("id", dmGroup.id);
  const [userA, userB] = [a.id, b.id].sort();
  await adminClient!.from("dm_pairs").insert({ group_id: dmGroup.id, user_a: userA, user_b: userB });
  return dmGroup.id;
}

describe.skipIf(!isIntegrationTestReady)("confirm_chat_expense RPC — behavior", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let dmGroupId: string;

  beforeAll(async () => {
    [alice, bob, carol] = await Promise.all([
      createTestUser({ name: "Confirm Alice" }),
      createTestUser({ name: "Confirm Bob" }),
      createTestUser({ name: "Confirm Carol" }),
    ]);

    dmGroupId = await makeDmGroup(alice, bob);
  });

  afterAll(async () => {
    const databaseUrl = process.env.SUPABASE_DB_URL;
    if (!databaseUrl || !dmGroupId) return;
    const pg = new Client(databaseUrl);
    await pg.connect();
    await pg.query(
      "DELETE FROM public.chat_expense_confirmation_operations WHERE group_id = $1 OR initiated_by_user_id = ANY($2::uuid[])",
      [dmGroupId, [alice.id, bob.id, carol.id]],
    );
    await pg.query(
      "DELETE FROM public.expense_graph_save_operations WHERE group_id = $1 OR caller_id = ANY($2::uuid[])",
      [dmGroupId, [alice.id, bob.id, carol.id]],
    );
    await pg.query("DELETE FROM public.expenses WHERE group_id = $1", [dmGroupId]);
    await pg.query("DELETE FROM public.groups WHERE id = $1", [dmGroupId]);
    await pg.end();
  });

  it("commits once and returns the exact same expense on a same-request replay", async () => {
    const rpc = makeRpc(alice);
    const operationId = crypto.randomUUID();
    const req = request(dmGroupId, alice, bob, { title: "Replay" });

    const first = await rpc("confirm_chat_expense", { p_operation_id: operationId, p_request: req });
    expect(first.error).toBeNull();
    expect(first.data?.outcome).toBe("committed");
    expect(first.data?.created).toBe(true);

    const second = await rpc("confirm_chat_expense", { p_operation_id: operationId, p_request: req });
    expect(second.error).toBeNull();
    expect(second.data?.outcome).toBe("committed");
    expect(second.data?.created).toBe(false);
    expect(second.data?.expense?.id).toBe(first.data?.expense?.id);
  });

  it("rejects a changed request under the same operation id with PST06 and no new expense", async () => {
    const rpc = makeRpc(alice);
    const operationId = crypto.randomUUID();

    const first = await rpc("confirm_chat_expense", {
      p_operation_id: operationId,
      p_request: request(dmGroupId, alice, bob, { title: "Original" }),
    });
    expect(first.error).toBeNull();

    const conflict = await rpc("confirm_chat_expense", {
      p_operation_id: operationId,
      p_request: request(dmGroupId, alice, bob, { title: "Changed" }),
    });
    expect(conflict.data).toBeNull();
    expect(conflict.error?.code).toBe("PST06");
  });

  it("creates two distinct expenses for two distinct operation ids with an identical request", async () => {
    const rpc = makeRpc(alice);
    const req = request(dmGroupId, alice, bob, { title: "Distinct" });

    const first = await rpc("confirm_chat_expense", { p_operation_id: crypto.randomUUID(), p_request: req });
    const second = await rpc("confirm_chat_expense", { p_operation_id: crypto.randomUUID(), p_request: req });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data?.expense?.id).not.toBe(second.data?.expense?.id);
  });

  it("rejects an unauthorized caller (not in the DM pair) with PST05 and creates no expense", async () => {
    const rpc = makeRpc(carol);
    const operationId = crypto.randomUUID();

    const { data: before } = await adminClient!.from("expenses").select("id").eq("group_id", dmGroupId);
    const beforeCount = before?.length ?? 0;

    const result = await rpc("confirm_chat_expense", {
      p_operation_id: operationId,
      p_request: request(dmGroupId, alice, bob, { title: "Unauthorized" }),
    });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("PST05");

    const { data: after } = await adminClient!.from("expenses").select("id").eq("group_id", dmGroupId);
    expect(after?.length ?? 0).toBe(beforeCount);
  });

  it("rejects a share/payer identity outside the DM pair with PST04", async () => {
    const rpc = makeRpc(alice);
    const outsider = await createTestUser({ name: "Confirm Outsider" });

    const result = await rpc("confirm_chat_expense", {
      p_operation_id: crypto.randomUUID(),
      p_request: request(dmGroupId, alice, bob, {
        shares: [
          { user_id: alice.id, share_amount_cents: 5000 },
          { user_id: outsider.id, share_amount_cents: 5000 },
        ],
      }),
    });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("PST04");
  });

  it("rejects a share/payer sum mismatch with PST03 before any write", async () => {
    const rpc = makeRpc(alice);
    const { data: before } = await adminClient!.from("expenses").select("id").eq("group_id", dmGroupId);
    const beforeCount = before?.length ?? 0;

    const result = await rpc("confirm_chat_expense", {
      p_operation_id: crypto.randomUUID(),
      p_request: request(dmGroupId, alice, bob, {
        shares: [
          { user_id: alice.id, share_amount_cents: 4000 },
          { user_id: bob.id, share_amount_cents: 5000 },
        ],
      }),
    });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("PST03");

    const { data: after } = await adminClient!.from("expenses").select("id").eq("group_id", dmGroupId);
    expect(after?.length ?? 0).toBe(beforeCount);
  });

  it("rejects a non-DM group with PST05", async () => {
    const rpc = makeRpc(alice);
    const regularGroup = await createTestGroupWithMembers(alice, [bob]);

    const result = await rpc("confirm_chat_expense", {
      p_operation_id: crypto.randomUUID(),
      p_request: request(regularGroup.id, alice, bob),
    });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("PST05");
  });

  it("persists exact shares, one payer, active status, and exactly one linked system message", async () => {
    const rpc = makeRpc(alice);
    const result = await rpc("confirm_chat_expense", {
      p_operation_id: crypto.randomUUID(),
      p_request: request(dmGroupId, alice, bob, { title: "Exact rows", total_amount_cents: 9901, shares: [
        { user_id: alice.id, share_amount_cents: 4950 },
        { user_id: bob.id, share_amount_cents: 4951 },
      ], payers: [{ user_id: alice.id, amount_cents: 9901 }] }),
    });
    expect(result.error).toBeNull();
    const expenseId = result.data!.expense!.id;

    const { data: shares } = await adminClient!
      .from("expense_shares")
      .select("share_amount_cents")
      .eq("expense_id", expenseId);
    expect((shares ?? []).reduce((sum, s) => sum + s.share_amount_cents, 0)).toBe(9901);

    const { data: payers } = await adminClient!
      .from("expense_payers")
      .select("amount_cents")
      .eq("expense_id", expenseId);
    expect(payers).toHaveLength(1);
    expect(payers?.[0]?.amount_cents).toBe(9901);

    const { data: expenseRow } = await adminClient!
      .from("expenses")
      .select("status")
      .eq("id", expenseId)
      .single();
    expect(expenseRow?.status).toBe("active");

    const { data: messages } = await adminClient!
      .from("chat_messages")
      .select("id, message_type")
      .eq("expense_id", expenseId);
    expect(messages).toHaveLength(1);
    expect(messages?.[0]?.message_type).toBe("system_expense");
    expect(messages?.[0]?.id).toBe(result.data!.system_message_id);
  });

  it("applies the exact balance delta (bob owes alice half the total)", async () => {
    const rpc = makeRpc(alice);
    const before = await adminClient!
      .from("balances")
      .select("amount_cents")
      .eq("group_id", dmGroupId);
    const beforeTotal = (before.data ?? []).reduce((sum, b) => sum + b.amount_cents, 0);

    await rpc("confirm_chat_expense", {
      p_operation_id: crypto.randomUUID(),
      p_request: request(dmGroupId, alice, bob, { title: "Balance check", total_amount_cents: 8000, shares: [
        { user_id: alice.id, share_amount_cents: 4000 },
        { user_id: bob.id, share_amount_cents: 4000 },
      ], payers: [{ user_id: alice.id, amount_cents: 8000 }] }),
    });

    const after = await adminClient!
      .from("balances")
      .select("amount_cents")
      .eq("group_id", dmGroupId);
    const afterTotal = (after.data ?? []).reduce((sum, b) => sum + b.amount_cents, 0);
    // Bob owes Alice 4000 more than before (sign depends on lexical user_a/user_b
    // ordering, magnitude is what we assert deterministically here).
    expect(Math.abs(afterTotal - beforeTotal)).toBe(4000);
  });
});

describe.skipIf(!isIntegrationTestReady)("get_chat_expense_confirmation / cancel_chat_expense_confirmation RPCs", () => {
  let alice: TestUser;
  let bob: TestUser;
  let dmGroupId: string;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([
      createTestUser({ name: "GetCancel Alice" }),
      createTestUser({ name: "GetCancel Bob" }),
    ]);
    dmGroupId = await makeDmGroup(alice, bob);
  });

  afterAll(async () => {
    const databaseUrl = process.env.SUPABASE_DB_URL;
    if (!databaseUrl || !dmGroupId) return;
    const pg = new Client(databaseUrl);
    await pg.connect();
    await pg.query(
      "DELETE FROM public.chat_expense_confirmation_operations WHERE group_id = $1 OR initiated_by_user_id = ANY($2::uuid[])",
      [dmGroupId, [alice.id, bob.id]],
    );
    await pg.query(
      "DELETE FROM public.expense_graph_save_operations WHERE group_id = $1 OR caller_id = ANY($2::uuid[])",
      [dmGroupId, [alice.id, bob.id]],
    );
    await pg.query("DELETE FROM public.expenses WHERE group_id = $1", [dmGroupId]);
    await pg.query("DELETE FROM public.groups WHERE id = $1", [dmGroupId]);
    await pg.end();
  });

  it("get returns not_found for an unknown operation id", async () => {
    const rpc = makeRpc(alice);
    const result = await rpc("get_chat_expense_confirmation", { p_operation_id: crypto.randomUUID() });
    expect(result.error).toBeNull();
    expect(result.data?.outcome).toBe("not_found");
  });

  it("get returns not_found (not a permission error) for another user's operation", async () => {
    const rpcAlice = makeRpc(alice);
    const rpcBob = makeRpc(bob);
    const operationId = crypto.randomUUID();

    await rpcAlice("confirm_chat_expense", {
      p_operation_id: operationId,
      p_request: request(dmGroupId, alice, bob, { title: "Owner-only" }),
    });

    const asOwner = await rpcAlice("get_chat_expense_confirmation", { p_operation_id: operationId });
    expect(asOwner.data?.outcome).toBe("committed");

    const asOther = await rpcBob("get_chat_expense_confirmation", { p_operation_id: operationId });
    expect(asOther.error).toBeNull();
    expect(asOther.data?.outcome).toBe("not_found");
  });

  it("cancel reserves the operation id without creating an expense; a later confirm honors the cancellation", async () => {
    const rpc = makeRpc(alice);
    const operationId = crypto.randomUUID();
    const req = request(dmGroupId, alice, bob, { title: "Cancel path" });

    const cancelled = await rpc("cancel_chat_expense_confirmation", {
      p_operation_id: operationId,
      p_request: req,
      p_terminal_code: "client_cancelled",
    });
    expect(cancelled.error).toBeNull();
    expect(cancelled.data?.outcome).toBe("cancelled");

    const { data: before } = await adminClient!.from("expenses").select("id").eq("group_id", dmGroupId);
    const beforeIds = new Set((before ?? []).map((r) => r.id));

    const afterConfirm = await rpc("confirm_chat_expense", { p_operation_id: operationId, p_request: req });
    expect(afterConfirm.error).toBeNull();
    expect(afterConfirm.data?.outcome).toBe("cancelled");

    const { data: after } = await adminClient!.from("expenses").select("id").eq("group_id", dmGroupId);
    const afterIds = new Set((after ?? []).map((r) => r.id));
    expect(afterIds).toEqual(beforeIds);
  });

  it("cancel never reverses an already-committed operation", async () => {
    const rpc = makeRpc(alice);
    const operationId = crypto.randomUUID();
    const req = request(dmGroupId, alice, bob, { title: "Cannot reverse" });

    const committed = await rpc("confirm_chat_expense", { p_operation_id: operationId, p_request: req });
    expect(committed.data?.outcome).toBe("committed");

    const cancelAttempt = await rpc("cancel_chat_expense_confirmation", {
      p_operation_id: operationId,
      p_request: req,
      p_terminal_code: "client_cancelled",
    });
    expect(cancelAttempt.error).toBeNull();
    expect(cancelAttempt.data?.outcome).toBe("committed");
    expect(cancelAttempt.data?.expense?.id).toBe(committed.data?.expense?.id);
  });
});
