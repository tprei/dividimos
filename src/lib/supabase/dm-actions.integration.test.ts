import { describe, it, expect, beforeAll } from "vitest";
import { isIntegrationTestReady, adminClient } from "@/test/integration-setup";
import {
  createTestUser,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";

describe.skipIf(!isIntegrationTestReady)(
  "get_or_create_dm_group RPC",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;

    beforeAll(async () => {
      [alice, bob, carol] = await Promise.all([
        createTestUser({ handle: "dm_rpc_alice" }),
        createTestUser({ handle: "dm_rpc_bob" }),
        createTestUser({ handle: "dm_rpc_carol" }),
      ]);
    });

    it("creates a new DM group between two users", async () => {
      const aliceClient = authenticateAs(alice);

      const { data: groupId, error } = await aliceClient.rpc(
        "get_or_create_dm_group",
        { p_other_user_id: bob.id },
      );

      expect(error).toBeNull();
      expect(groupId).toBeTruthy();
      expect(typeof groupId).toBe("string");

      // Verify the group is marked as DM
      const { data: group } = await adminClient!
        .from("groups")
        .select("is_dm, creator_id")
        .eq("id", groupId!)
        .single();

      expect(group!.is_dm).toBe(true);
      expect(group!.creator_id).toBe(alice.id);
    });

    it("returns the same group on subsequent calls", async () => {
      const aliceClient = authenticateAs(alice);

      const { data: groupId1 } = await aliceClient.rpc(
        "get_or_create_dm_group",
        { p_other_user_id: bob.id },
      );

      const { data: groupId2 } = await aliceClient.rpc(
        "get_or_create_dm_group",
        { p_other_user_id: bob.id },
      );

      expect(groupId1).toBe(groupId2);
    });

    it("returns the same group regardless of who calls it", async () => {
      const aliceClient = authenticateAs(alice);
      const bobClient = authenticateAs(bob);

      const { data: groupIdFromAlice } = await aliceClient.rpc(
        "get_or_create_dm_group",
        { p_other_user_id: bob.id },
      );

      const { data: groupIdFromBob } = await bobClient.rpc(
        "get_or_create_dm_group",
        { p_other_user_id: alice.id },
      );

      expect(groupIdFromAlice).toBe(groupIdFromBob);
    });

    it("adds both users as accepted group members", async () => {
      const aliceClient = authenticateAs(alice);

      const { data: groupId } = await aliceClient.rpc(
        "get_or_create_dm_group",
        { p_other_user_id: bob.id },
      );

      const { data: members } = await adminClient!
        .from("group_members")
        .select("user_id, status")
        .eq("group_id", groupId!);

      expect(members).toHaveLength(2);
      const userIds = members!.map((m) => m.user_id).sort();
      const expectedIds = [alice.id, bob.id].sort();
      expect(userIds).toEqual(expectedIds);
      expect(members!.every((m) => m.status === "accepted")).toBe(true);
    });

    it("creates a dm_pairs row with canonical ordering", async () => {
      const aliceClient = authenticateAs(alice);

      const { data: groupId } = await aliceClient.rpc(
        "get_or_create_dm_group",
        { p_other_user_id: bob.id },
      );

      const { data: pair } = await adminClient!
        .from("dm_pairs")
        .select("user_a, user_b")
        .eq("group_id", groupId!)
        .single();

      expect(pair).toBeTruthy();
      // user_a < user_b (canonical ordering)
      expect(pair!.user_a < pair!.user_b).toBe(true);
      const pairIds = [pair!.user_a, pair!.user_b].sort();
      const expectedIds = [alice.id, bob.id].sort();
      expect(pairIds).toEqual(expectedIds);
    });

    it("creates different groups for different user pairs", async () => {
      const aliceClient = authenticateAs(alice);

      const { data: groupWithBob } = await aliceClient.rpc(
        "get_or_create_dm_group",
        { p_other_user_id: bob.id },
      );

      const { data: groupWithCarol } = await aliceClient.rpc(
        "get_or_create_dm_group",
        { p_other_user_id: carol.id },
      );

      expect(groupWithBob).not.toBe(groupWithCarol);
    });

    it("rejects DM with yourself", async () => {
      const aliceClient = authenticateAs(alice);

      const { error } = await aliceClient.rpc("get_or_create_dm_group", {
        p_other_user_id: alice.id,
      });

      expect(error).toBeTruthy();
      expect(error!.message).toContain("cannot create a DM with yourself");
    });

    it("rejects DM with non-existent user", async () => {
      const aliceClient = authenticateAs(alice);

      const { error } = await aliceClient.rpc("get_or_create_dm_group", {
        p_other_user_id: "00000000-0000-0000-0000-000000000000",
      });

      expect(error).toBeTruthy();
      expect(error!.message).toContain("user_not_found");
    });

    it("handles concurrent calls without creating duplicates", async () => {
      // Create fresh users so no DM exists yet
      const [user1, user2] = await Promise.all([
        createTestUser({ handle: "dm_race_a" }),
        createTestUser({ handle: "dm_race_b" }),
      ]);

      const client1 = authenticateAs(user1);
      const client2 = authenticateAs(user2);

      // Fire both calls concurrently
      const [result1, result2] = await Promise.all([
        client1.rpc("get_or_create_dm_group", {
          p_other_user_id: user2.id,
        }),
        client2.rpc("get_or_create_dm_group", {
          p_other_user_id: user1.id,
        }),
      ]);

      // Both should succeed
      expect(result1.error).toBeNull();
      expect(result2.error).toBeNull();

      // Both should return the same group
      expect(result1.data).toBe(result2.data);

      // Only one dm_pairs row should exist
      const [userA, userB] =
        user1.id < user2.id
          ? [user1.id, user2.id]
          : [user2.id, user1.id];

      const { data: pairs } = await adminClient!
        .from("dm_pairs")
        .select("group_id")
        .eq("user_a", userA)
        .eq("user_b", userB);

      expect(pairs).toHaveLength(1);
    });
  },
);
