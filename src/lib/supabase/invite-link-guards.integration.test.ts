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
  "Invite link + membership guard interactions",
  () => {
    // ──────────────────────────────────────────────────────
    // Member who joined via invite link is subject to the
    // same balance guards as handle-invited members
    // ──────────────────────────────────────────────────────
    describe("member joined via invite link with outstanding balance", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, []);
        groupId = group.id;

        // Create an invite link
        const { data: link } = await adminClient!
          .from("group_invite_links")
          .insert({ group_id: groupId, created_by: alice.id })
          .select("token")
          .single();

        // Bob joins via invite link RPC
        const bobClient = authenticateAs(bob);
        const { error: joinErr } = await bobClient.rpc("join_group_via_link", {
          p_token: link!.token,
        });
        expect(joinErr).toBeNull();

        // Create an expense: alice pays, bob consumes
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [{ userId: bob.id, amount: 5000 }],
          payers: [{ userId: alice.id, amount: 5000 }],
        });
      });

      it("creator cannot remove invite-link member with outstanding balance", async () => {
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

      it("invite-link member cannot leave with outstanding balance", async () => {
        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc("leave_group", {
          p_group_id: groupId,
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("has_outstanding_balance");
      });

      it("invite-link member can leave after settling", async () => {
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 5000,
        });

        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc("leave_group", {
          p_group_id: groupId,
        });
        expect(error).toBeNull();

        const { data: members } = await adminClient!
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId);

        const memberIds = members?.map((m) => m.user_id) ?? [];
        expect(memberIds).not.toContain(bob.id);
      });
    });

    // ──────────────────────────────────────────────────────
    // Invite link remains active after member removal —
    // removed user can rejoin via the same link
    // ──────────────────────────────────────────────────────
    describe("rejoin via invite link after removal", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;
      let inviteToken: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, []);
        groupId = group.id;

        const { data: link } = await adminClient!
          .from("group_invite_links")
          .insert({ group_id: groupId, created_by: alice.id })
          .select("token")
          .single();
        inviteToken = link!.token;

        // Bob joins, no expenses, creator removes bob
        const bobClient = authenticateAs(bob);
        await bobClient.rpc("join_group_via_link", { p_token: inviteToken });

        const aliceClient = authenticateAs(alice);
        await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: bob.id,
        });
      });

      it("removed member can rejoin via the same invite link", async () => {
        const bobClient = authenticateAs(bob);
        const { data, error } = await bobClient.rpc("join_group_via_link", {
          p_token: inviteToken,
        });

        expect(error).toBeNull();
        expect(data).toBeDefined();

        // Bob should be back in the group
        const { data: members } = await adminClient!
          .from("group_members")
          .select("user_id, status")
          .eq("group_id", groupId)
          .eq("user_id", bob.id);

        expect(members).toHaveLength(1);
        expect(members![0].status).toBe("accepted");
      });

      it("rejoined member can participate in new expenses", async () => {
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [{ userId: bob.id, amount: 4000 }],
          payers: [{ userId: alice.id, amount: 4000 }],
        });

        const balance = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balance).toBe(4000);
      });
    });

    // ──────────────────────────────────────────────────────
    // Member who left voluntarily can rejoin via invite link
    // ──────────────────────────────────────────────────────
    describe("rejoin via invite link after voluntarily leaving", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;
      let inviteToken: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, []);
        groupId = group.id;

        const { data: link } = await adminClient!
          .from("group_invite_links")
          .insert({ group_id: groupId, created_by: alice.id })
          .select("token")
          .single();
        inviteToken = link!.token;

        // Bob joins via invite link
        const bobClient = authenticateAs(bob);
        await bobClient.rpc("join_group_via_link", { p_token: inviteToken });

        // Bob leaves voluntarily (no expenses, no balance)
        await bobClient.rpc("leave_group", { p_group_id: groupId });
      });

      it("member who left can rejoin via invite link", async () => {
        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc("join_group_via_link", {
          p_token: inviteToken,
        });

        expect(error).toBeNull();

        const { data: members } = await adminClient!
          .from("group_members")
          .select("user_id, status")
          .eq("group_id", groupId)
          .eq("user_id", bob.id);

        expect(members).toHaveLength(1);
        expect(members![0].status).toBe("accepted");
      });
    });
  },
);
