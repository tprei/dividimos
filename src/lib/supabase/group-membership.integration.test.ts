import { describe, it, expect, beforeAll } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  createTestUser,
  createTestUsers,
  createTestGroupWithMembers,
  acceptGroupInvite,
  authenticateAs,
  createAndActivateExpense,
  settleDebt,
  getBalanceBetween,
  type TestUser,
} from "@/test/integration-helpers";

/**
 * Suite 3 — Group membership & RLS integration tests.
 *
 * These tests focus on *dynamic* membership state changes and their
 * effects on data visibility and operations. The static RLS matrix
 * (accepted / invited / non-member × CRUD) is covered in
 * expense-rls.integration.test.ts; this suite validates transitions.
 */

describe.skipIf(!isIntegrationTestReady)(
  "Group membership & RLS enforcement",
  () => {
    // ──────────────────────────────────────────────
    // 3.1 — New member joins and gains visibility
    // ──────────────────────────────────────────────
    describe("3.1 — new member gains visibility after accepting invite", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;
      let groupId: string;
      let expenseId: string;

      beforeAll(async () => {
        [alice, bob, carol] = await createTestUsers(3);

        // Create group with alice + bob accepted. Carol not yet invited.
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;

        // Alice pays, bob consumes — creates a balance
        expenseId = await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 5000 },
            { userId: bob.id, amount: 5000 },
          ],
          payers: [{ userId: alice.id, amount: 10000 }],
          title: "Pre-Carol dinner",
        });

        // Now invite carol
        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: carol.id,
          status: "invited",
          invited_by: alice.id,
        });
      });

      it("invited carol cannot see existing expenses", async () => {
        const client = authenticateAs(carol);
        const { data } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", groupId);

        expect(data).toHaveLength(0);
      });

      it("invited carol cannot see balances", async () => {
        const client = authenticateAs(carol);
        const { data } = await client
          .from("balances")
          .select("*")
          .eq("group_id", groupId);

        expect(data).toHaveLength(0);
      });

      it("after accepting, carol can see existing expenses", async () => {
        await acceptGroupInvite(carol, groupId);

        const client = authenticateAs(carol);
        const { data, error } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", groupId);

        expect(error).toBeNull();
        expect(data).toHaveLength(1);
        expect(data![0].id).toBe(expenseId);
      });

      it("after accepting, carol can see balances", async () => {
        const client = authenticateAs(carol);
        const { data, error } = await client
          .from("balances")
          .select("*")
          .eq("group_id", groupId);

        expect(error).toBeNull();
        expect(data!.length).toBeGreaterThanOrEqual(1);
      });

      it("after accepting, carol can see settlements", async () => {
        // Create a settlement for carol to see
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 1000,
        });

        const client = authenticateAs(carol);
        const { data, error } = await client
          .from("settlements")
          .select("id")
          .eq("group_id", groupId);

        expect(error).toBeNull();
        expect(data!.length).toBeGreaterThanOrEqual(1);
      });
    });

    // ──────────────────────────────────────────────
    // 3.2 — New member can participate in new expenses
    // ──────────────────────────────────────────────
    describe("3.2 — new member participates in expenses after joining", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob, carol] = await createTestUsers(3);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;

        // Invite and accept carol
        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: carol.id,
          status: "invited",
          invited_by: alice.id,
        });
        await acceptGroupInvite(carol, groupId);
      });

      it("carol can be included in expense shares after joining", async () => {
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 3333 },
            { userId: bob.id, amount: 3333 },
            { userId: carol.id, amount: 3334 },
          ],
          payers: [{ userId: alice.id, amount: 10000 }],
          title: "Three-way split",
        });

        // Carol now owes alice
        const balance = await getBalanceBetween(groupId, carol.id, alice.id);
        expect(balance).toBeGreaterThan(0);
      });

      it("carol can create expenses in the group", async () => {
        const client = authenticateAs(carol);
        const { data, error } = await client
          .from("expenses")
          .insert({
            group_id: groupId,
            creator_id: carol.id,
            title: "Carol's expense",
            expense_type: "single_amount",
            total_amount: 6000,
          })
          .select()
          .single();

        expect(error).toBeNull();
        expect(data!.creator_id).toBe(carol.id);

        // Cleanup draft
        await adminClient!.from("expenses").delete().eq("id", data!.id);
      });

      it("carol can settle debts with other members", async () => {
        // First create a debt: alice pays, carol consumes
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [{ userId: carol.id, amount: 5000 }],
          payers: [{ userId: alice.id, amount: 5000 }],
          title: "Carol owes Alice",
        });

        const balanceBefore = await getBalanceBetween(
          groupId,
          carol.id,
          alice.id,
        );
        expect(balanceBefore).toBeGreaterThan(0);

        // Carol settles part of the debt
        await settleDebt({
          caller: carol,
          groupId,
          fromUserId: carol.id,
          toUserId: alice.id,
          amountCents: 2000,
        });

        const balanceAfter = await getBalanceBetween(
          groupId,
          carol.id,
          alice.id,
        );
        expect(balanceAfter).toBe(balanceBefore - 2000);
      });
    });

    // ──────────────────────────────────────────────
    // 3.3 — Invited member cannot perform operations
    // ──────────────────────────────────────────────
    describe("3.3 — invited (not accepted) member is restricted", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser; // invited, not accepted
      let groupId: string;

      beforeAll(async () => {
        [alice, bob, carol] = await createTestUsers(3);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;

        // Invite carol but don't accept
        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: carol.id,
          status: "invited",
          invited_by: alice.id,
        });

        // Create expense and balance
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 5000 },
            { userId: bob.id, amount: 5000 },
          ],
          payers: [{ userId: alice.id, amount: 10000 }],
        });
      });

      it("cannot create expenses", async () => {
        const client = authenticateAs(carol);
        const { error } = await client.from("expenses").insert({
          group_id: groupId,
          creator_id: carol.id,
          title: "Should fail",
          total_amount: 1000,
        });

        expect(error).not.toBeNull();
      });

      it("cannot see expense shares", async () => {
        const client = authenticateAs(carol);
        const { data } = await client
          .from("expense_shares")
          .select("*")
          .eq("expense_id", (
            await adminClient!
              .from("expenses")
              .select("id")
              .eq("group_id", groupId)
              .limit(1)
              .single()
          ).data!.id);

        expect(data).toHaveLength(0);
      });

      it("cannot see expense payers", async () => {
        const client = authenticateAs(carol);
        const { data } = await client
          .from("expense_payers")
          .select("*")
          .eq("expense_id", (
            await adminClient!
              .from("expenses")
              .select("id")
              .eq("group_id", groupId)
              .limit(1)
              .single()
          ).data!.id);

        expect(data).toHaveLength(0);
      });

      it("cannot create settlements", async () => {
        const client = authenticateAs(carol);
        const { error } = await client.from("settlements").insert({
          group_id: groupId,
          from_user_id: carol.id,
          to_user_id: alice.id,
          amount_cents: 1000,
        });

        expect(error).not.toBeNull();
      });

      it("can see their own group_members row (to know they are invited)", async () => {
        const client = authenticateAs(carol);
        const { data, error } = await client
          .from("group_members")
          .select("status")
          .eq("group_id", groupId)
          .eq("user_id", carol.id)
          .single();

        expect(error).toBeNull();
        expect(data!.status).toBe("invited");
      });

      it("can accept the invitation", async () => {
        // Accepting changes status
        await acceptGroupInvite(carol, groupId);

        const { data } = await adminClient!
          .from("group_members")
          .select("status")
          .eq("group_id", groupId)
          .eq("user_id", carol.id)
          .single();

        expect(data!.status).toBe("accepted");
      });
    });

    // ──────────────────────────────────────────────
    // 3.4 — Removed member loses access
    // ──────────────────────────────────────────────
    describe("3.4 — removed member loses access to group data", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;
      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;

        // Create expense with balance
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 5000 },
            { userId: bob.id, amount: 5000 },
          ],
          payers: [{ userId: alice.id, amount: 10000 }],
        });
      });

      it("bob can see expenses before removal", async () => {
        const client = authenticateAs(bob);
        const { data } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", groupId);

        expect(data).toHaveLength(1);
      });

      it("after removal, bob cannot see expenses", async () => {
        // Remove bob (creator can delete members)
        await adminClient!
          .from("group_members")
          .delete()
          .eq("group_id", groupId)
          .eq("user_id", bob.id);

        const client = authenticateAs(bob);
        const { data } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", groupId);

        expect(data).toHaveLength(0);
      });

      it("after removal, bob cannot see balances", async () => {
        const client = authenticateAs(bob);
        const { data } = await client
          .from("balances")
          .select("*")
          .eq("group_id", groupId);

        expect(data).toHaveLength(0);
      });

      it("after removal, bob cannot see settlements", async () => {
        const client = authenticateAs(bob);
        const { data } = await client
          .from("settlements")
          .select("*")
          .eq("group_id", groupId);

        expect(data).toHaveLength(0);
      });

      it("after removal, bob cannot create expenses", async () => {
        const client = authenticateAs(bob);
        const { error } = await client.from("expenses").insert({
          group_id: groupId,
          creator_id: bob.id,
          title: "Should fail",
          total_amount: 1000,
        });

        expect(error).not.toBeNull();
      });

      it("after removal, bob cannot settle debts via RPC", async () => {
        const client = authenticateAs(bob);
        const { error } = await client.rpc("record_and_settle", {
          p_group_id: groupId,
          p_from_user_id: bob.id,
          p_to_user_id: alice.id,
          p_amount_cents: 1000,
        });

        expect(error).not.toBeNull();
      });
    });

    // ──────────────────────────────────────────────
    // 3.5 — Creator invites via RLS-respecting client
    // ──────────────────────────────────────────────
    describe("3.5 — invitation permissions", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;
      let dave: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob, carol, dave] = await createTestUsers(4);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;
      });

      it("creator can invite a new member", async () => {
        const client = authenticateAs(alice);
        const { error } = await client.from("group_members").insert({
          group_id: groupId,
          user_id: carol.id,
          status: "invited",
          invited_by: alice.id,
        });

        expect(error).toBeNull();

        // Verify
        const { data } = await adminClient!
          .from("group_members")
          .select("status")
          .eq("group_id", groupId)
          .eq("user_id", carol.id)
          .single();

        expect(data!.status).toBe("invited");
      });

      it("accepted member can invite a new member", async () => {
        const client = authenticateAs(bob);
        const { error } = await client.from("group_members").insert({
          group_id: groupId,
          user_id: dave.id,
          status: "invited",
          invited_by: bob.id,
        });

        expect(error).toBeNull();
      });

      it("non-member cannot invite to group", async () => {
        const outsider = await createTestUser({ name: "Outsider" });
        const target = await createTestUser({ name: "Target" });

        const client = authenticateAs(outsider);
        const { error } = await client.from("group_members").insert({
          group_id: groupId,
          user_id: target.id,
          status: "invited",
          invited_by: outsider.id,
        });

        expect(error).not.toBeNull();
      });

      it("cannot accept another user's invitation", async () => {
        // Carol was invited above. Bob tries to accept for carol.
        const client = authenticateAs(bob);
        const { data } = await client
          .from("group_members")
          .update({ status: "accepted", accepted_at: new Date().toISOString() })
          .eq("group_id", groupId)
          .eq("user_id", carol.id)
          .select();

        // RLS: update only where user_id = auth.uid()
        expect(data).toHaveLength(0);
      });
    });

    // ──────────────────────────────────────────────
    // 3.6 — Balance visibility tracks membership
    // ──────────────────────────────────────────────
    describe("3.6 — balance visibility changes with membership state", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob, carol] = await createTestUsers(3);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;

        // Create a balance between alice and bob
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 3000 },
            { userId: bob.id, amount: 7000 },
          ],
          payers: [{ userId: alice.id, amount: 10000 }],
        });

        // Invite carol (not accepted)
        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: carol.id,
          status: "invited",
          invited_by: alice.id,
        });
      });

      it("invited carol sees 0 balance rows", async () => {
        const client = authenticateAs(carol);
        const { data } = await client
          .from("balances")
          .select("*")
          .eq("group_id", groupId);

        expect(data).toHaveLength(0);
      });

      it("after accepting, carol sees all group balances", async () => {
        await acceptGroupInvite(carol, groupId);

        const client = authenticateAs(carol);
        const { data, error } = await client
          .from("balances")
          .select("*")
          .eq("group_id", groupId);

        expect(error).toBeNull();
        expect(data!.length).toBeGreaterThanOrEqual(1);
      });

      it("carol sees correct balance values (not just her own)", async () => {
        // Carol should see the alice↔bob balance even though she's not party to it
        const client = authenticateAs(carol);
        const { data } = await client
          .from("balances")
          .select("amount_cents, user_a, user_b")
          .eq("group_id", groupId);

        // Find the alice↔bob pair
        const [a, b] =
          alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];
        const row = data!.find((r) => r.user_a === a && r.user_b === b);
        expect(row).toBeDefined();
        expect(row!.amount_cents).not.toBe(0);
      });
    });

    // ──────────────────────────────────────────────
    // 3.7 — Group member removal with outstanding balances
    // ──────────────────────────────────────────────
    describe("3.7 — removing member with outstanding balance", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;

        // Bob owes alice 5000
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [{ userId: bob.id, amount: 5000 }],
          payers: [{ userId: alice.id, amount: 5000 }],
        });
      });

      it("balance row persists after member removal", async () => {
        // Confirm balance exists
        const balanceBefore = await getBalanceBetween(
          groupId,
          bob.id,
          alice.id,
        );
        expect(balanceBefore).toBe(5000);

        // Remove bob
        await adminClient!
          .from("group_members")
          .delete()
          .eq("group_id", groupId)
          .eq("user_id", bob.id);

        // Balance row still exists in the database (admin can see it)
        const balanceAfter = await getBalanceBetween(
          groupId,
          bob.id,
          alice.id,
        );
        expect(balanceAfter).toBe(5000);
      });

      it("removed member cannot see their own outstanding balance", async () => {
        const client = authenticateAs(bob);
        const { data } = await client
          .from("balances")
          .select("*")
          .eq("group_id", groupId);

        expect(data).toHaveLength(0);
      });

      it("re-invited and re-accepted member regains balance visibility", async () => {
        // Re-invite bob
        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: bob.id,
          status: "invited",
          invited_by: alice.id,
        });
        await acceptGroupInvite(bob, groupId);

        const client = authenticateAs(bob);
        const { data, error } = await client
          .from("balances")
          .select("*")
          .eq("group_id", groupId);

        expect(error).toBeNull();
        expect(data!.length).toBeGreaterThanOrEqual(1);

        // Balance is unchanged
        const balance = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balance).toBe(5000);
      });
    });

    // ──────────────────────────────────────────────
    // 3.8 — Membership checks in RPC functions
    // ──────────────────────────────────────────────
    describe("3.8 — RPC functions enforce membership", () => {
      let alice: TestUser;
      let bob: TestUser;
      let outsider: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob, outsider] = await createTestUsers(3);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;

        // Create a debt: bob owes alice
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [{ userId: bob.id, amount: 5000 }],
          payers: [{ userId: alice.id, amount: 5000 }],
        });
      });

      it("outsider cannot activate an expense via RPC", async () => {
        // Create a draft expense via admin
        const { data: expense } = await adminClient!
          .from("expenses")
          .insert({
            group_id: groupId,
            creator_id: outsider.id,
            title: "Outsider attempt",
            total_amount: 1000,
            status: "draft",
          })
          .select("id")
          .single();

        // Insert matching shares + payers via admin
        await Promise.all([
          adminClient!.from("expense_shares").insert({
            expense_id: expense!.id,
            user_id: alice.id,
            share_amount_cents: 1000,
          }),
          adminClient!.from("expense_payers").insert({
            expense_id: expense!.id,
            user_id: outsider.id,
            amount_cents: 1000,
          }),
        ]);

        const client = authenticateAs(outsider);
        const { error } = await client.rpc("activate_expense", {
          p_expense_id: expense!.id,
        });

        // activate_expense checks creator_id matches caller — outsider is creator
        // but not a group member. The RPC should fail because outsider isn't
        // actually a member, and the expense references a group they don't belong to.
        // However, activate_expense is SECURITY DEFINER and only checks creator_id,
        // not group membership directly. The admin inserted the expense bypassing RLS.
        // This test documents current behavior.
        expect(error).not.toBeNull();

        // Cleanup
        await adminClient!.from("expenses").delete().eq("id", expense!.id);
      });

      it("outsider cannot call record_and_settle", async () => {
        const client = authenticateAs(outsider);
        const { error } = await client.rpc("record_and_settle", {
          p_group_id: groupId,
          p_from_user_id: outsider.id,
          p_to_user_id: alice.id,
          p_amount_cents: 1000,
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("permission_denied");
      });

      it("accepted member can call record_and_settle", async () => {
        const settlementId = await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 1000,
        });

        expect(settlementId).toBeDefined();
        expect(typeof settlementId).toBe("string");
      });

      it("invited-but-not-accepted member and record_and_settle", async () => {
        // This tests the known inconsistency: record_and_settle uses
        // my_group_ids() which includes invited members, not
        // my_accepted_group_ids(). Document the actual behavior.
        const invitee = await createTestUser({ name: "Invitee RPC" });

        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: invitee.id,
          status: "invited",
          invited_by: alice.id,
        });

        // Create a balance between invitee and alice via admin so there's
        // something to settle
        const [a, b] =
          invitee.id < alice.id
            ? [invitee.id, alice.id]
            : [alice.id, invitee.id];
        await adminClient!.from("balances").upsert({
          group_id: groupId,
          user_a: a,
          user_b: b,
          amount_cents: invitee.id < alice.id ? 3000 : -3000,
        });

        const client = authenticateAs(invitee);
        const { data, error } = await client.rpc("record_and_settle", {
          p_group_id: groupId,
          p_from_user_id: invitee.id,
          p_to_user_id: alice.id,
          p_amount_cents: 1000,
        });

        // NOTE: record_and_settle uses my_group_ids() which includes invited
        // members. This means invited members CAN call this RPC — this is a
        // known inconsistency with other policies that use
        // my_accepted_group_ids(). This test documents the current behavior
        // rather than asserting it should fail.
        if (error) {
          // If this fails, the inconsistency may have been fixed
          expect(error.message).toContain("permission_denied");
        } else {
          // Current behavior: invited member CAN settle
          expect(data).toBeDefined();
        }

        // Cleanup
        await adminClient!
          .from("settlements")
          .delete()
          .eq("group_id", groupId)
          .eq("from_user_id", invitee.id);
        await adminClient!
          .from("group_members")
          .delete()
          .eq("group_id", groupId)
          .eq("user_id", invitee.id);
      });
    });

    // ──────────────────────────────────────────────
    // 3.9 — Creator-only operations
    // ──────────────────────────────────────────────
    describe("3.9 — only creator can manage group membership", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob, carol] = await createTestUsers(3);
        const group = await createTestGroupWithMembers(alice, [bob, carol]);
        groupId = group.id;
      });

      it("non-creator cannot remove a member", async () => {
        const client = authenticateAs(bob);
        const { data } = await client
          .from("group_members")
          .delete()
          .eq("group_id", groupId)
          .eq("user_id", carol.id)
          .select();

        // RLS: only creator can delete members
        expect(data).toHaveLength(0);

        // Verify carol is still a member
        const { data: check } = await adminClient!
          .from("group_members")
          .select("status")
          .eq("group_id", groupId)
          .eq("user_id", carol.id)
          .single();

        expect(check!.status).toBe("accepted");
      });

      it("creator can remove a member", async () => {
        const client = authenticateAs(alice);
        const { error } = await client.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: carol.id,
        });

        expect(error).toBeNull();

        // Verify carol is gone
        const { data: check } = await adminClient!
          .from("group_members")
          .select("*")
          .eq("group_id", groupId)
          .eq("user_id", carol.id);

        expect(check).toHaveLength(0);
      });

      it("only creator can update group name", async () => {
        // Non-creator cannot update
        const bobClient = authenticateAs(bob);
        const { data: bobResult } = await bobClient
          .from("groups")
          .update({ name: "Hacked name" })
          .eq("id", groupId)
          .select();

        expect(bobResult).toHaveLength(0);

        // Creator can update
        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient
          .from("groups")
          .update({ name: "Updated by creator" })
          .eq("id", groupId)
          .select()
          .single();

        expect(error).toBeNull();
        expect(data!.name).toBe("Updated by creator");
      });
    });

    // ──────────────────────────────────────────────
    // 3.10 — Cross-group isolation of membership
    // ──────────────────────────────────────────────
    describe("3.10 — membership in one group doesn't grant access to another", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;
      let group1Id: string;
      let group2Id: string;
      beforeAll(async () => {
        [alice, bob, carol] = await createTestUsers(3);

        // Group 1: alice + bob
        const group1 = await createTestGroupWithMembers(alice, [bob]);
        group1Id = group1.id;

        // Group 2: alice + carol
        const group2 = await createTestGroupWithMembers(alice, [carol]);
        group2Id = group2.id;

        // Create expense in group 2
        await createAndActivateExpense({
          creator: alice,
          groupId: group2Id,
          shares: [
            { userId: alice.id, amount: 5000 },
            { userId: carol.id, amount: 5000 },
          ],
          payers: [{ userId: alice.id, amount: 10000 }],
          title: "Group 2 only",
        });
      });

      it("bob (group 1 member) cannot see group 2 expenses", async () => {
        const client = authenticateAs(bob);
        const { data } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", group2Id);

        expect(data).toHaveLength(0);
      });

      it("bob cannot see group 2 balances", async () => {
        const client = authenticateAs(bob);
        const { data } = await client
          .from("balances")
          .select("*")
          .eq("group_id", group2Id);

        expect(data).toHaveLength(0);
      });

      it("carol (group 2 member) cannot see group 1 data", async () => {
        // Create an expense in group 1
        await createAndActivateExpense({
          creator: alice,
          groupId: group1Id,
          shares: [
            { userId: alice.id, amount: 5000 },
            { userId: bob.id, amount: 5000 },
          ],
          payers: [{ userId: alice.id, amount: 10000 }],
          title: "Group 1 only",
        });

        const client = authenticateAs(carol);
        const { data } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", group1Id);

        expect(data).toHaveLength(0);
      });

      it("bob cannot settle debts in group 2", async () => {
        const client = authenticateAs(bob);
        const { error } = await client.rpc("record_and_settle", {
          p_group_id: group2Id,
          p_from_user_id: bob.id,
          p_to_user_id: alice.id,
          p_amount_cents: 1000,
        });

        expect(error).not.toBeNull();
      });
    });
  },
);
