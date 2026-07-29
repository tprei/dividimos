import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestGroupWithMembers,
  createTestUser,
  deleteTestExpenses,
  type TestUser,
} from "@/test/integration-helpers";

interface GraphSaveResult {
  id: string;
  graph_revision: number;
}

interface GraphSaveArgs {
  expense: Record<string, unknown>;
  items?: unknown[];
  shares?: unknown[];
  payers?: unknown[];
  guests?: unknown[];
  guestShares?: unknown[];
  participantOrder?: unknown[];
  expectedRevision: number;
  operationId: string;
}

async function callGraphSave(
  user: TestUser,
  args: GraphSaveArgs,
): Promise<{ data: GraphSaveResult | null; error: { code?: string; message: string } | null }> {
  const client = authenticateAs(user);
  const rpc = client.rpc.bind(client) as unknown as (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  const { data, error } = await rpc("save_expense_draft_graph", {
    p_expense: args.expense,
    p_items: args.items ?? [],
    p_shares: args.shares ?? [],
    p_payers: args.payers ?? [],
    p_guests: args.guests ?? [],
    p_guest_shares: args.guestShares ?? [],
    p_participant_order: args.participantOrder ?? [],
    p_expected_graph_revision: args.expectedRevision,
    p_save_operation_id: args.operationId,
  });
  return { data: data as GraphSaveResult | null, error };
}

describe.skipIf(!isIntegrationTestReady)("revisioned graph-save prerequisite", () => {
  let alice: TestUser;
  let bob: TestUser;
  let outsider: TestUser;
  let groupId: string;

  afterAll(async () => {
    const databaseUrl = process.env.SUPABASE_DB_URL;
    if (!databaseUrl || !alice || !bob || !outsider) return;
    const pg = new Client(databaseUrl);
    await pg.connect();
    const { rows } = await pg.query<{ id: string }>(
      "SELECT id FROM public.expenses WHERE group_id = $1",
      [groupId],
    );
    await deleteTestExpenses(pg, rows.map((r) => r.id));
    await pg.query(
      "DELETE FROM public.expense_graph_save_operations WHERE caller_id = ANY($1::uuid[])",
      [[alice.id, bob.id, outsider.id]],
    );
    await pg.query("DELETE FROM public.groups WHERE id = $1", [groupId]);
    await pg.end();
  });

  beforeAll(async () => {
    [alice, bob, outsider] = await Promise.all([
      createTestUser({ name: "Graph Save Alice" }),
      createTestUser({ name: "Graph Save Bob" }),
      createTestUser({ name: "Graph Save Outsider" }),
    ]);
    const group = await createTestGroupWithMembers(alice, [bob]);
    groupId = group.id;
  });

  function expense(totalAmount = 1000, id?: string): Record<string, unknown> {
    return {
      ...(id ? { id } : {}),
      group_id: groupId,
      title: "Graph save dinner",
      merchant_name: null,
      expense_type: "single_amount",
      total_amount: totalAmount,
      service_fee_basis_points: 0,
      fixed_fees: 0,
    };
  }

  it("creates revision one and replays the exact operation", async () => {
    const operationId = crypto.randomUUID();
    const first = await callGraphSave(alice, {
      expense: expense(),
      expectedRevision: 0,
      operationId,
    });
    expect(first.error).toBeNull();
    expect(first.data?.graph_revision).toBe(1);

    const replay = await callGraphSave(alice, {
      expense: expense(),
      expectedRevision: 0,
      operationId,
    });
    expect(replay.error).toBeNull();
    expect(replay.data).toEqual(first.data);
  });

  it("rejects a changed payload under a committed operation id", async () => {
    const operationId = crypto.randomUUID();
    const first = await callGraphSave(alice, {
      expense: expense(),
      expectedRevision: 0,
      operationId,
    });
    expect(first.error).toBeNull();

    const conflict = await callGraphSave(alice, {
      expense: expense(1100),
      expectedRevision: 0,
      operationId,
    });
    expect(conflict.data).toBeNull();
    expect(conflict.error?.code).toBe("PST06");
  });

  it("uses expected revision for replacement saves", async () => {
    const first = await callGraphSave(alice, {
      expense: expense(),
      expectedRevision: 0,
      operationId: crypto.randomUUID(),
    });
    expect(first.error).toBeNull();

    const stale = await callGraphSave(alice, {
      expense: expense(1200, first.data!.id),
      expectedRevision: 0,
      operationId: crypto.randomUUID(),
    });
    expect(stale.data).toBeNull();
    expect(stale.error?.code).toBe("PST08");

    const replacement = await callGraphSave(alice, {
      expense: expense(1200, first.data!.id),
      expectedRevision: first.data!.graph_revision,
      operationId: crypto.randomUUID(),
    });
    expect(replacement.error).toBeNull();
    expect(replacement.data?.graph_revision).toBe(first.data!.graph_revision + 1);
  });

  it("activates a complete graph through the revisioned bridge", async () => {
    const saved = await callGraphSave(alice, {
      expense: expense(),
      shares: [{ user_id: alice.id, share_amount_cents: 1000 }],
      payers: [{ user_id: alice.id, amount_cents: 1000 }],
      expectedRevision: 0,
      operationId: crypto.randomUUID(),
    });
    expect(saved.error).toBeNull();

    const client = authenticateAs(alice);
    const rpc = client.rpc.bind(client) as unknown as (
      name: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc("activate_saved_expense", {
      p_expense_id: saved.data!.id,
      p_expected_graph_revision: saved.data!.graph_revision,
    });
    expect(error).toBeNull();
    expect(data).toEqual({
      id: saved.data!.id,
      status: "active",
      graph_revision: saved.data!.graph_revision + 1,
    });
  });

  it("rejects a payer that is not an explicit user share", async () => {
    const result = await callGraphSave(alice, {
      expense: expense(),
      shares: [{ user_id: alice.id, share_amount_cents: 1000 }],
      payers: [{ user_id: bob.id, amount_cents: 1000 }],
      expectedRevision: 0,
      operationId: crypto.randomUUID(),
    });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("PST04");
  });

  it("does not disclose a save to an outsider", async () => {
    const result = await callGraphSave(outsider, {
      expense: expense(),
      expectedRevision: 0,
      operationId: crypto.randomUUID(),
    });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("PST05");

    const groups = await adminClient!.from("groups").select("id").eq("id", groupId);
    expect(groups.error).toBeNull();
    expect(groups.data).toHaveLength(1);
  });
});
