import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
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

/** Helper: create a draft expense and activate it via RPC. */
async function createAndActivateExpense(opts: {
  groupId: string;
  creatorId: string;
  creatorToken: string;
  totalAmount: number;
  shares: { userId: string; amount: number }[];
  payers: { userId: string; amount: number }[];
}): Promise<string> {
  const { data: expense } = await adminClient!
    .from("expenses")
    .insert({
      group_id: opts.groupId,
      creator_id: opts.creatorId,
      title: "Test expense",
      total_amount: opts.totalAmount,
      expense_type: "single_amount",
    })
    .select()
    .single();

  if (!expense) throw new Error("Failed to create expense");

  await adminClient!.from("expense_shares").insert(
    opts.shares.map((s) => ({
      expense_id: expense.id,
      user_id: s.userId,
      share_amount_cents: s.amount,
    })),
  );

  await adminClient!.from("expense_payers").insert(
    opts.payers.map((p) => ({
      expense_id: expense.id,
      user_id: p.userId,
      amount_cents: p.amount,
    })),
  );

  // Use a mock-free path: call RPC directly with authenticated client
  const client = authenticateAs({
    id: opts.creatorId,
    accessToken: opts.creatorToken,
  } as TestUser);
  const { error } = await client.rpc(
    "activate_expense" as never,
    { p_expense_id: expense.id } as never,
  );
  if (error) throw new Error(`Failed to activate: ${error.message}`);

  return expense.id;
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
      it("inserts a pending settlement", async () => {
        const bobClient = authenticateAs(bob);
        const { data: settlement, error } = await bobClient
          .from("settlements")
          .insert({
            group_id: groupId,
            from_user_id: bob.id,
            to_user_id: alice.id,
            amount_cents: 3000,
          })
          .select()
          .single();

        expect(error).toBeNull();
        expect(settlement!.status).toBe("pending");
        expect(settlement!.from_user_id).toBe(bob.id);
        expect(settlement!.to_user_id).toBe(alice.id);
        expect(settlement!.amount_cents).toBe(3000);
      });

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

        // Bob records a settlement of 4000
        const bobClient = authenticateAs(bob);
        const { data: settlement } = await bobClient
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
    });
  },
);
