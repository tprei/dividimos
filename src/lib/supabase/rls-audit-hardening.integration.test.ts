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
  // group_members_accept — forgery is blocked
  // ────────────────────────────────────────────────────────
  describe("group_members_accept blocks identity forgery", () => {
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

    it("allows the invitee to accept by flipping only status/accepted_at", async () => {
      const client = authenticateAs(bob);
      const { error } = await client
        .from("group_members")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("group_id", invitedGroupId)
        .eq("user_id", bob.id);

      expect(error).toBeNull();
    });

    it("rejects an UPDATE that rewrites group_id to a different group", async () => {
      const [dave] = await createTestUsers(1);
      const staging = await createTestGroup(alice.id, [dave.id]);

      const client = authenticateAs(dave);
      const { error } = await client
        .from("group_members")
        .update({
          group_id: otherGroupId,
          status: "accepted",
          accepted_at: new Date().toISOString(),
        })
        .eq("group_id", staging.id)
        .eq("user_id", dave.id);

      expectRlsFailure(error);

      const { data } = await adminClient!
        .from("group_members")
        .select("group_id, user_id, status")
        .eq("group_id", otherGroupId)
        .eq("user_id", dave.id);
      expect(data ?? []).toHaveLength(0);
    });

    it("rejects an UPDATE that rewrites user_id to another user", async () => {
      const [erin] = await createTestUsers(1);
      const staging = await createTestGroup(alice.id, [erin.id]);

      const client = authenticateAs(erin);
      const { error } = await client
        .from("group_members")
        .update({
          user_id: carol.id,
          status: "accepted",
          accepted_at: new Date().toISOString(),
        })
        .eq("group_id", staging.id)
        .eq("user_id", erin.id);

      expectRlsFailure(error);
    });

    it("rejects an UPDATE on an already-accepted row (USING requires invited)", async () => {
      // Bob was accepted in the first test; re-issuing an update must be
      // rejected because the policy now requires status = 'invited'.
      const client = authenticateAs(bob);
      const { error, count } = await client
        .from("group_members")
        .update(
          { accepted_at: new Date().toISOString() },
          { count: "exact" },
        )
        .eq("group_id", invitedGroupId)
        .eq("user_id", bob.id);

      // RLS may either silently match zero rows (no error, count=0) or return
      // an explicit error depending on PostgREST. Either is acceptable.
      if (error) {
        expectRlsFailure(error);
      } else {
        expect(count ?? 0).toBe(0);
      }
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
    let regularGroupId: string;
    let dmGroupId: string;

    beforeAll(async () => {
      [alice] = await createTestUsers(1);
      const group = await createTestGroup(alice.id, []);
      regularGroupId = group.id;

      const { data: dm } = await adminClient!
        .from("groups")
        .insert({ name: "", creator_id: alice.id, is_dm: true })
        .select("id")
        .single();
      dmGroupId = dm!.id;
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
  // settlements_insert — status/confirmed_at pinned
  // ────────────────────────────────────────────────────────
  describe("settlements_insert blocks pre-confirmed rows", () => {
    let alice: TestUser;
    let bob: TestUser;
    let groupId: string;

    beforeAll(async () => {
      [alice, bob] = await createTestUsers(2);
      const group = await createTestGroupWithMembers(alice, [bob]);
      groupId = group.id;
    });

    it("allows a pending settlement to be inserted by the debtor", async () => {
      const client = authenticateAs(alice);
      const { error } = await client.from("settlements").insert({
        group_id: groupId,
        from_user_id: alice.id,
        to_user_id: bob.id,
        amount_cents: 1000,
      });

      expect(error).toBeNull();
    });

    it("rejects insertion of a pre-confirmed settlement", async () => {
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

    it("rejects insertion with confirmed_at populated but status=pending", async () => {
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
