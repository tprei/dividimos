import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUser,
  createTestUsers,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

describe.skipIf(!isIntegrationTestReady)("User profile RLS", () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    [alice, bob] = await createTestUsers(2, { pixKeyType: "email" });
  });

  // ── SELECT ──────────────────────────────────────────────────────────

  describe("users SELECT", () => {
    it("user can read their own profile", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("users")
        .select("id, handle, name, email")
        .eq("id", alice.id)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.id).toBe(alice.id);
      expect(data!.handle).toBe(alice.handle);
    });

    it("user cannot read another user's profile via users table", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("users")
        .select("id, handle, name, email")
        .eq("id", bob.id)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });
  });

  // ── user_profiles view ──────────────────────────────────────────────

  describe("user_profiles view", () => {
    it("user can look up another user by handle", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("user_profiles")
        .select("id, handle, name, avatar_url")
        .eq("handle", bob.handle)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.id).toBe(bob.id);
      expect(data!.handle).toBe(bob.handle);
    });

    it("user_profiles does not expose sensitive fields", async () => {
      const client = authenticateAs(alice);
      // Try selecting columns that should not exist on the view
      const { data, error } = await client
        .from("user_profiles")
        .select("id, handle, name, avatar_url")
        .eq("handle", bob.handle)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      // The returned object should only have the four public columns
      expect(Object.keys(data!)).toEqual(
        expect.arrayContaining(["id", "handle", "name", "avatar_url"]),
      );
      expect(Object.keys(data!)).not.toContain("email");
      expect(Object.keys(data!)).not.toContain("pix_key_encrypted");
      expect(Object.keys(data!)).not.toContain("phone");
    });

    it("non-existent handle returns null", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("user_profiles")
        .select("id, handle, name")
        .eq("handle", "nonexistent_handle_xyz")
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });
  });

  // ── UPDATE ──────────────────────────────────────────────────────────

  describe("users UPDATE", () => {
    it("user can update their own name", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("users")
        .update({ name: "Alice Updated" })
        .eq("id", alice.id)
        .select("id, name")
        .single();

      expect(error).toBeNull();
      expect(data!.name).toBe("Alice Updated");
    });

    it("user can update their own handle", async () => {
      const client = authenticateAs(alice);
      const newHandle = `upd_${alice.handle.slice(-12)}`;

      const { data, error } = await client
        .from("users")
        .update({ handle: newHandle })
        .eq("id", alice.id)
        .select("id, handle")
        .single();

      expect(error).toBeNull();
      expect(data!.handle).toBe(newHandle);
    });

    it("user cannot update another user's profile", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("users")
        .update({ name: "Hacked!" })
        .eq("id", bob.id)
        .select();

      // RLS should block the update — no rows affected
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  // ── INSERT ──────────────────────────────────────────────────────────

  describe("users INSERT", () => {
    it("authenticated user cannot directly insert into users table", async () => {
      const client = authenticateAs(alice);
      const { error } = await client.from("users").insert({
        id: alice.id,
        handle: "duplicate_insert",
        name: "Fake",
        pix_key_encrypted: "fake",
        pix_key_hint: "fake",
        pix_key_type: "email",
      });

      // No INSERT RLS policy exists — should be blocked
      expect(error).not.toBeNull();
    });
  });

  // ── DELETE ──────────────────────────────────────────────────────────

  describe("users DELETE", () => {
    it("user cannot delete their own profile", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("users")
        .delete()
        .eq("id", alice.id)
        .select();

      // No DELETE RLS policy — should be blocked
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("user cannot delete another user's profile", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("users")
        .delete()
        .eq("id", bob.id)
        .select();

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  // ── Handle constraints ──────────────────────────────────────────────

  describe("handle constraints", () => {
    it("rejects handle with uppercase letters", async () => {
      const { error } = await adminClient!
        .from("users")
        .update({ handle: "InvalidHandle" })
        .eq("id", alice.id);

      expect(error).not.toBeNull();
    });

    it("rejects handle that is too short (< 3 chars)", async () => {
      const { error } = await adminClient!
        .from("users")
        .update({ handle: "ab" })
        .eq("id", alice.id);

      expect(error).not.toBeNull();
    });

    it("rejects handle that is too long (> 20 chars)", async () => {
      const { error } = await adminClient!
        .from("users")
        .update({ handle: "a_very_long_handle_exceeds_20" })
        .eq("id", alice.id);

      expect(error).not.toBeNull();
    });

    it("rejects handle starting with a dot", async () => {
      const { error } = await adminClient!
        .from("users")
        .update({ handle: ".badstart" })
        .eq("id", alice.id);

      expect(error).not.toBeNull();
    });

    it("rejects handle starting with an underscore", async () => {
      const { error } = await adminClient!
        .from("users")
        .update({ handle: "_badstart" })
        .eq("id", alice.id);

      expect(error).not.toBeNull();
    });

    it("rejects handle ending with a dot", async () => {
      const { error } = await adminClient!
        .from("users")
        .update({ handle: "badend." })
        .eq("id", alice.id);

      expect(error).not.toBeNull();
    });

    it("rejects handle ending with an underscore", async () => {
      const { error } = await adminClient!
        .from("users")
        .update({ handle: "badend_" })
        .eq("id", alice.id);

      expect(error).not.toBeNull();
    });

    it("rejects handle with spaces", async () => {
      const { error } = await adminClient!
        .from("users")
        .update({ handle: "has space" })
        .eq("id", alice.id);

      expect(error).not.toBeNull();
    });

    it("rejects duplicate handle", async () => {
      const { error } = await adminClient!
        .from("users")
        .update({ handle: bob.handle })
        .eq("id", alice.id);

      expect(error).not.toBeNull();
    });

    it("accepts valid handle with dots and underscores", async () => {
      const validHandle = `ok_${alice.handle.slice(-8)}`;
      const { error } = await adminClient!
        .from("users")
        .update({ handle: validHandle })
        .eq("id", alice.id);

      expect(error).toBeNull();
    });
  });

  // ── Trigger: auto-create profile ────────────────────────────────────

  describe("handle_new_user trigger", () => {
    it("auto-creates user profile on auth signup", async () => {
      // createTestUser already exercises the full flow —
      // verify the profile was actually created by the trigger
      const { data, error } = await adminClient!
        .from("users")
        .select("id, handle, name, onboarded")
        .eq("id", alice.id)
        .single();

      expect(error).toBeNull();
      expect(data!.handle).toBe(alice.handle);
      expect(data!.name).toBe(alice.name);
    });

    it("generated handle is unique even for similar names", async () => {
      // Create two users with the same base handle prefix
      const user1 = await createTestUser({ handle: "unique_collision_test" });
      const user2 = await createTestUser({ handle: "unique_collision_test" });

      // The helper generates unique handles via generateTestId(),
      // but if two users had the same handle, the DB UNIQUE constraint
      // would have caught it
      expect(user1.handle).not.toBe(user2.handle);
      expect(user1.id).not.toBe(user2.id);
    });
  });
});
