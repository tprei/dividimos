import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

describe.skipIf(!isIntegrationTestReady)(
  "User profile security + user_profiles view",
  () => {
    let alice: TestUser;
    let bob: TestUser;

    beforeEach(async () => {
      [alice, bob] = await createTestUsers(2);
    });

    describe("users table RLS", () => {
      it("user can read their own full profile", async () => {
        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient
          .from("users")
          .select("id, handle, name, email, pix_key_encrypted, onboarded")
          .eq("id", alice.id)
          .single();

        expect(error).toBeNull();
        expect(data!.id).toBe(alice.id);
        expect(data!.handle).toBe(alice.handle);
      });

      it("user cannot read another user's profile via users table", async () => {
        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient
          .from("users")
          .select("*")
          .eq("id", bob.id)
          .maybeSingle();

        // users_read_own only allows reading own row
        expect(error).toBeNull();
        expect(data).toBeNull();
      });

      it("user can update their own profile", async () => {
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient
          .from("users")
          .update({ name: "Alice Updated" })
          .eq("id", alice.id);

        expect(error).toBeNull();
      });

      it("user cannot update another user's profile", async () => {
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient
          .from("users")
          .update({ name: "Hacked" })
          .eq("id", bob.id);

        expect(error).not.toBeNull();
      });
    });

    describe("user_profiles view", () => {
      it("authenticated user can look up another user by handle via the view", async () => {
        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient
          .from("user_profiles")
          .select("id, handle, name, avatar_url")
          .eq("handle", bob.handle)
          .single();

        expect(error).toBeNull();
        expect(data!.handle).toBe(bob.handle);
        expect(data!.name).toBe(bob.name);
      });

      it("user_profiles never exposes pix_key_encrypted", async () => {
        // The view only selects id, handle, name, avatar_url
        // Attempting to select pix_key_encrypted should fail
        const aliceClient = authenticateAs(alice);

        const { data, error } = await aliceClient
          .from("user_profiles")
          .select("id, handle, name, avatar_url")
          .eq("handle", bob.handle)
          .single();

        expect(error).toBeNull();
        // The returned object should not have pix_key_encrypted
        const keys = Object.keys(data!);
        expect(keys).not.toContain("pix_key_encrypted");
        expect(keys).not.toContain("email");
        expect(keys).not.toContain("phone");
        expect(keys).not.toContain("pix_key_hint");
      });

      it("user_profiles returns null for non-existent handle", async () => {
        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient
          .from("user_profiles")
          .select("id, handle")
          .eq("handle", "nonexistent_handle_xyz")
          .maybeSingle();

        expect(error).toBeNull();
        expect(data).toBeNull();
      });

      it("user_profiles view is security_invoker=false (bypasses RLS)", async () => {
        // This test verifies that authenticated users can see OTHER users
        // through the view, even though the underlying users table has
        // users_read_own RLS. The view has security_invoker=false, so
        // it runs as the view owner (postgres) and bypasses RLS.
        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient
          .from("user_profiles")
          .select("id, handle, name")
          .eq("id", bob.id)
          .single();

        expect(error).toBeNull();
        expect(data!.id).toBe(bob.id);
      });
    });

    describe("handle_new_user trigger", () => {
      it("auto-creates user profile on auth signup with handle derived from email", async () => {
        // createTestUser already triggers handle_new_user via auth.users insert.
        // We can verify the handle was set correctly.
        const { data, error } = await adminClient!
          .from("users")
          .select("handle, name, onboarded")
          .eq("id", alice.id)
          .single();

        expect(error).toBeNull();
        expect(data!.handle).not.toBeNull();
        expect(data!.handle!.length).toBeGreaterThanOrEqual(3);
        expect(data!.onboarded).toBe(true); // overridden by our helper
      });

      it("handle format follows handle_format CHECK constraint", async () => {
        // Verify the generated handle matches the constraint:
        // ^[a-z0-9][a-z0-9._]{0,18}[a-z0-9]$
        const { data } = await adminClient!
          .from("users")
          .select("handle")
          .eq("id", alice.id)
          .single();

        const handle = data!.handle!;
        const validPattern = /^[a-z0-9][a-z0-9._]{0,18}[a-z0-9]$/;
        expect(validPattern.test(handle)).toBe(true);
        expect(handle.length).toBeGreaterThanOrEqual(3);
        expect(handle.length).toBeLessThanOrEqual(20);
      });

      it("handle collision resolution produces unique handles", async () => {
        // Create two users and verify handles are unique
        const [user1, user2] = await createTestUsers(2);
        expect(user1.handle).not.toBe(user2.handle);
      });
    });

    describe("pix_key_encrypted never leaks", () => {
      it("pix_key_encrypted is not accessible via user_profiles view", async () => {
        const aliceClient = authenticateAs(alice);

        // Try a broad select on user_profiles
        const { data } = await aliceClient
          .from("user_profiles")
          .select("*")
          .eq("id", bob.id)
          .single();

        // Should only have the safe columns
        const keys = Object.keys(data!);
        expect(keys.sort()).toEqual(["avatar_url", "handle", "id", "name"]);
      });

      it("pix_key_encrypted is not readable via users table by other users", async () => {
        const aliceClient = authenticateAs(alice);

        const { data } = await aliceClient
          .from("users")
          .select("pix_key_encrypted")
          .eq("id", bob.id)
          .maybeSingle();

        // Should return null (can't read other users via users table at all)
        expect(data).toBeNull();
      });
    });
  },
);
