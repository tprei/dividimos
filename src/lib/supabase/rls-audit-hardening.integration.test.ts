import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  createTestUsers,
  createTestGroup,
  createTestGroupWithMembers,
  createTestDmGroup,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";

// Some of these checks probe columns that are not in the generated Database
// types (chat_messages, is_dm, etc.), so we fall back to an untyped client
// for those surfaces — mirrors the pattern in rls-hardening.integration.test.ts.
function untypedAs(user: TestUser) {
  if (!user.accessToken) {
    throw new Error(`User ${user.handle} has no access token`);
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

function expectRlsFailure(error: { message: string } | null) {
  expect(error).not.toBeNull();
  expect(error!.message.toLowerCase()).toMatch(
    /row-level security|permission|violates|immutable|cannot be modified/,
  );
}

describe.skipIf(!isIntegrationTestReady)("RLS audit hardening", () => {
  // ────────────────────────────────────────────────────────
  // group_members: accept is RPC-only; every direct client UPDATE is
  // denied regardless of target columns (#471/#472 cutover).
  // ────────────────────────────────────────────────────────
  describe("group_members accept is RPC-only", () => {
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;
    let invitedGroupId: string;
    let otherGroupId: string;

    beforeAll(async () => {
      [alice, bob, carol] = await createTestUsers(3);

      const invited = await createTestGroup(alice.id, [bob.id]);
      invitedGroupId = invited.id;

      const other = await createTestGroup(carol.id, []);
      otherGroupId = other.id;
    });

    it("accept_group_invitation flips status/accepted_at for the invitee", async () => {
      const client = authenticateAs(bob);
      const { error } = await client.rpc("accept_group_invitation", {
        p_group_id: invitedGroupId,
      });

      expect(error).toBeNull();

      const { data } = await adminClient!
        .from("group_members")
        .select("status, accepted_at")
        .eq("group_id", invitedGroupId)
        .eq("user_id", bob.id)
        .single();
      expect(data!.status).toBe("accepted");
      expect(data!.accepted_at).not.toBeNull();
    });

    it("accept_group_invitation rejects a caller with no invitation", async () => {
      const client = authenticateAs(carol);
      const { error } = await client.rpc("accept_group_invitation", {
        p_group_id: invitedGroupId,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not_a_member/);
    });

    it("accept_group_invitation rejects re-accepting an already-accepted row", async () => {
      // Bob was accepted in the first test above.
      const client = authenticateAs(bob);
      const { error } = await client.rpc("accept_group_invitation", {
        p_group_id: invitedGroupId,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not_invited/);
    });

    it("rejects any direct client UPDATE on group_members, regardless of target columns", async () => {
      const [dave] = await createTestUsers(1);
      const staging = await createTestGroup(alice.id, [dave.id]);

      const client = authenticateAs(dave);
      const { error, count } = await client
        .from("group_members")
        .update(
          {
            group_id: otherGroupId,
            status: "accepted",
            accepted_at: new Date().toISOString(),
          },
          { count: "exact" },
        )
        .eq("group_id", staging.id)
        .eq("user_id", dave.id);

      if (error) {
        expectRlsFailure(error);
      } else {
        expect(count ?? 0).toBe(0);
      }

      const { data: retargeted } = await adminClient!
        .from("group_members")
        .select("group_id, user_id, status")
        .eq("group_id", otherGroupId)
        .eq("user_id", dave.id);
      expect(retargeted ?? []).toHaveLength(0);

      const { data: original } = await adminClient!
        .from("group_members")
        .select("status")
        .eq("group_id", staging.id)
        .eq("user_id", dave.id)
        .single();
      expect(original!.status).toBe("invited");
    });

    it("a self-only mutable-field UPDATE is also denied (no policy-based accept path remains)", async () => {
      const [erin] = await createTestUsers(1);
      const staging = await createTestGroup(alice.id, [erin.id]);

      const client = authenticateAs(erin);
      const { error, count } = await client
        .from("group_members")
        .update(
          { status: "accepted", accepted_at: new Date().toISOString() },
          { count: "exact" },
        )
        .eq("group_id", staging.id)
        .eq("user_id", erin.id);

      if (error) {
        expectRlsFailure(error);
      } else {
        expect(count ?? 0).toBe(0);
      }

      const { data } = await adminClient!
        .from("group_members")
        .select("status")
        .eq("group_id", staging.id)
        .eq("user_id", erin.id)
        .single();
      expect(data!.status).toBe("invited");
    });
  });

  // ────────────────────────────────────────────────────────
  // users_update_own — id/email/avatar_url/created_at pinned
  // ────────────────────────────────────────────────────────
  describe("users_update_own blocks immutable column changes", () => {
    let alice: TestUser;
    let bob: TestUser;

    beforeAll(async () => {
      [alice, bob] = await createTestUsers(2);
    });

    it("allows a user to update their own mutable fields", async () => {
      const client = authenticateAs(alice);
      const { error } = await client
        .from("users")
        .update({ name: "Alice Updated" })
        .eq("id", alice.id);

      expect(error).toBeNull();
    });

    it("rejects an attempt to change the row's id", async () => {
      const client = authenticateAs(alice);
      const { error } = await client
        .from("users")
        .update({ id: bob.id })
        .eq("id", alice.id);

      expectRlsFailure(error);
    });

    it("rejects an attempt to change email directly", async () => {
      const client = authenticateAs(alice);
      const { error } = await client
        .from("users")
        .update({ email: "forged@example.com" })
        .eq("id", alice.id);

      expectRlsFailure(error);
    });

    it("rejects an attempt to change avatar_url directly", async () => {
      const client = authenticateAs(alice);
      const { error } = await client
        .from("users")
        .update({ avatar_url: "https://evil.example.com/a.png" })
        .eq("id", alice.id);

      expectRlsFailure(error);
    });

    it("rejects an UPDATE on another user's row", async () => {
      const client = authenticateAs(alice);
      const { error, count } = await client
        .from("users")
        .update({ name: "Impersonated" }, { count: "exact" })
        .eq("id", bob.id);

      if (error) {
        expectRlsFailure(error);
      } else {
        expect(count ?? 0).toBe(0);
      }

      const { data } = await adminClient!
        .from("users")
        .select("name")
        .eq("id", bob.id)
        .single();
      expect(data!.name).not.toBe("Impersonated");
    });
  });

  // ────────────────────────────────────────────────────────
  // groups UPDATE — is_dm pinned to false
  // ────────────────────────────────────────────────────────
  describe("group_update pins is_dm", () => {
    let alice: TestUser;
    let bob: TestUser;
    let regularGroupId: string;
    let dmGroupId: string;

    beforeAll(async () => {
      [alice, bob] = await createTestUsers(2);
      const group = await createTestGroup(alice.id, []);
      regularGroupId = group.id;

      const dm = await createTestDmGroup(alice, bob);
      dmGroupId = dm.id;
    });

    it("allows renaming a non-DM group", async () => {
      const client = authenticateAs(alice);
      const { error } = await client
        .from("groups")
        .update({ name: "Renamed" })
        .eq("id", regularGroupId);

      expect(error).toBeNull();
    });

    it("rejects flipping is_dm = true on a non-DM group", async () => {
      const client = untypedAs(alice);
      const { error, count } = await client
        .from("groups")
        .update({ is_dm: true }, { count: "exact" })
        .eq("id", regularGroupId);

      if (error) {
        expectRlsFailure(error);
      } else {
        expect(count ?? 0).toBe(0);
      }

      const { data } = await adminClient!
        .from("groups")
        .select("is_dm")
        .eq("id", regularGroupId)
        .single();
      expect((data as { is_dm: boolean }).is_dm).toBe(false);
    });

    it("rejects any UPDATE on a DM group (USING excludes is_dm=true rows)", async () => {
      const client = untypedAs(alice);
      const { error, count } = await client
        .from("groups")
        .update({ name: "Stolen DM" }, { count: "exact" })
        .eq("id", dmGroupId);

      if (error) {
        expectRlsFailure(error);
      } else {
        expect(count ?? 0).toBe(0);
      }

      const { data } = await adminClient!
        .from("groups")
        .select("name, is_dm")
        .eq("id", dmGroupId)
        .single();
      expect((data as { is_dm: boolean }).is_dm).toBe(true);
      expect((data as { name: string }).name).not.toBe("Stolen DM");
    });
  });

  // ────────────────────────────────────────────────────────
  // chat_messages_update — system message forgery blocked
  // ────────────────────────────────────────────────────────
  describe("chat_messages_update blocks message_type forgery", () => {
    let alice: TestUser;
    let bob: TestUser;
    let groupId: string;
    let messageId: string;

    beforeAll(async () => {
      [alice, bob] = await createTestUsers(2);
      const group = await createTestGroupWithMembers(alice, [bob]);
      groupId = group.id;

      const client = untypedAs(alice);
      const { data, error } = await client
        .from("chat_messages")
        .insert({
          group_id: groupId,
          sender_id: alice.id,
          message_type: "text",
          content: "original",
        })
        .select("id")
        .single();

      if (error || !data) {
        throw new Error(`Failed to seed message: ${error?.message}`);
      }
      messageId = (data as { id: string }).id;
    });

    it("allows the sender to edit the text content", async () => {
      const client = untypedAs(alice);
      const { error } = await client
        .from("chat_messages")
        .update({ content: "edited" })
        .eq("id", messageId);

      expect(error).toBeNull();
    });

    it("rejects flipping message_type to system_expense", async () => {
      const client = untypedAs(alice);
      const { error, count } = await client
        .from("chat_messages")
        .update(
          {
            message_type: "system_expense",
            content: "",
          },
          { count: "exact" },
        )
        .eq("id", messageId);

      if (error) {
        expectRlsFailure(error);
      } else {
        expect(count ?? 0).toBe(0);
      }

      const { data } = await adminClient!
        .from("chat_messages")
        .select("message_type")
        .eq("id", messageId)
        .single();
      expect((data as { message_type: string }).message_type).toBe("text");
    });
  });

  // ────────────────────────────────────────────────────────
  // settlements_insert — authenticated writes are closed
  // ────────────────────────────────────────────────────────
  describe("settlements_insert denies authenticated writes", () => {
    let alice: TestUser;
    let bob: TestUser;
    let groupId: string;

    beforeAll(async () => {
      [alice, bob] = await createTestUsers(2);
      const group = await createTestGroupWithMembers(alice, [bob]);
      groupId = group.id;
    });

    it("denies a pending settlement inserted by the debtor", async () => {
      const client = authenticateAs(alice);
      const { error } = await client.from("settlements").insert({
        group_id: groupId,
        from_user_id: alice.id,
        to_user_id: bob.id,
        amount_cents: 1000,
      });

      expectRlsFailure(error);
    });

    it("denies a pre-confirmed settlement insert", async () => {
      const client = authenticateAs(alice);
      const { error } = await client.from("settlements").insert({
        group_id: groupId,
        from_user_id: alice.id,
        to_user_id: bob.id,
        amount_cents: 2000,
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      });

      expectRlsFailure(error);
    });

    it("denies a settlement insert with confirmed_at populated", async () => {
      const client = authenticateAs(alice);
      const { error } = await client.from("settlements").insert({
        group_id: groupId,
        from_user_id: alice.id,
        to_user_id: bob.id,
        amount_cents: 3000,
        confirmed_at: new Date().toISOString(),
      });

      expectRlsFailure(error);
    });
  });
});
