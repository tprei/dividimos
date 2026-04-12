import { describe, it, expect, beforeAll } from "vitest";
import { isIntegrationTestReady, adminClient } from "@/test/integration-setup";
import {
  createTestUser,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";

describe.skipIf(!isIntegrationTestReady)(
  "dm_pairs RLS policies",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;
    let dmGroupId: string;

    beforeAll(async () => {
      [alice, bob, carol] = await Promise.all([
        createTestUser({ handle: "dmpairs_alice" }),
        createTestUser({ handle: "dmpairs_bob" }),
        createTestUser({ handle: "dmpairs_carol" }),
      ]);

      // Create DM via RPC
      const aliceClient = authenticateAs(alice);
      const { data, error } = await aliceClient.rpc(
        "get_or_create_dm_group",
        { p_other_user_id: bob.id },
      );
      if (error) throw new Error(`RPC failed: ${error.message}`);
      dmGroupId = data as string;
    });

    describe("SELECT", () => {
      it("allows pair member to read their dm_pairs row", async () => {
        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient
          .from("dm_pairs")
          .select("*")
          .eq("group_id", dmGroupId);

        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      });

      it("allows the other pair member to read the same row", async () => {
        const bobClient = authenticateAs(bob);
        const { data, error } = await bobClient
          .from("dm_pairs")
          .select("*")
          .eq("group_id", dmGroupId);

        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      });

      it("prevents non-member from reading dm_pairs rows", async () => {
        const carolClient = authenticateAs(carol);
        const { data, error } = await carolClient
          .from("dm_pairs")
          .select("*")
          .eq("group_id", dmGroupId);

        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });

      it("user only sees dm_pairs they belong to", async () => {
        // Carol creates a DM with alice
        const carolClient = authenticateAs(carol);
        await carolClient.rpc("get_or_create_dm_group", {
          p_other_user_id: alice.id,
        });

        // Carol should see exactly 1 dm_pair (with alice), not the alice-bob pair
        const { data } = await carolClient.from("dm_pairs").select("*");
        expect(data).toHaveLength(1);

        const pair = data![0];
        const pairUserIds = [pair.user_a, pair.user_b].sort();
        const expectedIds = [alice.id, carol.id].sort();
        expect(pairUserIds).toEqual(expectedIds);
      });
    });

    describe("direct INSERT", () => {
      it("rejects direct insert into dm_pairs", async () => {
        const aliceClient = authenticateAs(alice);
        const [userA, userB] =
          alice.id < carol.id
            ? [alice.id, carol.id]
            : [carol.id, alice.id];

        const { error } = await aliceClient.from("dm_pairs").insert({
          group_id: "00000000-0000-0000-0000-000000000000",
          user_a: userA,
          user_b: userB,
        });

        expect(error).toBeTruthy();
      });
    });

    describe("direct UPDATE", () => {
      it("rejects direct update of dm_pairs", async () => {
        const aliceClient = authenticateAs(alice);
        const { data } = await aliceClient
          .from("dm_pairs")
          .update({ user_a: carol.id })
          .eq("group_id", dmGroupId)
          .select();

        // RLS blocks — no rows updated
        expect(data).toHaveLength(0);
      });
    });

    describe("direct DELETE", () => {
      it("rejects direct delete from dm_pairs", async () => {
        const aliceClient = authenticateAs(alice);
        const { data } = await aliceClient
          .from("dm_pairs")
          .delete()
          .eq("group_id", dmGroupId)
          .select();

        // RLS blocks — no rows deleted
        expect(data).toHaveLength(0);

        // Verify the row still exists
        const { data: adminData } = await adminClient!
          .from("dm_pairs")
          .select("*")
          .eq("group_id", dmGroupId);
        expect(adminData).toHaveLength(1);
      });
    });
  },
);
