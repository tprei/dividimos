import { describe, it, expect, beforeAll } from "vitest";
import { isIntegrationTestReady, adminClient } from "@/test/integration-setup";
import {
  createTestUser,
  createAndActivateExpense,
  getBalanceBetween,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";

describe.skipIf(!isIntegrationTestReady)(
  "DM group: inline settlement on expense conclusion",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let dmGroupId: string;

    beforeAll(async () => {
      [alice, bob] = await Promise.all([
        createTestUser({ handle: "dm_concl_alice" }),
        createTestUser({ handle: "dm_concl_bob" }),
      ]);

      // Create a shared group so DM RPC auto-accepts both
      const { data: sharedGroup, error: sharedErr } = await adminClient!
        .from("groups")
        .insert({ name: "Shared for DM", creator_id: alice.id })
        .select("id")
        .single();
      if (sharedErr) throw new Error(sharedErr.message);

      await adminClient!.from("group_members").insert([
        { group_id: sharedGroup!.id, user_id: alice.id, status: "accepted", invited_by: alice.id },
        { group_id: sharedGroup!.id, user_id: bob.id, status: "accepted", invited_by: alice.id },
      ]);

      // Create DM group
      const aliceClient = authenticateAs(alice);
      const { data, error } = await aliceClient.rpc("get_or_create_dm_group", {
        p_other_user_id: bob.id,
      });
      if (error) throw new Error(error.message);
      dmGroupId = data as string;
    });

    it("DM group has is_dm=true and exactly 2 accepted members", async () => {
      const { data: group } = await adminClient!
        .from("groups")
        .select("is_dm")
        .eq("id", dmGroupId)
        .single();
      expect(group!.is_dm).toBe(true);

      const { data: members } = await adminClient!
        .from("group_members")
        .select("user_id, status")
        .eq("group_id", dmGroupId);
      expect(members).toHaveLength(2);
      expect(members!.every((m) => m.status === "accepted")).toBe(true);
    });

    it("dm_pairs row exists with correct user pair", async () => {
      const { data: pair } = await adminClient!
        .from("dm_pairs")
        .select("user_a, user_b")
        .eq("group_id", dmGroupId)
        .single();

      expect(pair).toBeTruthy();
      const ids = new Set([pair!.user_a, pair!.user_b]);
      expect(ids).toEqual(new Set([alice.id, bob.id]));
    });

    it("activating an expense creates a single balance row between the two users", async () => {
      await createAndActivateExpense({
        creator: alice,
        groupId: dmGroupId,
        shares: [
          { userId: alice.id, amount: 3000 },
          { userId: bob.id, amount: 3000 },
        ],
        payers: [{ userId: alice.id, amount: 6000 }],
        title: "Jantar DM",
      });

      const balance = await getBalanceBetween(dmGroupId, bob.id, alice.id);
      expect(balance).toBe(3000);

      // There should be exactly one balance row for this group
      const { data: rows } = await adminClient!
        .from("balances")
        .select("*")
        .eq("group_id", dmGroupId);
      expect(rows).toHaveLength(1);
    });

    it("getGroupNavUrl-equivalent query returns isDm=true for the DM group", async () => {
      // Replicate what getGroupNavUrl does at the DB level
      const aliceClient = authenticateAs(alice);

      const { data: group } = await aliceClient
        .from("groups")
        .select("is_dm")
        .eq("id", dmGroupId)
        .single();
      expect(group!.is_dm).toBe(true);

      const { data: pair } = await aliceClient
        .from("dm_pairs")
        .select("user_a, user_b")
        .eq("group_id", dmGroupId)
        .single();
      expect(pair).toBeTruthy();

      const counterpartyId =
        pair!.user_a === alice.id ? pair!.user_b : pair!.user_a;
      expect(counterpartyId).toBe(bob.id);
    });

    it("settling via RPC zeroes out the DM balance", async () => {
      const bobClient = authenticateAs(bob);
      const { error } = await bobClient.rpc("record_and_settle", {
        p_group_id: dmGroupId,
        p_from_user_id: bob.id,
        p_to_user_id: alice.id,
        p_amount_cents: 3000,
      });
      expect(error).toBeNull();

      const balance = await getBalanceBetween(dmGroupId, bob.id, alice.id);
      expect(balance).toBe(0);
    });
  },
);
