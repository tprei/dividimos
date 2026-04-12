import { describe, it, expect, beforeEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  createTestUsers,
  createTestGroupWithMembers,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

// The group_invite_links table and join_group_via_link RPC types are added
// in a separate migration types PR. Use untyped Supabase clients so that
// .from("group_invite_links") and .rpc("join_group_via_link") compile before
// the Database type is extended.

function untypedAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function untypedAs(user: TestUser) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${user.accessToken}` },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

describe.skipIf(!isIntegrationTestReady)(
  "group_invite_links table & join_group_via_link RPC",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;
    let groupId: string;

    beforeEach(async () => {
      [alice, bob, carol] = await createTestUsers(3);
      const group = await createTestGroupWithMembers(alice, [bob]);
      groupId = group.id;
    });

    // ── Table RLS ───────────────────────────────────────────────

    describe("RLS policies", () => {
      it("group creator can insert an invite link", async () => {
        const client = untypedAs(alice);
        const { data, error } = await client
          .from("group_invite_links")
          .insert({ group_id: groupId, created_by: alice.id })
          .select()
          .single();

        expect(error).toBeNull();
        expect(data).not.toBeNull();
        expect(data!.token).toBeTruthy();
        expect(data!.is_active).toBe(true);
        expect(data!.use_count).toBe(0);
      });

      it("accepted member can insert an invite link", async () => {
        const client = untypedAs(bob);
        const { data, error } = await client
          .from("group_invite_links")
          .insert({ group_id: groupId, created_by: bob.id })
          .select()
          .single();

        expect(error).toBeNull();
        expect(data).not.toBeNull();
      });

      it("non-member cannot insert an invite link", async () => {
        const client = untypedAs(carol);
        const { error } = await client
          .from("group_invite_links")
          .insert({ group_id: groupId, created_by: carol.id });

        expect(error).not.toBeNull();
      });

      it("accepted group member can read invite links", async () => {
        await untypedAdmin()
          .from("group_invite_links")
          .insert({ group_id: groupId, created_by: alice.id });

        const client = untypedAs(bob);
        const { data, error } = await client
          .from("group_invite_links")
          .select()
          .eq("group_id", groupId);

        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      });

      it("non-member cannot read invite links", async () => {
        await untypedAdmin()
          .from("group_invite_links")
          .insert({ group_id: groupId, created_by: alice.id });

        const client = untypedAs(carol);
        const { data, error } = await client
          .from("group_invite_links")
          .select()
          .eq("group_id", groupId);

        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });

      it("link creator can deactivate their link", async () => {
        const { data: link } = await untypedAdmin()
          .from("group_invite_links")
          .insert({ group_id: groupId, created_by: bob.id })
          .select("id")
          .single();

        const client = untypedAs(bob);
        const { error } = await client
          .from("group_invite_links")
          .update({ is_active: false })
          .eq("id", link!.id);

        expect(error).toBeNull();
      });

      it("group creator can deactivate any link in their group", async () => {
        const { data: link } = await untypedAdmin()
          .from("group_invite_links")
          .insert({ group_id: groupId, created_by: bob.id })
          .select("id")
          .single();

        const client = untypedAs(alice);
        const { error } = await client
          .from("group_invite_links")
          .update({ is_active: false })
          .eq("id", link!.id);

        expect(error).toBeNull();
      });
    });

    // ── join_group_via_link RPC ──────────────────────────────────

    describe("join_group_via_link", () => {
      let token: string;

      beforeEach(async () => {
        const { data } = await untypedAdmin()
          .from("group_invite_links")
          .insert({ group_id: groupId, created_by: alice.id })
          .select("token")
          .single();
        token = data!.token;
      });

      it("new user joins group via link", async () => {
        const client = untypedAs(carol);
        const { data, error } = await client.rpc("join_group_via_link", {
          p_token: token,
        });

        expect(error).toBeNull();
        expect(data).toMatchObject({
          group_id: groupId,
          already_member: false,
          status: "accepted",
        });

        const { data: membership } = await adminClient!
          .from("group_members")
          .select("status")
          .eq("group_id", groupId)
          .eq("user_id", carol.id)
          .single();

        expect(membership!.status).toBe("accepted");
      });

      it("increments use_count on successful join", async () => {
        const client = untypedAs(carol);
        await client.rpc("join_group_via_link", { p_token: token });

        const { data: link } = await untypedAdmin()
          .from("group_invite_links")
          .select("use_count")
          .eq("group_id", groupId)
          .single();

        expect(link!.use_count).toBe(1);
      });

      it("upgrades invited member to accepted", async () => {
        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: carol.id,
          status: "invited" as const,
          invited_by: alice.id,
        });

        const client = untypedAs(carol);
        const { data, error } = await client.rpc("join_group_via_link", {
          p_token: token,
        });

        expect(error).toBeNull();
        expect(data).toMatchObject({
          already_member: false,
          status: "accepted",
        });

        const { data: membership } = await adminClient!
          .from("group_members")
          .select("status")
          .eq("group_id", groupId)
          .eq("user_id", carol.id)
          .single();

        expect(membership!.status).toBe("accepted");
      });

      it("returns already_member for accepted members without incrementing", async () => {
        const client = untypedAs(bob);
        const { data, error } = await client.rpc("join_group_via_link", {
          p_token: token,
        });

        expect(error).toBeNull();
        expect(data).toMatchObject({
          already_member: true,
          status: "accepted",
        });

        const { data: link } = await untypedAdmin()
          .from("group_invite_links")
          .select("use_count")
          .eq("group_id", groupId)
          .single();

        expect(link!.use_count).toBe(0);
      });

      it("rejects inactive link", async () => {
        await untypedAdmin()
          .from("group_invite_links")
          .update({ is_active: false })
          .eq("group_id", groupId);

        const client = untypedAs(carol);
        const { error } = await client.rpc("join_group_via_link", {
          p_token: token,
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("link_inactive");
      });

      it("rejects expired link", async () => {
        await untypedAdmin()
          .from("group_invite_links")
          .update({ expires_at: new Date("2020-01-01").toISOString() })
          .eq("group_id", groupId);

        const client = untypedAs(carol);
        const { error } = await client.rpc("join_group_via_link", {
          p_token: token,
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("link_expired");
      });

      it("rejects link that has reached max_uses", async () => {
        await untypedAdmin()
          .from("group_invite_links")
          .update({ max_uses: 1, use_count: 1 })
          .eq("group_id", groupId);

        const client = untypedAs(carol);
        const { error } = await client.rpc("join_group_via_link", {
          p_token: token,
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("link_exhausted");
      });

      it("rejects invalid token", async () => {
        const client = untypedAs(carol);
        const { error } = await client.rpc("join_group_via_link", {
          p_token: "00000000-0000-0000-0000-000000000000",
        });

        expect(error).not.toBeNull();
        expect(error!.message).toContain("invalid_token");
      });
    });
  },
);
