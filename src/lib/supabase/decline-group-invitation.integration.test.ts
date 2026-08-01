import { describe, it, expect, beforeAll } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  createTestUsers,
  createTestGroupWithMembers,
  authenticateAs,
  createAndActivateExpense,
  settleDebt,
  getBalanceBetween,
  type TestUser,
} from "@/test/integration-helpers";

describe.skipIf(!isIntegrationTestReady)(
  "decline_group_invitation RPC (issue #499)",
  () => {
    // ──────────────────────────────────────────────
    // Invited member with zero balance can decline
    // ──────────────────────────────────────────────
    describe("invited member with zero balance", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, []);
        groupId = group.id;
        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: bob.id,
          status: "invited",
          invited_by: alice.id,
        });
      });

      it("can decline the invitation", async () => {
        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc("decline_group_invitation", {
          p_group_id: groupId,
        });
        expect(error).toBeNull();

        const { data: membership } = await adminClient!
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .eq("user_id", bob.id)
          .maybeSingle();
        expect(membership).toBeNull();
      });
    });

    // ──────────────────────────────────────────────
    // Invited debtor is blocked, retains the invitation
    // ──────────────────────────────────────────────
    describe("invited debtor", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, []);
        groupId = group.id;
        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: bob.id,
          status: "invited",
          invited_by: alice.id,
        });

        // Alice pays, invited Bob owes a real 5000-cent share.
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

      it("is blocked from declining, and the invitation is byte-for-byte retained", async () => {
        const balanceBefore = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balanceBefore).toBe(5000);

        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc("decline_group_invitation", {
          p_group_id: groupId,
        });
        expect(error).not.toBeNull();
        expect(error!.message).toContain("has_outstanding_balance");

        const { data: membership } = await adminClient!
          .from("group_members")
          .select("status")
          .eq("group_id", groupId)
          .eq("user_id", bob.id)
          .single();
        expect(membership!.status).toBe("invited");

        const balanceAfter = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balanceAfter).toBe(5000);
      });

      it("can decline once the remaining party settles with them", async () => {
        // The remaining party (alice) has a supported path to settle
        // with the still-invited bob, per the issue's fourth criterion.
        await settleDebt({
          caller: alice,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 5000,
        });

        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc("decline_group_invitation", {
          p_group_id: groupId,
        });
        expect(error).toBeNull();

        const { data: membership } = await adminClient!
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .eq("user_id", bob.id)
          .maybeSingle();
        expect(membership).toBeNull();
      });
    });

    // ──────────────────────────────────────────────
    // Invited creditor (payer) is also blocked
    // ──────────────────────────────────────────────
    describe("invited creditor (payer)", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, []);
        groupId = group.id;
        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: bob.id,
          status: "invited",
          invited_by: alice.id,
        });

        // Invited Bob pays the whole expense; alice owes him back 5000.
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 5000 },
            { userId: bob.id, amount: 5000 },
          ],
          payers: [{ userId: bob.id, amount: 10000 }],
        });
      });

      it("is blocked from declining while owed money", async () => {
        // Alice owes Bob 5000 (Bob is the creditor).
        const balance = await getBalanceBetween(groupId, alice.id, bob.id);
        expect(balance).toBe(5000);

        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc("decline_group_invitation", {
          p_group_id: groupId,
        });
        expect(error).not.toBeNull();
        expect(error!.message).toContain("has_outstanding_balance");

        const { data: membership } = await adminClient!
          .from("group_members")
          .select("status")
          .eq("group_id", groupId)
          .eq("user_id", bob.id)
          .single();
        expect(membership!.status).toBe("invited");
      });
    });

    // ──────────────────────────────────────────────
    // Accepted member cannot use decline_group_invitation
    // ──────────────────────────────────────────────
    describe("accepted member", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;
      });

      it("cannot decline an already-accepted membership", async () => {
        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc("decline_group_invitation", {
          p_group_id: groupId,
        });
        expect(error).not.toBeNull();
        expect(error!.message).toContain("not_invited");

        const { data: membership } = await adminClient!
          .from("group_members")
          .select("status")
          .eq("group_id", groupId)
          .eq("user_id", bob.id)
          .single();
        expect(membership!.status).toBe("accepted");
      });
    });

    // ──────────────────────────────────────────────
    // Non-member cannot decline
    // ──────────────────────────────────────────────
    describe("non-member", () => {
      it("cannot decline a group they were never invited to", async () => {
        const [alice, carol] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, []);

        const carolClient = authenticateAs(carol);
        const { error } = await carolClient.rpc("decline_group_invitation", {
          p_group_id: group.id,
        });
        expect(error).not.toBeNull();
        expect(error!.message).toContain("not_a_member");
      });
    });

    // ──────────────────────────────────────────────
    // Direct client DELETE is locked down
    // ──────────────────────────────────────────────
    describe("direct client DELETE", () => {
      it("can no longer decline by deleting the group_members row directly", async () => {
        const [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, []);
        await adminClient!.from("group_members").insert({
          group_id: group.id,
          user_id: bob.id,
          status: "invited",
          invited_by: alice.id,
        });

        const bobClient = authenticateAs(bob);
        const { error, count } = await bobClient
          .from("group_members")
          .delete({ count: "exact" })
          .eq("group_id", group.id)
          .eq("user_id", bob.id);

        // RLS denies the row (no error is raised by PostgREST for a
        // DELETE matching zero rows under RLS — it just affects nothing).
        expect(error).toBeNull();
        expect(count).toBe(0);

        const { data: membership } = await adminClient!
          .from("group_members")
          .select("status")
          .eq("group_id", group.id)
          .eq("user_id", bob.id)
          .single();
        expect(membership!.status).toBe("invited");
      });
    });
  },
);
