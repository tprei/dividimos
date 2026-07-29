import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  createTestGroupWithMembers,
  authenticateAs,
  createTestGroup,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

/**
 * Integration tests for settlement-actions.ts.
 *
 * These tests call the actual Supabase tables and RPCs to verify
 * that our TypeScript layer correctly wraps the database operations.
 *
 * Since settlement-actions uses `createClient()` (browser client),
 * we test the underlying queries directly using authenticated clients
 * to validate the logic and RLS policies.
 */

/**
 * Helper: create a draft expense and activate it via the real RPCs.
 * Issue #477's mutation-token guard rejects direct table writes (and
 * service_role has no grant on begin_expense_graph_direct_mutation), so
 * fixtures must route through save_expense_draft_graph +
 * activate_saved_expense, exactly as the app does.
 */
async function createAndActivateExpense(opts: {
  groupId: string;
  creatorId: string;
  creatorToken: string;
  totalAmount: number;
  shares: { userId: string; amount: number }[];
  payers: { userId: string; amount: number }[];
}): Promise<string> {
  const client = authenticateAs({
    id: opts.creatorId,
    accessToken: opts.creatorToken,
  } as TestUser);

  const { data: saved, error: saveError } = await client.rpc(
    "save_expense_draft_graph",
    {
      p_expense: {
        group_id: opts.groupId,
        title: "Test expense",
        merchant_name: null,
        expense_type: "single_amount",
        total_amount: opts.totalAmount,
        service_fee_basis_points: 0,
        fixed_fees: 0,
      },
      p_items: [],
      p_shares: opts.shares.map((s) => ({ user_id: s.userId, share_amount_cents: s.amount })),
      p_payers: opts.payers.map((p) => ({ user_id: p.userId, amount_cents: p.amount })),
      p_guests: [],
      p_guest_shares: [],
      p_participant_order: [],
      p_expected_graph_revision: 0,
      p_save_operation_id: crypto.randomUUID(),
    },
  );
  if (saveError || !saved) throw new Error(`Failed to create expense: ${saveError?.message}`);
  const draft = saved as { id: string; graph_revision: number };

  const { error: activateError } = await client.rpc("activate_saved_expense", {
    p_expense_id: draft.id,
    p_expected_graph_revision: draft.graph_revision,
  });
  if (activateError) throw new Error(`Failed to activate: ${activateError.message}`);

  return draft.id;
}

