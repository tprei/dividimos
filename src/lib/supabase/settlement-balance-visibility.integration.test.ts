import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUser,
  createTestUsers,
  createTestGroup,
  createAndActivateExpense,
  authenticateAs,
  acceptGroupInvite,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

describe.skipIf(!isIntegrationTestReady)(
  "settlement balance visibility (RLS)",
  () => {
    let creator: TestUser;
    let member: TestUser;
    let groupId: string;

    beforeEach(async () => {
      [creator, member] = await createTestUsers(2);

      const group = await createTestGroup(creator.id, [member.id]);
      groupId = group.id;

      await acceptGroupInvite(member, groupId);
    });

    it("creator can read balances for their group", async () => {
      await createAndActivateExpense({
        creator,
        groupId,
        shares: [
          { userId: member.id, amount: 5000 },
          { userId: creator.id, amount: 5000 },
        ],
        payers: [{ userId: creator.id, amount: 10000 }],
      });

      const creatorClient = authenticateAs(creator);
      const { data, error } = await creatorClient
        .from("balances")
        .select("*")
        .eq("group_id", groupId);

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.length).toBeGreaterThan(0);
    });

    it("accepted member can see creator's profile via user_profiles", async () => {
      const memberClient = authenticateAs(member);
      const { data } = await memberClient
        .from("user_profiles")
        .select("*")
        .eq("id", creator.id)
        .single();

      expect(data).not.toBeNull();
      expect(data!.handle).toBe(creator.handle);
    });

    it("balance user profiles remain visible after member removal", async () => {
      await createAndActivateExpense({
        creator,
        groupId,
        shares: [
          { userId: member.id, amount: 5000 },
          { userId: creator.id, amount: 5000 },
        ],
        payers: [{ userId: creator.id, amount: 10000 }],
      });

      // Remove member from group
      await adminClient!
        .from("group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("user_id", member.id);

      // Creator should still see the removed member's profile
      // because they share a balance (via the new RLS clause)
      const creatorClient = authenticateAs(creator);
      const { data } = await creatorClient
        .from("user_profiles")
        .select("*")
        .eq("id", member.id)
        .maybeSingle();

      expect(data).not.toBeNull();
      expect(data!.handle).toBe(member.handle);
    });

    it("balance counterparty can still read balances after member removal", async () => {
      await createAndActivateExpense({
        creator,
        groupId,
        shares: [
          { userId: member.id, amount: 5000 },
          { userId: creator.id, amount: 5000 },
        ],
        payers: [{ userId: creator.id, amount: 10000 }],
      });

      // Remove member from group
      await adminClient!
        .from("group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("user_id", member.id);

      // Creator (still in group) should still see balances
      const creatorClient = authenticateAs(creator);
      const { data, error } = await creatorClient
        .from("balances")
        .select("*")
        .eq("group_id", groupId);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
    });

    it("unrelated user cannot see group balances or profiles", async () => {
      const outsider = await createTestUser({ name: "Outsider" });

      await createAndActivateExpense({
        creator,
        groupId,
        shares: [
          { userId: member.id, amount: 5000 },
          { userId: creator.id, amount: 5000 },
        ],
        payers: [{ userId: creator.id, amount: 10000 }],
      });

      const outsiderClient = authenticateAs(outsider);

      // Cannot see balances
      const { data: balances } = await outsiderClient
        .from("balances")
        .select("*")
        .eq("group_id", groupId);

      expect(balances).toHaveLength(0);

      // Cannot see member profiles (no shared group or balance)
      const { data: profile } = await outsiderClient
        .from("user_profiles")
        .select("*")
        .eq("id", member.id)
        .maybeSingle();

      expect(profile).toBeNull();
    });
  },
);
