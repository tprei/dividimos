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

  it("rejects an itemized draft whose top-level total doesn't reconcile with lines/fee/fixed (#477)", async () => {
    // #477 spec item 5: "If an itemized draft has any line, all lines
    // and the aggregate total/fees must already reconcile." Two 1-unit
    // lines (quantity is milliunits: 1000 = 1.000 units) totaling 2000
    // cents, 10% fee (200), no fixed fee -> exact total is 2200; supply
    // a total that's off by one cent.
    const result = await callGraphSave(alice, {
      expense: {
        ...expense(2199),
        expense_type: "itemized",
        service_fee_basis_points: 1000,
      },
      items: [
        { description: "Item A", quantity: 1000, unit_price_cents: 1000, total_price_cents: 1000 },
        { description: "Item B", quantity: 1000, unit_price_cents: 1000, total_price_cents: 1000 },
      ],
      expectedRevision: 0,
      operationId: crypto.randomUUID(),
    });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("PST03");
  });

  it("accepts an itemized draft whose top-level total exactly reconciles with lines/fee/fixed (#477)", async () => {
    // Same 2000-cent subtotal and 10% fee as above, exact fixed fee of
    // 50, and the arithmetically correct total: 2000 + 200 + 50 = 2250.
    const result = await callGraphSave(alice, {
      expense: {
        ...expense(2250),
        expense_type: "itemized",
        service_fee_basis_points: 1000,
        fixed_fees: 50,
      },
      items: [
        { description: "Item A", quantity: 1000, unit_price_cents: 1000, total_price_cents: 1000 },
        { description: "Item B", quantity: 1000, unit_price_cents: 1000, total_price_cents: 1000 },
      ],
      expectedRevision: 0,
      operationId: crypto.randomUUID(),
    });
    expect(result.error).toBeNull();
    expect(result.data?.id).toBeTruthy();
  });

  it("rejects a replacement save that drops a claimed guest's claimant (#495)", async () => {
    // #495: once a guest spot is claimed, the claimant becomes a
    // "protected claimant" -- expense_guests.claimed_by is set, and any
    // later graph replacement that omits that user from p_shares must be
    // rejected wholesale (PST04 claimed_guest_not_participant), not
    // partially applied. Claiming works on a draft-status expense too
    // (claim_guest_spot only special-cases the allocation-plan
    // reconciliation for 'active'), so this needs no activation step.
    const carol = await createTestUser({ name: "Graph Save Carol" });
    const saved = await callGraphSave(alice, {
      expense: expense(100),
      shares: [{ user_id: alice.id, share_amount_cents: 50 }],
      payers: [{ user_id: alice.id, amount_cents: 100 }],
      guests: [{ local_id: "g1", display_name: "Guest before claim" }],
      guestShares: [{ local_id: "g1", share_amount_cents: 50 }],
      expectedRevision: 0,
      operationId: crypto.randomUUID(),
    });
    expect(saved.error).toBeNull();
    const expenseId = saved.data!.id;

    const { data: guestRow, error: guestError } = await adminClient!
      .from("expense_guests")
      .select("id, claim_token")
      .eq("expense_id", expenseId)
      .single();
    expect(guestError).toBeNull();

    const carolClient = authenticateAs(carol);
    const { error: claimError } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: (guestRow as { claim_token: string }).claim_token,
    });
    expect(claimError).toBeNull();

    const { data: revisionAfterClaim } = await adminClient!
      .from("expenses")
      .select("graph_revision")
      .eq("id", expenseId)
      .single();
    const claimedRevision = (revisionAfterClaim as { graph_revision: number }).graph_revision;
    expect(claimedRevision).toBe(saved.data!.graph_revision + 1);

    // Attempt a replacement that keeps Alice but drops Carol -- the
    // claimed guest's claimant -- from p_shares entirely.
    const replacement = await callGraphSave(alice, {
      expense: expense(100, expenseId),
      shares: [{ user_id: alice.id, share_amount_cents: 100 }],
      payers: [{ user_id: alice.id, amount_cents: 100 }],
      expectedRevision: claimedRevision,
      operationId: crypto.randomUUID(),
    });
    expect(replacement.data).toBeNull();
    expect(replacement.error?.code).toBe("PST04");

    // Whole-state no-op: the rejected attempt must not have partially
    // applied -- revision, shares, and the guest's claim all unchanged.
    const { data: revisionAfterReject } = await adminClient!
      .from("expenses")
      .select("graph_revision")
      .eq("id", expenseId)
      .single();
    expect((revisionAfterReject as { graph_revision: number }).graph_revision).toBe(
      claimedRevision,
    );

    const { data: sharesAfterReject } = await adminClient!
      .from("expense_shares")
      .select("user_id, share_amount_cents")
      .eq("expense_id", expenseId);
    expect(sharesAfterReject).toEqual(
      expect.arrayContaining([
        { user_id: alice.id, share_amount_cents: 50 },
        { user_id: carol.id, share_amount_cents: 50 },
      ]),
    );
    expect(sharesAfterReject).toHaveLength(2);

    const { data: guestsAfterReject } = await adminClient!
      .from("expense_guests")
      .select("id, claimed_by")
      .eq("expense_id", expenseId);
    expect(guestsAfterReject).toHaveLength(1);
    expect((guestsAfterReject as { claimed_by: string }[])[0].claimed_by).toBe(carol.id);
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
