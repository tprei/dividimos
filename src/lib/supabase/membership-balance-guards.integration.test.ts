import { describe, it, expect, beforeAll } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  createTestUsers,
  createTestUser,
  createTestGroupWithMembers,
  authenticateAs,
  createAndActivateExpense,
  settleDebt,
  getBalanceBetween,
  acceptGroupInvite,
  type TestUser,
} from "@/test/integration-helpers";

/**
 * Membership + balance guard integration tests.
 *
 * Validates the remove_group_member and leave_group RPCs enforce balance
 * checks, the fixed record_and_settle membership check, and edge cases
 * around expense activation and re-addition after removal.
 */

describe.skipIf(!isIntegrationTestReady)(
  "Membership + balance guards",
  () => {
    // ──────────────────────────────────────────────────────
    // remove_group_member RPC — balance enforcement
    // ──────────────────────────────────────────────────────
    describe("remove_group_member blocks removal with outstanding balances", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;

        // bob owes alice 5000 (alice pays, bob consumes)
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [{ userId: bob.id, amount: 5000 }],
          payers: [{ userId: alice.id, amount: 5000 }],
        });
      });

      it("blocks removal when member owes money (positive balance)", async () => {
        const balance = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balance).toBe(5000);

        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: bob.id,
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("has_outstanding_balance");
      });

      it("blocks removal when member is owed money (negative balance)", async () => {
        // Create another group where bob is owed money
        const [alice2, bob2] = await createTestUsers(2);
        const group2 = await createTestGroupWithMembers(alice2, [bob2]);

        // bob2 pays, alice2 consumes → alice2 owes bob2
        await createAndActivateExpense({
          creator: alice2,
          groupId: group2.id,
          shares: [{ userId: alice2.id, amount: 3000 }],
          payers: [{ userId: bob2.id, amount: 3000 }],
        });

        const balance = await getBalanceBetween(group2.id, alice2.id, bob2.id);
        expect(balance).toBeGreaterThan(0);

        // Try to remove bob2 who is owed money
        const creatorClient = authenticateAs(alice2);
        const { error } = await creatorClient.rpc("remove_group_member", {
          p_group_id: group2.id,
          p_user_id: bob2.id,
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("has_outstanding_balance");
      });

      it("allows removal after debt is fully settled", async () => {
        // Settle bob's debt to alice
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 5000,
        });

        const balance = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balance).toBe(0);

        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: bob.id,
        });

        expect(error).toBeNull();

        // Verify bob is gone
        const { data } = await adminClient!
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .eq("user_id", bob.id);

        expect(data).toHaveLength(0);
      });
    });

    describe("remove_group_member allows removal with no balance rows", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;
        // No expenses created — no balance rows exist
      });

      it("removes member who has never had any expenses", async () => {
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: bob.id,
        });

        expect(error).toBeNull();

        const { data } = await adminClient!
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .eq("user_id", bob.id);

        expect(data).toHaveLength(0);
      });
    });

    describe("remove_group_member allows removal with zero balance rows", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;

        // Create and fully settle a debt so a zero-balance row exists
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [{ userId: bob.id, amount: 2000 }],
          payers: [{ userId: alice.id, amount: 2000 }],
        });
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 2000,
        });
      });

      it("balance row exists but is zero", async () => {
        const balance = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balance).toBe(0);
      });

      it("removes member with zero-balance row", async () => {
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: bob.id,
        });

        expect(error).toBeNull();
      });
    });

    // ──────────────────────────────────────────────────────
    // remove_group_member RPC — permission checks
    // ──────────────────────────────────────────────────────
    describe("remove_group_member permission checks", () => {
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
        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: carol.id,
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("permission_denied");
      });

      it("creator cannot remove themselves", async () => {
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: alice.id,
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("cannot remove the group creator");
      });

      it("removing non-existent member returns member_not_found", async () => {
        const outsider = await createTestUser({ name: "Outsider" });
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: outsider.id,
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("member_not_found");
      });

      it("removing from non-existent group returns group_not_found", async () => {
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc("remove_group_member", {
          p_group_id: "00000000-0000-0000-0000-000000000000",
          p_user_id: bob.id,
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("group_not_found");
      });
    });

    // ──────────────────────────────────────────────────────
    // Double removal idempotency
    // ──────────────────────────────────────────────────────
    describe("double removal via RPC", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;
      });

      it("first removal succeeds, second returns member_not_found", async () => {
        const aliceClient = authenticateAs(alice);

        const { error: first } = await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: bob.id,
        });
        expect(first).toBeNull();

        const { error: second } = await aliceClient.rpc(
          "remove_group_member",
          {
            p_group_id: groupId,
            p_user_id: bob.id,
          },
        );
        expect(second).not.toBeNull();
        expect(second!.message).toContain("member_not_found");
      });
    });

    // ──────────────────────────────────────────────────────
    // record_and_settle — invited member is now blocked
    // ──────────────────────────────────────────────────────
    describe("record_and_settle requires accepted membership", () => {
      let alice: TestUser;
      let bob: TestUser;
      let invitee: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob, invitee] = await createTestUsers(3);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;

        // Invite but don't accept
        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: invitee.id,
          status: "invited",
          invited_by: alice.id,
        });

        // Create a balance between alice and bob
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [{ userId: bob.id, amount: 5000 }],
          payers: [{ userId: alice.id, amount: 5000 }],
        });
      });

      it("invited member cannot call record_and_settle", async () => {
        // Seed a balance row for invitee via admin so the only blocker is membership
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
        const { error } = await client.rpc("record_and_settle", {
          p_group_id: groupId,
          p_from_user_id: invitee.id,
          p_to_user_id: alice.id,
          p_amount_cents: 1000,
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("permission_denied");
      });

      it("accepted member can call record_and_settle", async () => {
        const { data, error } = await authenticateAs(bob).rpc(
          "record_and_settle",
          {
            p_group_id: groupId,
            p_from_user_id: bob.id,
            p_to_user_id: alice.id,
            p_amount_cents: 1000,
          },
        );

        expect(error).toBeNull();
        expect(data).toBeDefined();
      });

      it("removed member cannot call record_and_settle", async () => {
        // Create a fresh group to test removal
        const [creator, member] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(creator, [member]);

        await createAndActivateExpense({
          creator,
          groupId: group.id,
          shares: [{ userId: member.id, amount: 4000 }],
          payers: [{ userId: creator.id, amount: 4000 }],
        });

        // Settle fully so removal is allowed
        await settleDebt({
          caller: member,
          groupId: group.id,
          fromUserId: member.id,
          toUserId: creator.id,
          amountCents: 4000,
        });

        // Remove member
        const creatorClient = authenticateAs(creator);
        const { error: removeErr } = await creatorClient.rpc(
          "remove_group_member",
          { p_group_id: group.id, p_user_id: member.id },
        );
        expect(removeErr).toBeNull();

        // Seed a balance row via admin so the only blocker is membership
        const [a, b] =
          member.id < creator.id
            ? [member.id, creator.id]
            : [creator.id, member.id];
        await adminClient!.from("balances").upsert({
          group_id: group.id,
          user_a: a,
          user_b: b,
          amount_cents: member.id < creator.id ? 2000 : -2000,
        });

        const memberClient = authenticateAs(member);
        const { error } = await memberClient.rpc("record_and_settle", {
          p_group_id: group.id,
          p_from_user_id: member.id,
          p_to_user_id: creator.id,
          p_amount_cents: 1000,
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("permission_denied");
      });
    });

    // ──────────────────────────────────────────────────────
    // Re-addition after removal
    // ──────────────────────────────────────────────────────
    describe("re-adding a removed member", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;

        // Create debt, settle fully, then remove
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [{ userId: bob.id, amount: 6000 }],
          payers: [{ userId: alice.id, amount: 6000 }],
        });
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 6000,
        });

        const aliceClient = authenticateAs(alice);
        await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: bob.id,
        });
      });

      it("re-invited and re-accepted member can participate normally", async () => {
        // Re-invite
        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: bob.id,
          status: "invited",
          invited_by: alice.id,
        });
        await acceptGroupInvite(bob, groupId);

        // Bob can now be included in new expenses
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [{ userId: bob.id, amount: 3000 }],
          payers: [{ userId: alice.id, amount: 3000 }],
        });

        const balance = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balance).toBe(3000);

        // Bob can settle
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 3000,
        });

        const balanceAfter = await getBalanceBetween(
          groupId,
          bob.id,
          alice.id,
        );
        expect(balanceAfter).toBe(0);
      });
    });

    // ──────────────────────────────────────────────────────
    // Direct DELETE on group_members is blocked by RLS
    // ──────────────────────────────────────────────────────
    describe("direct DELETE on group_members is blocked", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;
      });

      it("creator cannot bypass balance check via direct DELETE", async () => {
        const aliceClient = authenticateAs(alice);
        const { data } = await aliceClient
          .from("group_members")
          .delete()
          .eq("group_id", groupId)
          .eq("user_id", bob.id)
          .select();

        // RLS policy is USING(false) — no rows match, so delete is a no-op
        expect(data).toHaveLength(0);

        // Bob is still a member
        const { data: check } = await adminClient!
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .eq("user_id", bob.id);

        expect(check).toHaveLength(1);
      });
    });

    // ──────────────────────────────────────────────────────
    // Expense activation with removed member in shares
    // ──────────────────────────────────────────────────────
    describe("expense activation with non-member shares", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob, carol] = await createTestUsers(3);
        const group = await createTestGroupWithMembers(alice, [bob, carol]);
        groupId = group.id;

        // Remove carol (no expenses, so no balance check needed)
        const aliceClient = authenticateAs(alice);
        await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: carol.id,
        });
      });

      it("activate_expense with removed member in shares — documents behavior", async () => {
        // Create a draft expense via admin with removed carol in shares
        const { data: expense } = await adminClient!
          .from("expenses")
          .insert({
            group_id: groupId,
            creator_id: alice.id,
            title: "Includes removed member",
            expense_type: "single_amount",
            total_amount: 6000,
            status: "draft",
          })
          .select("id")
          .single();

        await Promise.all([
          adminClient!.from("expense_shares").insert([
            {
              expense_id: expense!.id,
              user_id: alice.id,
              share_amount_cents: 2000,
            },
            {
              expense_id: expense!.id,
              user_id: bob.id,
              share_amount_cents: 2000,
            },
            {
              expense_id: expense!.id,
              user_id: carol.id,
              share_amount_cents: 2000,
            },
          ]),
          adminClient!.from("expense_payers").insert({
            expense_id: expense!.id,
            user_id: alice.id,
            amount_cents: 6000,
          }),
        ]);

        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc("activate_expense", {
          p_expense_id: expense!.id,
        });

        // activate_expense uses my_group_ids() for membership check of the creator,
        // but does NOT validate that share/payer users are group members.
        // This documents the current behavior — carol's share is accepted and
        // a balance is created for her even though she's not a member.
        // This is a known limitation that could be tightened in the future.
        if (error) {
          // If this now fails, the validation was added — great!
          expect(error.message).toBeDefined();
        } else {
          // Current behavior: activation succeeds
          // Carol gets a balance row even though she's not a member
          const balance = await getBalanceBetween(
            groupId,
            carol.id,
            alice.id,
          );
          expect(balance).toBeGreaterThan(0);
        }

        // Cleanup
        await adminClient!.from("expenses").delete().eq("id", expense!.id);
      });
    });

    // ──────────────────────────────────────────────────────
    // Creator fallback in my_accepted_group_ids
    // ──────────────────────────────────────────────────────
    describe("creator without explicit group_members row", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;
      });

      it("creator can operate even if group_members row is missing (creator_id fallback)", async () => {
        // Remove alice's group_members row directly via admin
        // (simulating a buggy state where creator row was deleted)
        await adminClient!
          .from("group_members")
          .delete()
          .eq("group_id", groupId)
          .eq("user_id", alice.id);

        // my_accepted_group_ids includes groups where user is creator_id
        // so alice should still be able to see expenses and settle
        const aliceClient = authenticateAs(alice);
        const { data: expenses } = await aliceClient
          .from("expenses")
          .select("id")
          .eq("group_id", groupId);

        // Creator should still have access via the creator_id fallback
        // in my_accepted_group_ids()
        expect(expenses).toBeDefined();

        // Creator can still call record_and_settle
        // First create a debt
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [{ userId: bob.id, amount: 2000 }],
          payers: [{ userId: alice.id, amount: 2000 }],
        });

        const { error } = await aliceClient.rpc("record_and_settle", {
          p_group_id: groupId,
          p_from_user_id: bob.id,
          p_to_user_id: alice.id,
          p_amount_cents: 500,
        });

        // If the fallback works, this should succeed (alice is caller = to_user)
        expect(error).toBeNull();
      });
    });

    // ──────────────────────────────────────────────────────
    // leave_group cleans up zero-balance rows
    // ──────────────────────────────────────────────────────
    describe("leave_group zero-balance cleanup", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob, carol] = await createTestUsers(3);
        const group = await createTestGroupWithMembers(alice, [bob, carol]);
        groupId = group.id;

        // Create expenses involving bob with both alice and carol
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [{ userId: bob.id, amount: 3000 }],
          payers: [{ userId: alice.id, amount: 3000 }],
        });
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [{ userId: bob.id, amount: 2000 }],
          payers: [{ userId: carol.id, amount: 2000 }],
        });

        // Settle both debts fully
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 3000,
        });
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: carol.id,
          amountCents: 2000,
        });
      });

      it("zero-balance rows are cleaned up after leaving", async () => {
        // Verify zero-balance rows exist before leaving
        const { data: beforeRows } = await adminClient!
          .from("balances")
          .select("*")
          .eq("group_id", groupId)
          .or(`user_a.eq.${bob.id},user_b.eq.${bob.id}`);

        expect(beforeRows!.length).toBeGreaterThanOrEqual(1);
        expect(beforeRows!.every((r) => r.amount_cents === 0)).toBe(true);

        // Bob leaves
        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc("leave_group", {
          p_group_id: groupId,
        });
        expect(error).toBeNull();

        // Zero-balance rows should be gone
        const { data: afterRows } = await adminClient!
          .from("balances")
          .select("*")
          .eq("group_id", groupId)
          .or(`user_a.eq.${bob.id},user_b.eq.${bob.id}`);

        expect(afterRows).toHaveLength(0);
      });
    });

    // ──────────────────────────────────────────────────────
    // Multi-member removal: partial removal in 3+ person group
    // ──────────────────────────────────────────────────────
    describe("partial member removal in multi-member group", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob, carol] = await createTestUsers(3);
        const group = await createTestGroupWithMembers(alice, [bob, carol]);
        groupId = group.id;

        // alice pays for both bob and carol
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: bob.id, amount: 3000 },
            { userId: carol.id, amount: 3000 },
          ],
          payers: [{ userId: alice.id, amount: 6000 }],
        });
      });

      it("removing one debtor does not affect other debtor's balance", async () => {
        const bobBalance = await getBalanceBetween(groupId, bob.id, alice.id);
        const carolBalance = await getBalanceBetween(
          groupId,
          carol.id,
          alice.id,
        );
        expect(bobBalance).toBe(3000);
        expect(carolBalance).toBe(3000);

        // Settle bob's debt and remove him
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 3000,
        });

        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: bob.id,
        });
        expect(error).toBeNull();

        // Carol's balance should be unchanged
        const carolBalanceAfter = await getBalanceBetween(
          groupId,
          carol.id,
          alice.id,
        );
        expect(carolBalanceAfter).toBe(3000);
      });
    });

    // ──────────────────────────────────────────────────────
    // Pending settlement cleanup on member removal
    // ──────────────────────────────────────────────────────
    describe("pending settlements and member removal", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;
      });

      it("pending settlements from removed member persist in database", async () => {
        // Create a pending settlement via direct insert (simulating old two-step flow)
        await adminClient!.from("settlements").insert({
          group_id: groupId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 1000,
          status: "pending",
        });

        // Remove bob (no outstanding balances)
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: bob.id,
        });
        expect(error).toBeNull();

        // The pending settlement row still exists (no cascade on group_members delete)
        const { data: settlements } = await adminClient!
          .from("settlements")
          .select("*")
          .eq("group_id", groupId)
          .eq("from_user_id", bob.id)
          .eq("status", "pending");

        // Document current behavior: settlements are not cleaned up
        expect(settlements!.length).toBeGreaterThanOrEqual(1);
      });
    });

    // ──────────────────────────────────────────────────────
    // Removal of invited member (no balance possible)
    // ──────────────────────────────────────────────────────
    describe("removing invited (not accepted) member", () => {
      let alice: TestUser;
      let invitee: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, invitee] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, []);
        groupId = group.id;

        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: invitee.id,
          status: "invited",
          invited_by: alice.id,
        });
      });

      it("creator can remove an invited member", async () => {
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: invitee.id,
        });

        expect(error).toBeNull();

        const { data } = await adminClient!
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .eq("user_id", invitee.id);

        expect(data).toHaveLength(0);
      });
    });
  },
);
