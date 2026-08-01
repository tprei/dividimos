import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import {
  createTestUser,
  createTestGroupWithMembers,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";

/**
 * Issue #477 review finding: deleteExpense() (src/lib/supabase/expense-
 * actions.ts) used a raw PostgREST DELETE against `expenses`, which the
 * expense-graph mutation-token guard rejects outright -- no client-facing
 * role can ever open a mutation token, so "Excluir rascunho" was
 * unconditionally broken by the guard's own landing. This exercises the
 * guard-compatible replacement, delete_draft_expense, end to end.
 */
async function saveDraft(
  owner: TestUser,
  groupId: string,
  title: string,
): Promise<string> {
  const client = authenticateAs(owner);
  const { data, error } = await client.rpc("save_expense_draft_graph", {
    p_expense: {
      group_id: groupId,
      title,
      merchant_name: null,
      expense_type: "single_amount",
      total_amount: 3000,
      service_fee_basis_points: 0,
      fixed_fees: 0,
    },
    p_items: [],
    p_shares: [{ user_id: owner.id, share_amount_cents: 3000 }],
    p_payers: [{ user_id: owner.id, amount_cents: 3000 }],
    p_guests: [],
    p_guest_shares: [],
    p_participant_order: [],
    p_expected_graph_revision: 0,
    p_save_operation_id: crypto.randomUUID(),
  });
  if (error || !data) throw new Error(`save draft: ${error?.message}`);
  return (data as { id: string }).id;
}

describe.skipIf(!isIntegrationTestReady)("delete_draft_expense (#477)", () => {
  let alice: TestUser;
  let bob: TestUser;
  let groupId: string;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([
      createTestUser({ name: "Delete Draft Alice" }),
      createTestUser({ name: "Delete Draft Bob" }),
    ]);
    const group = await createTestGroupWithMembers(alice, [bob]);
    groupId = group.id;
  });

  it("deletes the creator's own draft, cascading its children", async () => {
    const draftId = await saveDraft(alice, groupId, "To delete");

    const aliceClient = authenticateAs(alice);
    const { error } = await aliceClient.rpc("delete_draft_expense", {
      p_expense_id: draftId,
    });
    expect(error).toBeNull();

    const { data: row } = await adminClient!
      .from("expenses")
      .select("id")
      .eq("id", draftId)
      .maybeSingle();
    expect(row).toBeNull();

    const { data: shares } = await adminClient!
      .from("expense_shares")
      .select("id")
      .eq("expense_id", draftId);
    expect(shares ?? []).toHaveLength(0);
  });

  it("deletes even after the draft was saved twice (a live save-operation ledger row exists)", async () => {
    // Regression: expense_graph_save_operations.expense_id is ON DELETE
    // RESTRICT DEFERRABLE INITIALLY DEFERRED. Every normally-saved draft
    // has a committed ledger row; without retiring it first, the DELETE
    // aborts silently at COMMIT rather than at the DELETE statement.
    const draftId = await saveDraft(alice, groupId, "Saved twice");
    const client = authenticateAs(alice);
    const { error: resaveError } = await client.rpc("save_expense_draft_graph", {
      p_expense: {
        id: draftId,
        group_id: groupId,
        title: "Saved twice, edited",
        merchant_name: null,
        expense_type: "single_amount",
        total_amount: 4000,
        service_fee_basis_points: 0,
        fixed_fees: 0,
      },
      p_items: [],
      p_shares: [{ user_id: alice.id, share_amount_cents: 4000 }],
      p_payers: [{ user_id: alice.id, amount_cents: 4000 }],
      p_guests: [],
      p_guest_shares: [],
      p_participant_order: [],
      p_expected_graph_revision: 1,
      p_save_operation_id: crypto.randomUUID(),
    });
    expect(resaveError).toBeNull();

    const { error } = await client.rpc("delete_draft_expense", {
      p_expense_id: draftId,
    });
    expect(error).toBeNull();

    const { data: row } = await adminClient!
      .from("expenses")
      .select("id")
      .eq("id", draftId)
      .maybeSingle();
    expect(row).toBeNull();
  });

  it("rejects deleting another user's draft", async () => {
    const draftId = await saveDraft(alice, groupId, "Alice's draft");

    const bobClient = authenticateAs(bob);
    const { error } = await bobClient.rpc("delete_draft_expense", {
      p_expense_id: draftId,
    });
    expect(error).not.toBeNull();

    const { data: row } = await adminClient!
      .from("expenses")
      .select("id")
      .eq("id", draftId)
      .maybeSingle();
    expect(row).not.toBeNull();
  });

  it("rejects deleting an active (non-draft) expense", async () => {
    const draftId = await saveDraft(alice, groupId, "About to activate");
    const client = authenticateAs(alice);
    const { data: expRow } = await adminClient!
      .from("expenses")
      .select("graph_revision")
      .eq("id", draftId)
      .single();
    const { error: activationError } = await client.rpc("activate_saved_expense", {
      p_expense_id: draftId,
      p_expected_graph_revision: expRow!.graph_revision,
    });
    expect(activationError).toBeNull();

    const { error } = await client.rpc("delete_draft_expense", {
      p_expense_id: draftId,
    });
    expect(error).not.toBeNull();

    const { data: row } = await adminClient!
      .from("expenses")
      .select("status")
      .eq("id", draftId)
      .single();
    expect(row!.status).toBe("active");
  });

  it("rejects an unknown expense id", async () => {
    const client = authenticateAs(alice);
    const { error } = await client.rpc("delete_draft_expense", {
      p_expense_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(error).not.toBeNull();
  });
});
