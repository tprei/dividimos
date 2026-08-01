import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import {
  createTestUser,
  createTestGroupWithMembers,
  createAndActivateExpense,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";

/**
 * Issue #534: expense activation push requires a committed one-shot
 * activation event, not a bare client-driven call. This exercises the
 * exact atomic claim query push-notify.ts's notifyExpenseActivated runs
 * directly against the real database: only a row that is currently
 * `status = 'active'`, owned by the claiming caller, and never before
 * claimed (`activation_notified_at IS NULL`) can be claimed, and exactly
 * one concurrent claim can ever succeed for a given expense.
 */
async function claimActivationNotification(
  expenseId: string,
  callerId: string,
): Promise<{ id: string } | null> {
  const { data } = await adminClient!
    .from("expenses")
    .update({ activation_notified_at: new Date().toISOString() })
    .eq("id", expenseId)
    .eq("status", "active")
    .eq("creator_id", callerId)
    .is("activation_notified_at", null)
    .select("id")
    .maybeSingle();
  return data;
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
      const { data: draft } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Still a draft",
          expense_type: "single_amount",
          total_amount: 3000,
          status: "draft",
        })
        .select("id")
        .single();

      const claimed = await claimActivationNotification(draft!.id, alice.id);
      expect(claimed).toBeNull();
    });

    it("rejects a creator's direct attempt to pre-poison the claim marker on their own draft", async () => {
      const { data: draft } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Cannot pre-poison the claim",
          expense_type: "single_amount",
          total_amount: 3000,
          status: "draft",
        })
        .select("id")
        .single();

      // If this direct client UPDATE succeeded, the marker would already be
      // non-null by the time the expense is later activated, and the real
      // activation push would be silently skipped.
      const aliceClient = authenticateAs(alice);
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
