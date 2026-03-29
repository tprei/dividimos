import { describe, it, expect } from "vitest";
import { isIntegrationTestReady } from "./integration-setup";
import {
  createTestUsers,
  createAndActivateExpense,
  settleDebt,
  getBalanceBetween,
  acceptGroupInvite,
  createTestGroup,
  createTestGroupWithMembers,
  authenticateAs,
} from "./integration-helpers";

describe.skipIf(!isIntegrationTestReady)(
  "integration-helpers: new helpers",
  () => {
    it("createAndActivateExpense creates balances correctly", async () => {
      const [alice, bob] = await createTestUsers(2);
      const group = await createTestGroupWithMembers(alice, [bob]);

      // Alice pays 10000 (R$100), split equally
      await createAndActivateExpense({
        creator: alice,
        groupId: group.id,
        shares: [
          { userId: alice.id, amount: 5000 },
          { userId: bob.id, amount: 5000 },
        ],
        payers: [{ userId: alice.id, amount: 10000 }],
      });

      // Bob owes Alice 5000
      const balance = await getBalanceBetween(group.id, bob.id, alice.id);
      expect(balance).toBe(5000);

      // From Alice's perspective, Bob owes her (negative = the other owes you)
      const alicePerspective = await getBalanceBetween(
        group.id,
        alice.id,
        bob.id,
      );
      expect(alicePerspective).toBe(-5000);
    });

    it("settleDebt reduces the balance", async () => {
      const [alice, bob] = await createTestUsers(2);
      const group = await createTestGroupWithMembers(alice, [bob]);

      await createAndActivateExpense({
        creator: alice,
        groupId: group.id,
        shares: [
          { userId: alice.id, amount: 5000 },
          { userId: bob.id, amount: 5000 },
        ],
        payers: [{ userId: alice.id, amount: 10000 }],
      });

      // Bob settles half the debt
      const settlementId = await settleDebt({
        caller: bob,
        groupId: group.id,
        fromUserId: bob.id,
        toUserId: alice.id,
        amountCents: 2500,
      });

      expect(settlementId).toBeTruthy();

      const remaining = await getBalanceBetween(group.id, bob.id, alice.id);
      expect(remaining).toBe(2500);
    });

    it("getBalanceBetween returns 0 when no balance exists", async () => {
      const [alice, bob] = await createTestUsers(2);
      const group = await createTestGroupWithMembers(alice, [bob]);

      const balance = await getBalanceBetween(group.id, alice.id, bob.id);
      expect(balance).toBe(0);
    });

    it("acceptGroupInvite transitions member status", async () => {
      const [alice, bob] = await createTestUsers(2);
      const group = await createTestGroup(alice.id, [bob.id]);

      // Bob is invited but not accepted
      const bobClient = authenticateAs(bob);
      const { data: beforeData } = await bobClient
        .from("group_members")
        .select("status")
        .eq("group_id", group.id)
        .eq("user_id", bob.id)
        .single();
      expect(beforeData?.status).toBe("invited");

      await acceptGroupInvite(bob, group.id);

      const { data: afterData } = await bobClient
        .from("group_members")
        .select("status")
        .eq("group_id", group.id)
        .eq("user_id", bob.id)
        .single();
      expect(afterData?.status).toBe("accepted");
    });

    it("createTestGroupWithMembers creates a fully-accepted group", async () => {
      const [alice, bob, carol] = await createTestUsers(3);
      const group = await createTestGroupWithMembers(alice, [bob, carol]);

      const aliceClient = authenticateAs(alice);
      const { data: members } = await aliceClient
        .from("group_members")
        .select("user_id, status")
        .eq("group_id", group.id);

      expect(members).toHaveLength(3);
      expect(members?.every((m) => m.status === "accepted")).toBe(true);
    });

    it("settleDebt can fully zero out a balance", async () => {
      const [alice, bob] = await createTestUsers(2);
      const group = await createTestGroupWithMembers(alice, [bob]);

      await createAndActivateExpense({
        creator: alice,
        groupId: group.id,
        shares: [
          { userId: alice.id, amount: 3000 },
          { userId: bob.id, amount: 3000 },
        ],
        payers: [{ userId: alice.id, amount: 6000 }],
      });

      await settleDebt({
        caller: bob,
        groupId: group.id,
        fromUserId: bob.id,
        toUserId: alice.id,
        amountCents: 3000,
      });

      const balance = await getBalanceBetween(group.id, bob.id, alice.id);
      expect(balance).toBe(0);
    });
  },
);
