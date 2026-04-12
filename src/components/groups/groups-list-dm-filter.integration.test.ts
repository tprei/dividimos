import { describe, it, expect, beforeAll } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  createTestUsers,
  createTestGroupWithMembers,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";

describe.skipIf(!isIntegrationTestReady)(
  "Groups list excludes DM groups",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let regularGroupId: string;
    let dmGroupId: string;

    beforeAll(async () => {
      [alice, bob] = await createTestUsers(2);

      const regularGroup = await createTestGroupWithMembers(alice, [bob]);
      regularGroupId = regularGroup.id;

      const { data: dmGroup, error: dmErr } = await adminClient!
        .from("groups")
        .insert({ name: "DM: alice-bob", creator_id: alice.id, is_dm: true })
        .select()
        .single();
      if (dmErr || !dmGroup) throw new Error(`Failed to create DM group: ${dmErr?.message}`);
      dmGroupId = dmGroup.id;

      await adminClient!.from("group_members").insert([
        { group_id: dmGroupId, user_id: alice.id, status: "accepted", invited_by: alice.id },
        { group_id: dmGroupId, user_id: bob.id, status: "accepted", invited_by: alice.id },
      ]);
    });

    it("regular query without is_dm filter returns both groups", async () => {
      const supabase = authenticateAs(alice);
      const { data } = await supabase
        .from("groups")
        .select("id")
        .in("id", [regularGroupId, dmGroupId]);

      const ids = (data ?? []).map((r) => r.id);
      expect(ids).toContain(regularGroupId);
      expect(ids).toContain(dmGroupId);
    });

    it("query with is_dm=false excludes DM groups", async () => {
      const supabase = authenticateAs(alice);
      const { data } = await supabase
        .from("groups")
        .select("id")
        .in("id", [regularGroupId, dmGroupId])
        .eq("is_dm", false);

      const ids = (data ?? []).map((r) => r.id);
      expect(ids).toContain(regularGroupId);
      expect(ids).not.toContain(dmGroupId);
    });

    it("query with is_dm=true returns only DM groups", async () => {
      const supabase = authenticateAs(alice);
      const { data } = await supabase
        .from("groups")
        .select("id")
        .in("id", [regularGroupId, dmGroupId])
        .eq("is_dm", true);

      const ids = (data ?? []).map((r) => r.id);
      expect(ids).not.toContain(regularGroupId);
      expect(ids).toContain(dmGroupId);
    });

    it("creator_id query with is_dm=false excludes DM groups", async () => {
      const supabase = authenticateAs(alice);
      const { data } = await supabase
        .from("groups")
        .select("id")
        .eq("creator_id", alice.id)
        .eq("is_dm", false);

      const ids = (data ?? []).map((r) => r.id);
      expect(ids).toContain(regularGroupId);
      expect(ids).not.toContain(dmGroupId);
    });
  },
);
