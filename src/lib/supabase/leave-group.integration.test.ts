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
  "leave_group RPC",
  () => {
    // ──────────────────────────────────────────────
    // Accepted member with zero balance can leave
    // ──────────────────────────────────────────────
    describe("accepted member with zero balance", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;
      });

      it("can leave the group", async () => {
        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc("leave_group", {
          p_group_id: groupId,
        });
        expect(error).toBeNull();

        // Bob should no longer be in the group
        const { data: members } = await adminClient!
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId);

        const memberIds = members?.map((m) => m.user_id) ?? [];
        expect(memberIds).not.toContain(bob.id);
        expect(memberIds).toContain(alice.id);
      });
    });

    // ──────────────────────────────────────────────
    // Member with outstanding balance cannot leave
    // ──────────────────────────────────────────────
    describe("member with outstanding balance", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;

        // Create an expense: alice pays 10000, both share equally
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

      it("is blocked from leaving", async () => {
        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc("leave_group", {
          p_group_id: groupId,
        });
        expect(error).not.toBeNull();
        expect(error!.message).toContain("has_outstanding_balance");
      });

      it("can leave after settling the debt", async () => {
        // Bob owes alice 5000
        const balance = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balance).toBe(5000);

        // Settle the debt
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 5000,
        });

        // Now bob should be able to leave
        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc("leave_group", {
          p_group_id: groupId,
        });
        expect(error).toBeNull();

        // Bob's zero-balance rows should also be cleaned up
        const { data: balanceRows } = await adminClient!
          .from("balances")
          .select("*")
          .eq("group_id", groupId)
          .or(`user_a.eq.${bob.id},user_b.eq.${bob.id}`);

        expect(balanceRows ?? []).toHaveLength(0);
      });
    });

    // ──────────────────────────────────────────────
    // Creator cannot leave their own group
    // ──────────────────────────────────────────────
    describe("group creator", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;
      });

      it("cannot leave their own group", async () => {
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc("leave_group", {
          p_group_id: groupId,
        });
        expect(error).not.toBeNull();
        expect(error!.message).toContain("group creator cannot leave");
      });
    });

    // ──────────────────────────────────────────────
    // Invited (not accepted) member cannot use leave_group
    // ──────────────────────────────────────────────
    describe("invited member", () => {
      let alice: TestUser;
      let carol: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, carol] = await createTestUsers(2);
        // Create group but don't accept carol's invite
        const group = await adminClient!
          .from("groups")
          .insert({ name: "Invite-only Group", creator_id: alice.id })
          .select()
          .single();

        groupId = group.data!.id;

        await adminClient!.from("group_members").insert([
          { group_id: groupId, user_id: alice.id, status: "accepted", invited_by: alice.id },
          { group_id: groupId, user_id: carol.id, status: "invited", invited_by: alice.id },
        ]);
      });

      it("cannot use leave_group (should decline instead)", async () => {
        const carolClient = authenticateAs(carol);
        const { error } = await carolClient.rpc("leave_group", {
          p_group_id: groupId,
        });
        expect(error).not.toBeNull();
        expect(error!.message).toContain("not_accepted");
      });
    });

    // ──────────────────────────────────────────────
    // Non-member cannot call leave_group
    // ──────────────────────────────────────────────
    describe("non-member", () => {
      let alice: TestUser;
      let stranger: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, stranger] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, []);
        groupId = group.id;
      });

      it("gets not_a_member error", async () => {
        const strangerClient = authenticateAs(stranger);
        const { error } = await strangerClient.rpc("leave_group", {
          p_group_id: groupId,
        });
        expect(error).not.toBeNull();
        expect(error!.message).toContain("not_a_member");
      });
    });

    // ──────────────────────────────────────────────
    // Non-existent group
    // ──────────────────────────────────────────────
    describe("non-existent group", () => {
      let alice: TestUser;

      beforeAll(async () => {
        [alice] = await createTestUsers(1);
      });

      it("gets group_not_found error", async () => {
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc("leave_group", {
          p_group_id: "00000000-0000-0000-0000-000000000000",
        });
        expect(error).not.toBeNull();
        expect(error!.message).toContain("group_not_found");
      });
    });

    // ──────────────────────────────────────────────
    // Double leave is idempotent (second call fails gracefully)
    // ──────────────────────────────────────────────
    describe("double leave", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;
      });

      it("first leave succeeds, second returns not_a_member", async () => {
        const bobClient = authenticateAs(bob);

        const { error: firstError } = await bobClient.rpc("leave_group", {
          p_group_id: groupId,
        });
        expect(firstError).toBeNull();

        const { error: secondError } = await bobClient.rpc("leave_group", {
          p_group_id: groupId,
        });
        expect(secondError).not.toBeNull();
        expect(secondError!.message).toContain("not_a_member");
      });
    });
  },
);
