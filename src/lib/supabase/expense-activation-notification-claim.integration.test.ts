import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "pg";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import {
  createTestUser,
  createTestGroupWithMembers,
  createAndActivateExpense,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";

const databaseUrl = process.env.SUPABASE_DB_URL;

/**
 * Issue #534: expense activation push requires a committed one-shot
 * activation event, not a bare client-driven call. This exercises the
 * exact atomic claim query push-notify.ts's notifyExpenseActivated runs
 * directly against the real database: only a row that is currently
 * `status = 'active'`, owned by the claiming caller, and never before
 * claimed (`activation_notified_at IS NULL`) can be claimed, and exactly
 * one concurrent claim can ever succeed for a given expense.
 *
 * #477 guard: the UPDATE on expenses requires a direct mutation token.
 * The guard's finalizer allows a registration-only direct token with
 * zero events (0-rows-matched conditional UPDATE) as a no-op, so the
 * "already claimed" / "wrong caller" / "draft" cases still return null
 * correctly.
 */
async function claimActivationNotification(
  expenseId: string,
  callerId: string,
): Promise<{ id: string } | null> {
  if (!databaseUrl) return null;
  const conn = new Client(databaseUrl);
  await conn.connect();
  try {
    await conn.query("BEGIN");
    await conn.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [[expenseId]]);
    const { rows } = await conn.query<{ id: string }>(
      `UPDATE public.expenses SET activation_notified_at = statement_timestamp()
        WHERE id = $1 AND status = 'active' AND creator_id = $2
          AND activation_notified_at IS NULL
        RETURNING id`,
      [expenseId, callerId],
    );
    await conn.query("COMMIT");
    return rows.length > 0 ? rows[0] : null;
  } catch {
    await conn.query("ROLLBACK").catch(() => {});
    return null;
  } finally {
    await conn.end();
  }
}

describe.skipIf(!isIntegrationTestReady)(
  "expense activation notification claim (#534)",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let groupId: string;

    beforeAll(async () => {
      [alice, bob] = await Promise.all([
        createTestUser({ name: "Activation Claim Alice" }),
        createTestUser({ name: "Activation Claim Bob" }),
      ]);
      const group = await createTestGroupWithMembers(alice, [bob]);
      groupId = group.id;
    });

    it("claims exactly once for a genuinely active expense owned by the caller", async () => {
      const expenseId = await createAndActivateExpense({
        creator: alice,
        groupId,
        shares: [
          { userId: alice.id, amount: 2500 },
          { userId: bob.id, amount: 2500 },
        ],
        payers: [{ userId: alice.id, amount: 5000 }],
        title: "Claim once",
      });

      const first = await claimActivationNotification(expenseId, alice.id);
      expect(first).not.toBeNull();
      expect(first!.id).toBe(expenseId);

      // Replay: the same caller claims again — the row is already claimed.
      const second = await claimActivationNotification(expenseId, alice.id);
      expect(second).toBeNull();

      const { data: row } = await adminClient!
        .from("expenses")
        .select("activation_notified_at")
        .eq("id", expenseId)
        .single();
      expect(row!.activation_notified_at).not.toBeNull();
    });

    it("does not claim a draft expense", async () => {
      // Draft via save_expense_draft_graph (the guard rejects direct INSERT).
      const aliceClient = authenticateAs(alice);
      const { data: draftData, error: draftErr } = await aliceClient.rpc(
        "save_expense_draft_graph",
        {
          p_expense: {
            group_id: groupId,
            title: "Still a draft",
            merchant_name: null,
            expense_type: "single_amount",
            total_amount: 3000,
            service_fee_basis_points: 0,
            fixed_fees: 0,
          },
          p_items: [],
          p_shares: [{ user_id: alice.id, share_amount_cents: 3000 }],
          p_payers: [{ user_id: alice.id, amount_cents: 3000 }],
          p_guests: [],
          p_guest_shares: [],
          p_participant_order: [],
          p_expected_graph_revision: 0,
          p_save_operation_id: crypto.randomUUID(),
        },
      );
      expect(draftErr).toBeNull();
      const draftId = (draftData as { id: string }).id;

      const claimed = await claimActivationNotification(draftId, alice.id);
      expect(claimed).toBeNull();
    });

    it("rejects a creator's direct attempt to pre-poison the claim marker on their own draft", async () => {
      // Draft via save_expense_draft_graph (the guard rejects direct INSERT).
      const aliceClient = authenticateAs(alice);
      const { data: draftData, error: draftErr } = await aliceClient.rpc(
        "save_expense_draft_graph",
        {
          p_expense: {
            group_id: groupId,
            title: "Cannot pre-poison the claim",
            merchant_name: null,
            expense_type: "single_amount",
            total_amount: 3000,
            service_fee_basis_points: 0,
            fixed_fees: 0,
          },
          p_items: [],
          p_shares: [{ user_id: alice.id, share_amount_cents: 3000 }],
          p_payers: [{ user_id: alice.id, amount_cents: 3000 }],
          p_guests: [],
          p_guest_shares: [],
          p_participant_order: [],
          p_expected_graph_revision: 0,
          p_save_operation_id: crypto.randomUUID(),
        },
      );
      expect(draftErr).toBeNull();
      const draft = draftData as { id: string };

      // If this direct client UPDATE succeeded, the marker would already be
      // non-null by the time the expense is later activated, and the real
      // activation push would be silently skipped.
      const { error } = await aliceClient
        .from("expenses")
        .update({ activation_notified_at: new Date().toISOString() })
        .eq("id", draft!.id);
      expect(error).not.toBeNull();

      const { data: row } = await adminClient!
        .from("expenses")
        .select("activation_notified_at")
        .eq("id", draft!.id)
        .single();
      expect(row!.activation_notified_at).toBeNull();
    });

    it("does not claim for a caller who is not the expense creator", async () => {
      const expenseId = await createAndActivateExpense({
        creator: alice,
        groupId,
        shares: [
          { userId: alice.id, amount: 1000 },
          { userId: bob.id, amount: 1000 },
        ],
        payers: [{ userId: alice.id, amount: 2000 }],
        title: "Not bob's to claim",
      });

      const claimedByBob = await claimActivationNotification(expenseId, bob.id);
      expect(claimedByBob).toBeNull();

      // The genuine creator can still claim it afterward.
      const claimedByAlice = await claimActivationNotification(expenseId, alice.id);
      expect(claimedByAlice).not.toBeNull();
    });

    it("does not claim a nonexistent expense", async () => {
      const claimed = await claimActivationNotification(
        "00000000-0000-0000-0000-000000000000",
        alice.id,
      );
      expect(claimed).toBeNull();
    });

    it("exactly one concurrent claim succeeds under a real race", async () => {
      const expenseId = await createAndActivateExpense({
        creator: alice,
        groupId,
        shares: [
          { userId: alice.id, amount: 1500 },
          { userId: bob.id, amount: 1500 },
        ],
        payers: [{ userId: alice.id, amount: 3000 }],
        title: "Concurrent claim race",
      });

      const [a, b, c] = await Promise.all([
        claimActivationNotification(expenseId, alice.id),
        claimActivationNotification(expenseId, alice.id),
        claimActivationNotification(expenseId, alice.id),
      ]);

      const successCount = [a, b, c].filter((r) => r !== null).length;
      expect(successCount).toBe(1);
    });
  },
);
