import { describe, it, expect, beforeAll } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  createTestUsers,
  createTestGroupWithMembers,
  createAndActivateExpense,
  settleDebt,
  getBalanceBetween,
  authenticateAs,
  acceptGroupInvite,
  type TestUser,
} from "@/test/integration-helpers";

/**
 * Suite 4 — Multi-group data isolation.
 *
 * Verifies that groups are fully independent: expenses, balances,
 * settlements, and membership in one group never leak to another.
 * Complements Suite 3 (group-membership.integration.test.ts) which
 * covers membership transitions within a single group.
 */

describe.skipIf(!isIntegrationTestReady)(
  "Multi-group data isolation",
  () => {
    // ──────────────────────────────────────────────
    // 4.1 — Expenses in group A don't create balances in group B
    // ──────────────────────────────────────────────
    describe("4.1 — expense activation is group-scoped", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupAId: string;
      let groupBId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);

        const [groupA, groupB] = await Promise.all([
          createTestGroupWithMembers(alice, [bob]),
          createTestGroupWithMembers(alice, [bob]),
        ]);
        groupAId = groupA.id;
        groupBId = groupB.id;
      });

      it("expense in group A creates balance only in group A", async () => {
        await createAndActivateExpense({
          creator: alice,
          groupId: groupAId,
          shares: [{ userId: bob.id, amount: 10000 }],
          payers: [{ userId: alice.id, amount: 10000 }],
          title: "Group A dinner",
        });

        const balanceA = await getBalanceBetween(groupAId, bob.id, alice.id);
        expect(balanceA).toBe(10000);

        const balanceB = await getBalanceBetween(groupBId, bob.id, alice.id);
        expect(balanceB).toBe(0);
      });

      it("expense in group B doesn't affect group A balance", async () => {
        const balanceABefore = await getBalanceBetween(
          groupAId,
          bob.id,
          alice.id,
        );

        await createAndActivateExpense({
          creator: bob,
          groupId: groupBId,
          shares: [{ userId: alice.id, amount: 5000 }],
          payers: [{ userId: bob.id, amount: 5000 }],
          title: "Group B lunch",
        });

        const balanceAAfter = await getBalanceBetween(
          groupAId,
          bob.id,
          alice.id,
        );
        expect(balanceAAfter).toBe(balanceABefore);

        const balanceB = await getBalanceBetween(groupBId, alice.id, bob.id);
        expect(balanceB).toBe(5000);
      });

      it("same user pair can have opposite debts in different groups", async () => {
        // In group A: bob owes alice 10000
        const balanceA = await getBalanceBetween(groupAId, bob.id, alice.id);
        expect(balanceA).toBeGreaterThan(0);

        // In group B: alice owes bob 5000
        const balanceB = await getBalanceBetween(groupBId, alice.id, bob.id);
        expect(balanceB).toBeGreaterThan(0);

        // Opposite directions — confirms group isolation
      });
    });

    // ──────────────────────────────────────────────
    // 4.2 — Settlements don't cross group boundaries
    // ──────────────────────────────────────────────
    describe("4.2 — settlements are group-scoped", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupAId: string;
      let groupBId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);

        const [groupA, groupB] = await Promise.all([
          createTestGroupWithMembers(alice, [bob]),
          createTestGroupWithMembers(alice, [bob]),
        ]);
        groupAId = groupA.id;
        groupBId = groupB.id;

        // Create debts in both groups: bob owes alice in both
        await Promise.all([
          createAndActivateExpense({
            creator: alice,
            groupId: groupAId,
            shares: [{ userId: bob.id, amount: 8000 }],
            payers: [{ userId: alice.id, amount: 8000 }],
          }),
          createAndActivateExpense({
            creator: alice,
            groupId: groupBId,
            shares: [{ userId: bob.id, amount: 6000 }],
            payers: [{ userId: alice.id, amount: 6000 }],
          }),
        ]);
      });

      it("settlement in group A doesn't reduce group B balance", async () => {
        const balanceBBefore = await getBalanceBetween(
          groupBId,
          bob.id,
          alice.id,
        );

        await settleDebt({
          caller: bob,
          groupId: groupAId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 3000,
        });

        const balanceBAfter = await getBalanceBetween(
          groupBId,
          bob.id,
          alice.id,
        );
        expect(balanceBAfter).toBe(balanceBBefore);

        // Group A balance should be reduced
        const balanceA = await getBalanceBetween(groupAId, bob.id, alice.id);
        expect(balanceA).toBe(5000);
      });

      it("settlement records are only visible in their own group", async () => {
        const client = authenticateAs(bob);

        const { data: settlementsA } = await client
          .from("settlements")
          .select("id")
          .eq("group_id", groupAId);

        const { data: settlementsB } = await client
          .from("settlements")
          .select("id")
          .eq("group_id", groupBId);

        expect(settlementsA!.length).toBeGreaterThanOrEqual(1);
        expect(settlementsB).toHaveLength(0);
      });

      it("full settlement in group A leaves group B debt intact", async () => {
        // Settle remaining balance in group A
        const remainingA = await getBalanceBetween(
          groupAId,
          bob.id,
          alice.id,
        );
        await settleDebt({
          caller: bob,
          groupId: groupAId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: remainingA,
        });

        const finalA = await getBalanceBetween(groupAId, bob.id, alice.id);
        expect(finalA).toBe(0);

        const finalB = await getBalanceBetween(groupBId, bob.id, alice.id);
        expect(finalB).toBe(6000);
      });
    });

    // ──────────────────────────────────────────────
    // 4.3 — Member removal from one group doesn't affect another
    // ──────────────────────────────────────────────
    describe("4.3 — member removal is group-scoped", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;
      let groupAId: string;
      let groupBId: string;

      beforeAll(async () => {
        [alice, bob, carol] = await createTestUsers(3);

        const [groupA, groupB] = await Promise.all([
          createTestGroupWithMembers(alice, [bob, carol]),
          createTestGroupWithMembers(alice, [bob, carol]),
        ]);
        groupAId = groupA.id;
        groupBId = groupB.id;

        // Create expenses in both groups
        await Promise.all([
          createAndActivateExpense({
            creator: alice,
            groupId: groupAId,
            shares: [
              { userId: bob.id, amount: 5000 },
              { userId: carol.id, amount: 5000 },
            ],
            payers: [{ userId: alice.id, amount: 10000 }],
            title: "Group A expense",
          }),
          createAndActivateExpense({
            creator: alice,
            groupId: groupBId,
            shares: [
              { userId: bob.id, amount: 3000 },
              { userId: carol.id, amount: 3000 },
            ],
            payers: [{ userId: alice.id, amount: 6000 }],
            title: "Group B expense",
          }),
        ]);
      });

      it("removing bob from group A doesn't affect group B membership", async () => {
        // Remove bob from group A
        await adminClient!
          .from("group_members")
          .delete()
          .eq("group_id", groupAId)
          .eq("user_id", bob.id);

        // Bob can still see group B data
        const client = authenticateAs(bob);
        const { data } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", groupBId);

        expect(data!.length).toBeGreaterThanOrEqual(1);
      });

      it("removed bob cannot see group A expenses but can see group B", async () => {
        const client = authenticateAs(bob);

        const { data: dataA } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", groupAId);

        const { data: dataB } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", groupBId);

        expect(dataA).toHaveLength(0);
        expect(dataB!.length).toBeGreaterThanOrEqual(1);
      });

      it("removed bob cannot see group A balances but can see group B", async () => {
        const client = authenticateAs(bob);

        const { data: balA } = await client
          .from("balances")
          .select("*")
          .eq("group_id", groupAId);

        const { data: balB } = await client
          .from("balances")
          .select("*")
          .eq("group_id", groupBId);

        expect(balA).toHaveLength(0);
        expect(balB!.length).toBeGreaterThanOrEqual(1);
      });

      it("bob can still settle in group B after removal from group A", async () => {
        const balanceBefore = await getBalanceBetween(
          groupBId,
          bob.id,
          alice.id,
        );
        expect(balanceBefore).toBeGreaterThan(0);

        await settleDebt({
          caller: bob,
          groupId: groupBId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 1000,
        });

        const balanceAfter = await getBalanceBetween(
          groupBId,
          bob.id,
          alice.id,
        );
        expect(balanceAfter).toBe(balanceBefore - 1000);
      });

      it("bob cannot settle in group A after removal", async () => {
        const client = authenticateAs(bob);
        const { error } = await client.rpc("record_and_settle", {
          p_group_id: groupAId,
          p_from_user_id: bob.id,
          p_to_user_id: alice.id,
          p_amount_cents: 1000,
        });

        expect(error).not.toBeNull();
      });
    });

    // ──────────────────────────────────────────────
    // 4.4 — Three-group scenario with overlapping members
    // ──────────────────────────────────────────────
    describe("4.4 — three groups with overlapping membership", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;
      let dave: TestUser;
      let group1Id: string; // alice + bob
      let group2Id: string; // alice + bob + carol
      let group3Id: string; // bob + carol + dave

      beforeAll(async () => {
        [alice, bob, carol, dave] = await createTestUsers(4);

        const [group1, group2, group3] = await Promise.all([
          createTestGroupWithMembers(alice, [bob]),
          createTestGroupWithMembers(alice, [bob, carol]),
          createTestGroupWithMembers(bob, [carol, dave]),
        ]);
        group1Id = group1.id;
        group2Id = group2.id;
        group3Id = group3.id;

        // Create expenses in each group
        await Promise.all([
          createAndActivateExpense({
            creator: alice,
            groupId: group1Id,
            shares: [{ userId: bob.id, amount: 10000 }],
            payers: [{ userId: alice.id, amount: 10000 }],
            title: "G1: alice pays for bob",
          }),
          createAndActivateExpense({
            creator: alice,
            groupId: group2Id,
            shares: [
              { userId: bob.id, amount: 5000 },
              { userId: carol.id, amount: 5000 },
            ],
            payers: [{ userId: alice.id, amount: 10000 }],
            title: "G2: alice pays for bob+carol",
          }),
          createAndActivateExpense({
            creator: bob,
            groupId: group3Id,
            shares: [
              { userId: carol.id, amount: 4000 },
              { userId: dave.id, amount: 4000 },
            ],
            payers: [{ userId: bob.id, amount: 8000 }],
            title: "G3: bob pays for carol+dave",
          }),
        ]);
      });

      it("dave cannot see group 1 or group 2 data", async () => {
        const client = authenticateAs(dave);

        const { data: exp1 } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", group1Id);

        const { data: exp2 } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", group2Id);

        const { data: exp3 } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", group3Id);

        expect(exp1).toHaveLength(0);
        expect(exp2).toHaveLength(0);
        expect(exp3!.length).toBeGreaterThanOrEqual(1);
      });

      it("alice cannot see group 3 data", async () => {
        const client = authenticateAs(alice);

        const { data: exp3 } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", group3Id);

        const { data: bal3 } = await client
          .from("balances")
          .select("*")
          .eq("group_id", group3Id);

        expect(exp3).toHaveLength(0);
        expect(bal3).toHaveLength(0);
      });

      it("bob sees expenses in all three groups", async () => {
        const client = authenticateAs(bob);

        const [{ data: exp1 }, { data: exp2 }, { data: exp3 }] =
          await Promise.all([
            client.from("expenses").select("id").eq("group_id", group1Id),
            client.from("expenses").select("id").eq("group_id", group2Id),
            client.from("expenses").select("id").eq("group_id", group3Id),
          ]);

        expect(exp1!.length).toBeGreaterThanOrEqual(1);
        expect(exp2!.length).toBeGreaterThanOrEqual(1);
        expect(exp3!.length).toBeGreaterThanOrEqual(1);
      });

      it("bob↔alice balances are independent per group", async () => {
        const balG1 = await getBalanceBetween(group1Id, bob.id, alice.id);
        const balG2 = await getBalanceBetween(group2Id, bob.id, alice.id);
        const balG3 = await getBalanceBetween(group3Id, bob.id, alice.id);

        // Group 1: bob owes alice 10000
        expect(balG1).toBe(10000);
        // Group 2: bob owes alice 5000
        expect(balG2).toBe(5000);
        // Group 3: alice is not a member, no balance
        expect(balG3).toBe(0);
      });

      it("carol has different balances per group", async () => {
        // Group 2: carol owes alice 5000
        const balG2 = await getBalanceBetween(group2Id, carol.id, alice.id);
        expect(balG2).toBe(5000);

        // Group 3: carol owes bob 4000
        const balG3 = await getBalanceBetween(group3Id, carol.id, bob.id);
        expect(balG3).toBe(4000);

        // Group 1: carol not a member, no balance
        const balG1 = await getBalanceBetween(group1Id, carol.id, alice.id);
        expect(balG1).toBe(0);
      });

      it("settlement in group 2 doesn't affect group 1 or 3", async () => {
        const balG1Before = await getBalanceBetween(
          group1Id,
          bob.id,
          alice.id,
        );
        const balG3Before = await getBalanceBetween(
          group3Id,
          carol.id,
          bob.id,
        );

        await settleDebt({
          caller: bob,
          groupId: group2Id,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 2000,
        });

        const balG1After = await getBalanceBetween(
          group1Id,
          bob.id,
          alice.id,
        );
        const balG3After = await getBalanceBetween(
          group3Id,
          carol.id,
          bob.id,
        );

        expect(balG1After).toBe(balG1Before);
        expect(balG3After).toBe(balG3Before);

        // Only group 2 changed
        const balG2 = await getBalanceBetween(group2Id, bob.id, alice.id);
        expect(balG2).toBe(3000);
      });
    });

    // ──────────────────────────────────────────────
    // 4.5 — Unfiltered queries don't leak cross-group data
    // ──────────────────────────────────────────────
    describe("4.5 — RLS prevents cross-group leakage on unfiltered queries", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;
      let groupAId: string;
      let groupBId: string;

      beforeAll(async () => {
        [alice, bob, carol] = await createTestUsers(3);

        // Group A: alice + bob
        const groupA = await createTestGroupWithMembers(alice, [bob]);
        groupAId = groupA.id;

        // Group B: alice + carol
        const groupB = await createTestGroupWithMembers(alice, [carol]);
        groupBId = groupB.id;

        await Promise.all([
          createAndActivateExpense({
            creator: alice,
            groupId: groupAId,
            shares: [{ userId: bob.id, amount: 7000 }],
            payers: [{ userId: alice.id, amount: 7000 }],
            title: "Group A only",
          }),
          createAndActivateExpense({
            creator: alice,
            groupId: groupBId,
            shares: [{ userId: carol.id, amount: 3000 }],
            payers: [{ userId: alice.id, amount: 3000 }],
            title: "Group B only",
          }),
        ]);
      });

      it("bob's unfiltered expense query returns only group A data", async () => {
        const client = authenticateAs(bob);
        const { data } = await client.from("expenses").select("group_id");

        const groupIds = new Set(data!.map((e) => e.group_id));
        expect(groupIds.has(groupAId)).toBe(true);
        expect(groupIds.has(groupBId)).toBe(false);
      });

      it("carol's unfiltered expense query returns only group B data", async () => {
        const client = authenticateAs(carol);
        const { data } = await client.from("expenses").select("group_id");

        const groupIds = new Set(data!.map((e) => e.group_id));
        expect(groupIds.has(groupBId)).toBe(true);
        expect(groupIds.has(groupAId)).toBe(false);
      });

      it("bob's unfiltered balance query returns only group A balances", async () => {
        const client = authenticateAs(bob);
        const { data } = await client.from("balances").select("group_id");

        const groupIds = new Set(data!.map((b) => b.group_id));
        expect(groupIds.has(groupAId)).toBe(true);
        expect(groupIds.has(groupBId)).toBe(false);
      });

      it("alice sees data from both groups (member of both)", async () => {
        const client = authenticateAs(alice);
        const { data } = await client.from("expenses").select("group_id");

        const groupIds = new Set(data!.map((e) => e.group_id));
        expect(groupIds.has(groupAId)).toBe(true);
        expect(groupIds.has(groupBId)).toBe(true);
      });

      it("bob cannot see carol's settlement records", async () => {
        // Create a settlement in group B
        await settleDebt({
          caller: carol,
          groupId: groupBId,
          fromUserId: carol.id,
          toUserId: alice.id,
          amountCents: 1000,
        });

        const client = authenticateAs(bob);
        const { data } = await client.from("settlements").select("group_id");

        const groupIds = new Set(data!.map((s) => s.group_id));
        expect(groupIds.has(groupBId)).toBe(false);
      });

      it("expense shares from other groups are invisible", async () => {
        // Bob queries all expense_shares (no group filter on this table)
        const client = authenticateAs(bob);
        const { data } = await client
          .from("expense_shares")
          .select("user_id, expense_id");

        // All returned shares should belong to expenses in bob's groups
        // Carol's share should not appear
        const userIds = new Set(data!.map((s) => s.user_id));
        expect(userIds.has(carol.id)).toBe(false);
      });
    });

    // ──────────────────────────────────────────────
    // 4.6 — Adding a member to group A doesn't affect group B
    // ──────────────────────────────────────────────
    describe("4.6 — adding new member to one group doesn't leak another", () => {
      let alice: TestUser;
      let bob: TestUser;
      let dave: TestUser;
      let groupAId: string;
      let groupBId: string;

      beforeAll(async () => {
        [alice, bob, dave] = await createTestUsers(3);

        // Group A: alice only
        const groupA = await createTestGroupWithMembers(alice, []);
        groupAId = groupA.id;

        // Group B: alice + bob (has data)
        const groupB = await createTestGroupWithMembers(alice, [bob]);
        groupBId = groupB.id;

        await createAndActivateExpense({
          creator: alice,
          groupId: groupBId,
          shares: [{ userId: bob.id, amount: 5000 }],
          payers: [{ userId: alice.id, amount: 5000 }],
          title: "Group B secret",
        });
      });

      it("dave added to group A cannot see group B", async () => {
        // Invite and accept dave in group A
        await adminClient!.from("group_members").insert({
          group_id: groupAId,
          user_id: dave.id,
          status: "invited",
          invited_by: alice.id,
        });
        await acceptGroupInvite(dave, groupAId);

        // Dave should see group A membership
        const client = authenticateAs(dave);
        const { data: members } = await client
          .from("group_members")
          .select("group_id")
          .eq("user_id", dave.id);

        const memberGroupIds = new Set(members!.map((m) => m.group_id));
        expect(memberGroupIds.has(groupAId)).toBe(true);
        expect(memberGroupIds.has(groupBId)).toBe(false);

        // Dave cannot see group B expenses or balances
        const { data: expenses } = await client
          .from("expenses")
          .select("id")
          .eq("group_id", groupBId);
        expect(expenses).toHaveLength(0);

        const { data: balances } = await client
          .from("balances")
          .select("*")
          .eq("group_id", groupBId);
        expect(balances).toHaveLength(0);
      });
    });
  },
);
