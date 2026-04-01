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

    it("creator sees invited (not-yet-accepted) member's name and balances — adhoc bill scenario", async () => {
      // Scenario: User A creates an adhoc bill, invites B via handle.
      // B gets status='invited' in the auto-created group.
      // The bill is activated → balances exist for B.
      // A views group settlement → B's name must show (not "?").

      // member is already 'invited' in beforeEach — undo the accept
      // by creating a fresh group without accepting
      const invited = await createTestUser({ name: "Convidado Pendente" });
      const adhocGroup = await createTestGroup(creator.id, [invited.id]);
      // invited.status remains 'invited' — no acceptGroupInvite call

      await createAndActivateExpense({
        creator,
        groupId: adhocGroup.id,
        shares: [
          { userId: invited.id, amount: 4000 },
          { userId: creator.id, amount: 6000 },
        ],
        payers: [{ userId: creator.id, amount: 10000 }],
      });

      const creatorClient = authenticateAs(creator);

      // Creator can see balances involving the invited member
      const { data: balances, error: balErr } = await creatorClient
        .from("balances")
        .select("*")
        .eq("group_id", adhocGroup.id);

      expect(balErr).toBeNull();
      expect(balances!.length).toBeGreaterThan(0);

      // Creator can see invited member's profile (for name resolution)
      const { data: profile } = await creatorClient
        .from("user_profiles")
        .select("*")
        .eq("id", invited.id)
        .maybeSingle();

      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("Convidado Pendente");
    });

    it("invited member cannot see their own balances until they accept", async () => {
      const invited = await createTestUser({ name: "Pendente" });
      const adhocGroup = await createTestGroup(creator.id, [invited.id]);

      await createAndActivateExpense({
        creator,
        groupId: adhocGroup.id,
        shares: [
          { userId: invited.id, amount: 5000 },
          { userId: creator.id, amount: 5000 },
        ],
        payers: [{ userId: creator.id, amount: 10000 }],
      });

      // Invited member can't see balances (my_accepted_group_ids excludes invited)
      const invitedClient = authenticateAs(invited);
      const { data: balances } = await invitedClient
        .from("balances")
        .select("*")
        .eq("group_id", adhocGroup.id);

      expect(balances).toHaveLength(0);

      // After accepting, balances become visible
      await acceptGroupInvite(invited, adhocGroup.id);
      const { data: balancesAfter } = await invitedClient
        .from("balances")
        .select("*")
        .eq("group_id", adhocGroup.id);

      expect(balancesAfter!.length).toBeGreaterThan(0);
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
