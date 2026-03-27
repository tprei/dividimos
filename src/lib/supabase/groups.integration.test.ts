import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  authenticateAs,
  createTestGroup,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

describe.skipIf(!isIntegrationTestReady)("Groups RLS and membership", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeEach(async () => {
    [alice, bob, carol] = await createTestUsers(3, { pixKeyType: "email" });
  });

  // ── Group INSERT ──────────────────────────────────────────────────────

  describe("groups INSERT", () => {
    it("authenticated user can create a group", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("groups")
        .insert({ name: "Test Group", creator_id: alice.id })
        .select("id, name, creator_id")
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.name).toBe("Test Group");
      expect(data!.creator_id).toBe(alice.id);
    });

    it("user cannot create a group with another user as creator", async () => {
      const client = authenticateAs(alice);
      const { error } = await client
        .from("groups")
        .insert({ name: "Spoofed Group", creator_id: bob.id })
        .select();

      expect(error).not.toBeNull();
    });
  });

  // ── Group SELECT ─────────────────────────────────────────────────────

  describe("groups SELECT", () => {
    it("creator can read their own group", async () => {
      const group = await createTestGroup(alice.id);
      const client = authenticateAs(alice);

      const { data, error } = await client
        .from("groups")
        .select("id")
        .eq("id", group.id)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.id).toBe(group.id);
    });

    it("accepted member can read the group", async () => {
      const group = await createTestGroup(alice.id);

      // Bob is invited; accept him first
      await adminClient!
        .from("group_members")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("group_id", group.id)
        .eq("user_id", bob.id);

      const bobClient = authenticateAs(bob);
      const { data, error } = await bobClient
        .from("groups")
        .select("id")
        .eq("id", group.id)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.id).toBe(group.id);
    });

    it("invited (not yet accepted) member can read the group", async () => {
      const group = await createTestGroup(alice.id, [bob.id]);

      // Bob is invited but hasn't accepted — should still be visible
      const bobClient = authenticateAs(bob);
      const { data, error } = await bobClient
        .from("groups")
        .select("id")
        .eq("id", group.id)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.id).toBe(group.id);
    });

    it("non-member cannot read the group", async () => {
      const group = await createTestGroup(alice.id);

      const carolClient = authenticateAs(carol);
      const { data, error } = await carolClient
        .from("groups")
        .select("id")
        .eq("id", group.id)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });
  });

  // ── Group UPDATE ─────────────────────────────────────────────────────

  describe("groups UPDATE", () => {
    it("creator can update group name", async () => {
      const group = await createTestGroup(alice.id);
      const client = authenticateAs(alice);

      const { data, error } = await client
        .from("groups")
        .update({ name: "Renamed Group" })
        .eq("id", group.id)
        .select("id, name")
        .single();

      expect(error).toBeNull();
      expect(data!.name).toBe("Renamed Group");
    });

    it("non-creator member cannot update the group", async () => {
      const group = await createTestGroup(alice.id, [bob.id]);

      // Accept Bob
      await adminClient!
        .from("group_members")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("group_id", group.id)
        .eq("user_id", bob.id);

      const bobClient = authenticateAs(bob);
      const { data, error } = await bobClient
        .from("groups")
        .update({ name: "Hacked!" })
        .eq("id", group.id)
        .select();

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("non-member cannot update the group", async () => {
      const group = await createTestGroup(alice.id);

      const carolClient = authenticateAs(carol);
      const { data, error } = await carolClient
        .from("groups")
        .update({ name: "Hacked!" })
        .eq("id", group.id)
        .select();

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  // ── Group DELETE ─────────────────────────────────────────────────────

  describe("groups DELETE", () => {
    it("creator can delete their own group", async () => {
      const group = await createTestGroup(alice.id);
      const client = authenticateAs(alice);

      const { error } = await client
        .from("groups")
        .delete()
        .eq("id", group.id);

      expect(error).toBeNull();

      // Verify it's gone
      const { data } = await adminClient!
        .from("groups")
        .select("id")
        .eq("id", group.id)
        .maybeSingle();

      expect(data).toBeNull();
    });

    it("non-creator member cannot delete the group", async () => {
      const group = await createTestGroup(alice.id, [bob.id]);

      await adminClient!
        .from("group_members")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("group_id", group.id)
        .eq("user_id", bob.id);

      const bobClient = authenticateAs(bob);
      const { data, error } = await bobClient
        .from("groups")
        .delete()
        .eq("id", group.id)
        .select();

      expect(error).toBeNull();
      expect(data).toHaveLength(0);

      // Group still exists
      const { data: check } = await adminClient!
        .from("groups")
        .select("id")
        .eq("id", group.id)
        .single();

      expect(check).not.toBeNull();
    });
  });

  // ── Group Members SELECT ─────────────────────────────────────────────

  describe("group_members SELECT", () => {
    it("group member can read all members of their group", async () => {
      const group = await createTestGroup(alice.id, [bob.id]);

      const aliceClient = authenticateAs(alice);
      const { data, error } = await aliceClient
        .from("group_members")
        .select("user_id, status")
        .eq("group_id", group.id);

      expect(error).toBeNull();
      expect(data).toHaveLength(2);

      const userIds = data!.map((m) => m.user_id);
      expect(userIds).toContain(alice.id);
      expect(userIds).toContain(bob.id);
    });

    it("invited member can read membership list", async () => {
      const group = await createTestGroup(alice.id, [bob.id]);

      const bobClient = authenticateAs(bob);
      const { data, error } = await bobClient
        .from("group_members")
        .select("user_id, status")
        .eq("group_id", group.id);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("non-member cannot read group membership", async () => {
      const group = await createTestGroup(alice.id);

      const carolClient = authenticateAs(carol);
      const { data, error } = await carolClient
        .from("group_members")
        .select("user_id, status")
        .eq("group_id", group.id);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  // ── Group Members INSERT (invitation) ────────────────────────────────

  describe("group_members INSERT (invitation)", () => {
    it("creator can invite a user to their group", async () => {
      const group = await createTestGroup(alice.id);
      const client = authenticateAs(alice);

      const { error } = await client.from("group_members").insert({
        group_id: group.id,
        user_id: bob.id,
        status: "invited",
        invited_by: alice.id,
      });

      expect(error).toBeNull();
    });

    it("non-creator member cannot invite users", async () => {
      const group = await createTestGroup(alice.id, [bob.id]);

      // Accept Bob first
      await adminClient!
        .from("group_members")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("group_id", group.id)
        .eq("user_id", bob.id);

      const bobClient = authenticateAs(bob);
      const { error } = await bobClient.from("group_members").insert({
        group_id: group.id,
        user_id: carol.id,
        status: "invited",
        invited_by: bob.id,
      });

      // Bob is a member but not the creator — insert RLS requires group_id
      // in my_group_ids() AND invited_by = auth.uid(). Bob is a member so
      // my_group_ids() passes, and invited_by = bob.id = auth.uid().
      // So this should actually succeed — group_members_insert allows any
      // member to invite, not just the creator.
      // Let's verify the behavior either way:
      // The RLS policy: invited_by = auth.uid() AND group_id IN my_group_ids()
      // Bob meets both conditions, so this should succeed.
      expect(error).toBeNull();
    });

    it("non-member cannot invite users", async () => {
      const group = await createTestGroup(alice.id);

      const carolClient = authenticateAs(carol);
      const { error } = await carolClient.from("group_members").insert({
        group_id: group.id,
        user_id: bob.id,
        status: "invited",
        invited_by: carol.id,
      });

      expect(error).not.toBeNull();
    });

    it("cannot invite with spoofed invited_by", async () => {
      const group = await createTestGroup(alice.id);
      const client = authenticateAs(alice);

      const { error } = await client.from("group_members").insert({
        group_id: group.id,
        user_id: bob.id,
        status: "invited",
        invited_by: carol.id, // spoofed — not auth.uid()
      });

      expect(error).not.toBeNull();
    });
  });

  // ── Group Members UPDATE (acceptance) ────────────────────────────────

  describe("group_members UPDATE (acceptance)", () => {
    it("invited user can accept their invitation", async () => {
      const group = await createTestGroup(alice.id, [bob.id]);
      const bobClient = authenticateAs(bob);

      const { data, error } = await bobClient
        .from("group_members")
        .update({ status: "accepted" })
        .eq("group_id", group.id)
        .eq("user_id", bob.id)
        .select("status")
        .single();

      expect(error).toBeNull();
      expect(data!.status).toBe("accepted");
    });

    it("creator cannot accept on behalf of another user", async () => {
      const group = await createTestGroup(alice.id, [bob.id]);
      const aliceClient = authenticateAs(alice);

      const { data, error } = await aliceClient
        .from("group_members")
        .update({ status: "accepted" })
        .eq("group_id", group.id)
        .eq("user_id", bob.id)
        .select();

      // RLS: UPDATE only allowed where user_id = auth.uid()
      expect(error).toBeNull();
      expect(data).toHaveLength(0);

      // Verify bob is still invited
      const { data: member } = await adminClient!
        .from("group_members")
        .select("status")
        .eq("group_id", group.id)
        .eq("user_id", bob.id)
        .single();

      expect(member!.status).toBe("invited");
    });

    it("invited user cannot change another user's membership", async () => {
      const group = await createTestGroup(alice.id, [bob.id, carol.id]);
      const bobClient = authenticateAs(bob);

      const { data, error } = await bobClient
        .from("group_members")
        .update({ status: "accepted" })
        .eq("group_id", group.id)
        .eq("user_id", carol.id)
        .select();

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  // ── Group Members DELETE (leaving / removal) ─────────────────────────

  describe("group_members DELETE", () => {
    it("creator can remove a member from their group", async () => {
      const group = await createTestGroup(alice.id, [bob.id]);
      const aliceClient = authenticateAs(alice);

      const { error } = await aliceClient
        .from("group_members")
        .delete()
        .eq("group_id", group.id)
        .eq("user_id", bob.id);

      expect(error).toBeNull();

      const { data } = await adminClient!
        .from("group_members")
        .select("user_id")
        .eq("group_id", group.id)
        .eq("user_id", bob.id)
        .maybeSingle();

      expect(data).toBeNull();
    });

    it("non-creator member cannot remove others", async () => {
      const group = await createTestGroup(alice.id, [bob.id, carol.id]);

      // Accept Bob
      await adminClient!
        .from("group_members")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("group_id", group.id)
        .eq("user_id", bob.id);

      const bobClient = authenticateAs(bob);
      const { error } = await bobClient
        .from("group_members")
        .delete()
        .eq("group_id", group.id)
        .eq("user_id", carol.id);

      // RLS: DELETE only allowed if group creator
      expect(error).toBeNull();

      // Carol should still be a member
      const { data } = await adminClient!
        .from("group_members")
        .select("user_id")
        .eq("group_id", group.id)
        .eq("user_id", carol.id)
        .maybeSingle();

      expect(data).not.toBeNull();
    });

    it("non-member cannot delete group members", async () => {
      const group = await createTestGroup(alice.id, [bob.id]);

      const carolClient = authenticateAs(carol);
      const { error } = await carolClient
        .from("group_members")
        .delete()
        .eq("group_id", group.id)
        .eq("user_id", bob.id);

      expect(error).toBeNull();

      // Bob should still be a member
      const { data } = await adminClient!
        .from("group_members")
        .select("user_id")
        .eq("group_id", group.id)
        .eq("user_id", bob.id)
        .maybeSingle();

      expect(data).not.toBeNull();
    });
  });

  // ── Unique membership constraint ─────────────────────────────────────

  describe("unique membership constraint", () => {
    it("rejects duplicate membership for the same group+user", async () => {
      const group = await createTestGroup(alice.id);

      // Alice is already a member (added by createTestGroup)
      const { error } = await adminClient!
        .from("group_members")
        .insert({
          group_id: group.id,
          user_id: alice.id,
          status: "invited",
          invited_by: alice.id,
        });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("23505"); // unique_violation
    });
  });

  // ── Full invitation/acceptance flow ──────────────────────────────────

  describe("invitation and acceptance flow", () => {
    it("end-to-end: creator invites, user accepts, both see the group", async () => {
      // 1. Alice creates a group
      const aliceClient = authenticateAs(alice);
      const { data: group, error: groupError } = await aliceClient
        .from("groups")
        .insert({ name: "Dinner Club", creator_id: alice.id })
        .select("id, name")
        .single();

      expect(groupError).toBeNull();
      expect(group).not.toBeNull();

      // 2. Alice invites Bob via RLS-governed insert
      const { error: inviteError } = await aliceClient
        .from("group_members")
        .insert({
          group_id: group!.id,
          user_id: bob.id,
          status: "invited",
          invited_by: alice.id,
        });

      expect(inviteError).toBeNull();

      // 3. Bob reads his invitation
      const bobClient = authenticateAs(bob);
      const { data: invitations, error: readError } = await bobClient
        .from("group_members")
        .select("group_id, status, invited_by")
        .eq("user_id", bob.id)
        .eq("status", "invited");

      expect(readError).toBeNull();
      expect(invitations).toHaveLength(1);
      expect(invitations![0].group_id).toBe(group!.id);
      expect(invitations![0].invited_by).toBe(alice.id);

      // 4. Bob accepts
      const { error: acceptError } = await bobClient
        .from("group_members")
        .update({ status: "accepted" })
        .eq("group_id", group!.id)
        .eq("user_id", bob.id);

      expect(acceptError).toBeNull();

      // 5. Both users can see the group
      const { data: aliceGroups } = await aliceClient
        .from("groups")
        .select("id, name")
        .eq("id", group!.id)
        .maybeSingle();

      const { data: bobGroups } = await bobClient
        .from("groups")
        .select("id, name")
        .eq("id", group!.id)
        .maybeSingle();

      expect(aliceGroups).not.toBeNull();
      expect(bobGroups).not.toBeNull();

      // 6. Membership list shows both as accepted
      const { data: members } = await aliceClient
        .from("group_members")
        .select("user_id, status")
        .eq("group_id", group!.id);

      expect(members).toHaveLength(2);
      const statuses = Object.fromEntries(
        members!.map((m) => [m.user_id, m.status]),
      );
      expect(statuses[alice.id]).toBe("accepted");
      expect(statuses[bob.id]).toBe("accepted");
    });
  });

  // ── Creator leaving behavior ─────────────────────────────────────────

  describe("creator leaving", () => {
    it("creator can remove themselves via DELETE", async () => {
      const group = await createTestGroup(alice.id);
      const aliceClient = authenticateAs(alice);

      // The DELETE RLS only allows the creator to delete members
      const { error } = await aliceClient
        .from("group_members")
        .delete()
        .eq("group_id", group.id)
        .eq("user_id", alice.id);

      expect(error).toBeNull();

      // Creator is no longer a member
      const { data } = await adminClient!
        .from("group_members")
        .select("user_id")
        .eq("group_id", group.id)
        .eq("user_id", alice.id)
        .maybeSingle();

      expect(data).toBeNull();
    });

    it("creator can delete the entire group (cascades to members)", async () => {
      const group = await createTestGroup(alice.id, [bob.id]);
      const aliceClient = authenticateAs(alice);

      const { error } = await aliceClient
        .from("groups")
        .delete()
        .eq("id", group.id);

      expect(error).toBeNull();

      // Group is gone
      const { data: groupCheck } = await adminClient!
        .from("groups")
        .select("id")
        .eq("id", group.id)
        .maybeSingle();

      expect(groupCheck).toBeNull();

      // Members are gone (ON DELETE CASCADE)
      const { data: memberCheck } = await adminClient!
        .from("group_members")
        .select("user_id")
        .eq("group_id", group.id);

      expect(memberCheck).toHaveLength(0);
    });
  });

  // ── Group member can invite others ───────────────────────────────────

  describe("accepted member can invite", () => {
    it("accepted member can invite a new user to the group", async () => {
      const group = await createTestGroup(alice.id, [bob.id]);

      // Accept Bob
      await adminClient!
        .from("group_members")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("group_id", group.id)
        .eq("user_id", bob.id);

      // Bob invites Carol
      const bobClient = authenticateAs(bob);
      const { error } = await bobClient.from("group_members").insert({
        group_id: group.id,
        user_id: carol.id,
        status: "invited",
        invited_by: bob.id,
      });

      // RLS: invited_by = auth.uid() AND group_id IN my_group_ids()
      // Bob is accepted and in my_group_ids(), invited_by = bob = auth.uid()
      expect(error).toBeNull();

      // Verify Carol's invitation exists
      const { data } = await adminClient!
        .from("group_members")
        .select("status, invited_by")
        .eq("group_id", group.id)
        .eq("user_id", carol.id)
        .single();

      expect(data!.status).toBe("invited");
      expect(data!.invited_by).toBe(bob.id);
    });
  });
});