describe.skipIf(!isIntegrationTestReady)(
  "settlement-actions integration",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;
    let groupId: string;

    beforeEach(async () => {
      [alice, bob, carol] = await createTestUsers(3);
      const group = await createTestGroup(alice.id, [bob.id, carol.id]);
      groupId = group.id;
      await adminClient!
        .from("group_members")
        .update({ status: "accepted" })
        .eq("group_id", groupId);
    });

    describe("balances table queries", () => {
      it("reads non-zero balances after expense activation", async () => {
        await createAndActivateExpense({
          groupId,
          creatorId: alice.id,
          creatorToken: alice.accessToken!,
          totalAmount: 6000,
          shares: [
            { userId: alice.id, amount: 2000 },
            { userId: bob.id, amount: 2000 },
            { userId: carol.id, amount: 2000 },
          ],
          payers: [{ userId: alice.id, amount: 6000 }],
        });

        // Query balances as a group member
        const aliceClient = authenticateAs(alice);
        const { data: balances, error } = await aliceClient
          .from("balances")
          .select("*")
          .eq("group_id", groupId)
          .neq("amount_cents", 0);

        expect(error).toBeNull();
        expect(balances).toHaveLength(2); // Bob→Alice and Carol→Alice
      });

      it("returns specific balance between two users", async () => {
        await createAndActivateExpense({
          groupId,
          creatorId: alice.id,
          creatorToken: alice.accessToken!,
          totalAmount: 4000,
          shares: [
            { userId: alice.id, amount: 2000 },
            { userId: bob.id, amount: 2000 },
          ],
          payers: [{ userId: alice.id, amount: 4000 }],
        });

        const [userA, userB] =
          alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];

        const aliceClient = authenticateAs(alice);
        const { data: balance, error } = await aliceClient
          .from("balances")
          .select("*")
          .eq("group_id", groupId)
          .eq("user_a", userA)
          .eq("user_b", userB)
          .maybeSingle();

        expect(error).toBeNull();
        expect(balance).not.toBeNull();
        expect(Math.abs(balance!.amount_cents)).toBe(2000);
      });
    });

    describe("settlements table operations", () => {

      it("queries settlement history between two users", async () => {
        // Create settlements in both directions
        await adminClient!.from("settlements").insert([
          {
            group_id: groupId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 2000,
          },
          {
            group_id: groupId,
            from_user_id: alice.id,
            to_user_id: bob.id,
            amount_cents: 1000,
          },
          {
            group_id: groupId,
            from_user_id: carol.id,
            to_user_id: alice.id,
            amount_cents: 500,
          },
        ]);

        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient
          .from("settlements")
          .select("*")
          .eq("group_id", groupId)
          .or(
            `and(from_user_id.eq.${alice.id},to_user_id.eq.${bob.id}),and(from_user_id.eq.${bob.id},to_user_id.eq.${alice.id})`,
          )
          .order("created_at", { ascending: false });

        expect(error).toBeNull();
        // Should return only Alice↔Bob settlements, not Carol's
        expect(data).toHaveLength(2);
      });

      it("queries pending settlements for a user", async () => {
        await adminClient!.from("settlements").insert([
          {
            group_id: groupId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 2000,
            status: "pending",
          },
          {
            group_id: groupId,
            from_user_id: carol.id,
            to_user_id: alice.id,
            amount_cents: 1000,
            status: "pending",
          },
          {
            group_id: groupId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 500,
            status: "confirmed",
          },
        ]);

        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient
          .from("settlements")
          .select("*")
          .eq("group_id", groupId)
          .eq("to_user_id", alice.id)
          .eq("status", "pending");

        expect(error).toBeNull();
        expect(data).toHaveLength(2); // Only the pending ones
      });
    });

    describe("confirm_settlement end-to-end", () => {
      it("full flow: expense → settlement → confirmation → balance update", async () => {
        // Alice pays 8000, split equally (4000 each)
        await createAndActivateExpense({
          groupId,
          creatorId: alice.id,
          creatorToken: alice.accessToken!,
          totalAmount: 8000,
          shares: [
            { userId: alice.id, amount: 4000 },
            { userId: bob.id, amount: 4000 },
          ],
          payers: [{ userId: alice.id, amount: 8000 }],
        });

        // Seed Bob's historical pending settlement of 4000.
        const { data: settlement } = await adminClient!
          .from("settlements")
          .insert({
            group_id: groupId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 4000,
          })
          .select()
          .single();

        // Alice confirms
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc(
          "confirm_settlement" as never,
          { p_settlement_id: settlement!.id } as never,
        );
        expect(error).toBeNull();

        // Balance should be zero
        const { data: balances } = await aliceClient
          .from("balances")
          .select("*")
          .eq("group_id", groupId)
          .neq("amount_cents", 0);

        expect(balances).toHaveLength(0);
      });

      it("rejects confirm_settlement when the confirmer has been removed from the group", async () => {
        // Use bob as the group creator so alice can be fully removed.
        // my_accepted_group_ids() also returns groups where creator_id = auth.uid(),
        // so removing the creator's group_members row would not block them.
        const { data: isolatedGroup } = await adminClient!
          .from("groups")
          .insert({ name: "Isolated group", creator_id: bob.id })
          .select("id")
          .single();
        const isolatedGroupId = isolatedGroup!.id;

        await adminClient!.from("group_members").insert([
          {
            group_id: isolatedGroupId,
            user_id: bob.id,
            status: "accepted",
            invited_by: bob.id,
          },
          {
            group_id: isolatedGroupId,
            user_id: alice.id,
            status: "accepted",
            invited_by: bob.id,
          },
        ]);

        // Alice pays 8000, bob owes alice 4000
        await createAndActivateExpense({
          groupId: isolatedGroupId,
          creatorId: alice.id,
          creatorToken: alice.accessToken!,
          totalAmount: 8000,
          shares: [
            { userId: alice.id, amount: 4000 },
            { userId: bob.id, amount: 4000 },
          ],
          payers: [{ userId: alice.id, amount: 8000 }],
        });

        // Read the balance before the settlement attempt
        const [userA, userB] =
          alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];
        const { data: balanceBefore } = await adminClient!
          .from("balances")
          .select("amount_cents")
          .eq("group_id", isolatedGroupId)
          .eq("user_a", userA)
          .eq("user_b", userB)
          .single();
        const amountBefore = balanceBefore!.amount_cents;

        // Seed Bob's historical pending settlement to Alice.
        const { data: settlement } = await adminClient!
          .from("settlements")
          .insert({
            group_id: isolatedGroupId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 4000,
          })
          .select()
          .single();

        // Admin removes alice from the group (alice is NOT the creator, so this
        // fully revokes her my_accepted_group_ids() membership)
        await adminClient!
          .from("group_members")
          .delete()
          .eq("group_id", isolatedGroupId)
          .eq("user_id", alice.id);

        // Alice tries to confirm — she is no longer a group member
        const aliceClient = authenticateAs(alice);
        const { error: confirmError } = await aliceClient.rpc(
          "confirm_settlement" as never,
          { p_settlement_id: settlement!.id } as never,
        );

        expect(confirmError).not.toBeNull();
        expect(confirmError!.message).toMatch(/permission_denied/);

        // Balance must be unchanged
        const { data: balanceAfter } = await adminClient!
          .from("balances")
          .select("amount_cents")
          .eq("group_id", isolatedGroupId)
          .eq("user_a", userA)
          .eq("user_b", userB)
          .single();

        expect(balanceAfter!.amount_cents).toBe(amountBefore);
      });

      it("rejects confirm_settlement when the debtor has been removed from the group", async () => {
        const [debtor, creditor] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(creditor, [debtor]);

        await adminClient!.from("balances").upsert({
          group_id: group.id,
          user_a: debtor.id < creditor.id ? debtor.id : creditor.id,
          user_b: debtor.id < creditor.id ? creditor.id : debtor.id,
          amount_cents: debtor.id < creditor.id ? 3000 : -3000,
        });

        const { data: settlement } = await adminClient!
          .from("settlements")
          .insert({
            group_id: group.id,
            from_user_id: debtor.id,
            to_user_id: creditor.id,
            amount_cents: 3000,
          })
          .select()
          .single();

        await adminClient!
          .from("group_members")
          .delete()
          .eq("group_id", group.id)
          .eq("user_id", debtor.id);

        const creditorClient = authenticateAs(creditor);
        const { error: confirmError } = await creditorClient.rpc(
          "confirm_settlement" as never,
          { p_settlement_id: settlement!.id } as never,
        );

        expect(confirmError).not.toBeNull();
        expect(confirmError!.message).toMatch(/permission_denied.*debtor/);
      });
    });
  },
);
