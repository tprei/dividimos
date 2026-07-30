import { describe, it, expect } from "vitest";
import { createTestUsers, createTestGroupWithMembers, authenticateAs } from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  decodeExpenseGraphSnapshot,
  type DecodedExpenseGraphSnapshot,
} from "@/lib/expense-money";

/** Decode or fail with the exact issue in the assertion message. */
function decodeOrThrow(raw: unknown): DecodedExpenseGraphSnapshot {
  const decoded = decodeExpenseGraphSnapshot(raw);
  if (!decoded.ok) {
    throw new Error(`snapshot decode failed: ${JSON.stringify(decoded.issue)}`);
  }
  return decoded.value;
}

describe.skipIf(!isIntegrationTestReady)("load_expense_graph_snapshot", () => {
  it("returns a draft snapshot the client decoder accepts", async () => {
    const [alice, bob] = await createTestUsers(2);
    const group = await createTestGroupWithMembers(alice, [bob]);
    const client = authenticateAs(alice);

    const { data: saveResult, error: saveError } = await client.rpc("save_expense_draft_graph", {
      p_expense: {
        group_id: group.id,
        title: "Jantar",
        merchant_name: "Restaurante X",
        expense_type: "itemized",
        total_amount: 3300,
        service_fee_basis_points: 1000,
        fixed_fees: 0,
      },
      p_items: [
        { description: "Pizza", quantity: 1000, unit_price_cents: 3000, total_price_cents: 3000 },
      ],
      p_shares: [
        { user_id: alice.id, share_amount_cents: 1650 },
        { user_id: bob.id, share_amount_cents: 1650 },
      ],
      p_payers: [{ user_id: alice.id, amount_cents: 3300 }],
      p_guests: [],
      p_guest_shares: [],
      p_participant_order: [],
      p_expected_graph_revision: 0,
      p_save_operation_id: crypto.randomUUID(),
    });
    expect(saveError).toBeNull();
    const expenseId = (saveResult as { id: string }).id;

    const { data: snapshot, error: snapErr } = await client.rpc("load_expense_graph_snapshot", {
      p_expense_id: expenseId,
    });
    expect(snapErr).toBeNull();
    const value = decodeOrThrow(snapshot);
    expect(value.status).toBe("draft");
    expect(value.graphRevision).toBe(1);
    expect(value.title).toBe("Jantar");
    expect(value.participantOrder).toHaveLength(2);
    expect(value.draftClaimProtectedUserIds).toEqual([]);
  });

  it("returns an active snapshot with a persisted map the decoder accepts", async () => {
    const [alice, bob] = await createTestUsers(2);
    const group = await createTestGroupWithMembers(alice, [bob]);
    const client = authenticateAs(alice);

    const { data: saveResult } = await client.rpc("save_expense_draft_graph", {
      p_expense: {
        group_id: group.id,
        title: "Uber",
        merchant_name: null,
        expense_type: "single_amount",
        total_amount: 2000,
        service_fee_basis_points: 0,
        fixed_fees: 0,
      },
      p_items: [],
      p_shares: [
        { user_id: alice.id, share_amount_cents: 1000 },
        { user_id: bob.id, share_amount_cents: 1000 },
      ],
      p_payers: [{ user_id: alice.id, amount_cents: 2000 }],
      p_guests: [],
      p_guest_shares: [],
      p_participant_order: [],
      p_expected_graph_revision: 0,
      p_save_operation_id: crypto.randomUUID(),
    });
    const expenseId = (saveResult as { id: string }).id;

    const { error: activateErr } = await client.rpc("activate_saved_expense", {
      p_expense_id: expenseId,
      p_expected_graph_revision: 1,
    });
    expect(activateErr).toBeNull();

    const { data: snapshot, error: snapErr } = await client.rpc("load_expense_graph_snapshot", {
      p_expense_id: expenseId,
    });
    expect(snapErr).toBeNull();

    const value = decodeOrThrow(snapshot);
    expect(value.status).toBe("active");
    expect(value.graphRevision).toBe(2);
    expect(value.participantOrder).toHaveLength(2);
  });

  it("returns null for an expense the caller has no access to", async () => {
    const [alice, bob, outsider] = await createTestUsers(3);
    const group = await createTestGroupWithMembers(alice, [bob]);
    const aliceClient = authenticateAs(alice);
    const outsiderClient = authenticateAs(outsider);

    const { data: saveResult } = await aliceClient.rpc("save_expense_draft_graph", {
      p_expense: {
        group_id: group.id,
        title: "Privado",
        merchant_name: null,
        expense_type: "single_amount",
        total_amount: 1000,
        service_fee_basis_points: 0,
        fixed_fees: 0,
      },
      p_items: [],
      p_shares: [{ user_id: alice.id, share_amount_cents: 1000 }],
      p_payers: [{ user_id: alice.id, amount_cents: 1000 }],
      p_guests: [],
      p_guest_shares: [],
      p_participant_order: [],
      p_expected_graph_revision: 0,
      p_save_operation_id: crypto.randomUUID(),
    });
    const expenseId = (saveResult as { id: string }).id;

    const { data: snapshot, error } = await outsiderClient.rpc("load_expense_graph_snapshot", {
      p_expense_id: expenseId,
    });
    expect(error).toBeNull();
    expect(snapshot).toBeNull();
  });

  it("returns a snapshot for a DM group and denies a non-pair outsider", async () => {
    const [alice, bob, outsider] = await createTestUsers(3);
    await createTestGroupWithMembers(alice, [bob]);
    const aliceClient = authenticateAs(alice);
    const outsiderClient = authenticateAs(outsider);

    const { data: dmResult } = await aliceClient.rpc("get_or_create_dm_group", {
      p_other_user_id: bob.id,
    });
    const groupId = dmResult as string;

    const { data: saveResult, error: saveError } = await aliceClient.rpc("save_expense_draft_graph", {
      p_expense: {
        group_id: groupId,
        title: "Cafe",
        merchant_name: null,
        expense_type: "single_amount",
        total_amount: 1000,
        service_fee_basis_points: 0,
        fixed_fees: 0,
      },
      p_items: [],
      p_shares: [{ user_id: alice.id, share_amount_cents: 1000 }],
      p_payers: [{ user_id: alice.id, amount_cents: 1000 }],
      p_guests: [],
      p_guest_shares: [],
      p_participant_order: [],
      p_expected_graph_revision: 0,
      p_save_operation_id: crypto.randomUUID(),
    });
    expect(saveError).toBeNull();
    const expenseId = (saveResult as { id: string }).id;

    const { data: bobSnapshot, error: bobErr } = await authenticateAs(bob).rpc(
      "load_expense_graph_snapshot",
      { p_expense_id: expenseId },
    );
    expect(bobErr).toBeNull();
    decodeOrThrow(bobSnapshot);

    const { data: outsiderSnapshot, error: outsiderErr } = await outsiderClient.rpc(
      "load_expense_graph_snapshot",
      { p_expense_id: expenseId },
    );
    expect(outsiderErr).toBeNull();
    expect(outsiderSnapshot).toBeNull();
  });

  it("hides a pre-activation claimed guest and reports it in draft_claim_protected_user_ids", async () => {
    const [alice, claimant] = await createTestUsers(2);
    const group = await createTestGroupWithMembers(alice, [claimant]);
    const aliceClient = authenticateAs(alice);

    const { data: saveResult } = await aliceClient.rpc("save_expense_draft_graph", {
      p_expense: {
        group_id: group.id,
        title: "Almoco",
        merchant_name: null,
        expense_type: "single_amount",
        total_amount: 2000,
        service_fee_basis_points: 0,
        fixed_fees: 0,
      },
      p_items: [],
      p_shares: [{ user_id: alice.id, share_amount_cents: 1000 }],
      p_payers: [{ user_id: alice.id, amount_cents: 2000 }],
      p_guests: [{ local_id: "g1", display_name: "Convidado" }],
      p_guest_shares: [{ local_id: "g1", share_amount_cents: 1000 }],
      p_participant_order: [],
      p_expected_graph_revision: 0,
      p_save_operation_id: crypto.randomUUID(),
    });
    const expenseId = (saveResult as { id: string }).id;

    const { data: snapshotBefore } = await aliceClient.rpc("load_expense_graph_snapshot", {
      p_expense_id: expenseId,
    });
    const before = decodeOrThrow(snapshotBefore);
    expect(before.guests).toHaveLength(1);

    const { data: tokenRow } = await aliceClient
      .from("expense_guests")
      .select("claim_token")
      .eq("expense_id", expenseId)
      .single();
    const claimToken = (tokenRow as { claim_token: string }).claim_token;

    const { error: claimErr } = await authenticateAs(claimant).rpc("claim_guest_spot", {
      p_claim_token: claimToken,
    });
    expect(claimErr).toBeNull();

    const { data: snapshotAfter, error: snapErr } = await aliceClient.rpc(
      "load_expense_graph_snapshot",
      { p_expense_id: expenseId },
    );
    expect(snapErr).toBeNull();
    const after = decodeOrThrow(snapshotAfter);
    expect(after.status).toBe("draft");
    expect(after.guests).toHaveLength(0);
    expect(after.draftClaimProtectedUserIds).toEqual([claimant.id]);
    const claimantInOrder = after.participantOrder.some(
      (p) => p.kind === "user" && p.userId === claimant.id,
    );
    expect(claimantInOrder).toBe(true);
  });

  it("returns null for a nonexistent expense id", async () => {
    const [alice] = await createTestUsers(1);
    const client = authenticateAs(alice);
    const { data, error } = await client.rpc("load_expense_graph_snapshot", {
      p_expense_id: crypto.randomUUID(),
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});
