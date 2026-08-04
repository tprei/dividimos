import { describe, it, expect, beforeEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  createTestUsers,
  authenticateAs,
  createTestGroup,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import type { Database } from "@/types/database";

describe.skipIf(!isIntegrationTestReady)("user_profiles access control", () => {
  let alice: TestUser;
  let bob: TestUser;
  let outsider: TestUser;

  beforeEach(async () => {
    [alice, bob] = await createTestUsers(2);
    [outsider] = await createTestUsers(1);

    const group = await createTestGroup(alice.id, [bob.id]);
    await adminClient!
      .from("group_members")
      .update({ status: "accepted" })
      .eq("group_id", group.id);
  });

  it("co-member can see each other's profile", async () => {
    const aliceClient = authenticateAs(alice);
    const { data } = await aliceClient
      .from("user_profiles")
      .select("*")
      .eq("id", bob.id)
      .single();

    expect(data).not.toBeNull();
    expect(data!.handle).toBe(bob.handle);
  });

  it("cannot see profile of unrelated user", async () => {
    const aliceClient = authenticateAs(alice);
    const { data } = await aliceClient
      .from("user_profiles")
      .select("*")
      .eq("id", outsider.id)
      .maybeSingle();

    expect(data).toBeNull();
  });

  it("can see own profile", async () => {
    const aliceClient = authenticateAs(alice);
    const { data } = await aliceClient
      .from("user_profiles")
      .select("*")
      .eq("id", alice.id)
      .single();

    expect(data).not.toBeNull();
    expect(data!.handle).toBe(alice.handle);
  });

  it("cannot enumerate all profiles", async () => {
    const aliceClient = authenticateAs(alice);
    const { data } = await aliceClient
      .from("user_profiles")
      .select("*");

    const ids = (data ?? []).map((p) => p.id);
    expect(ids).toContain(alice.id);
    expect(ids).toContain(bob.id);
    expect(ids).not.toContain(outsider.id);
  });
});

describe.skipIf(!isIntegrationTestReady)("lookup_user_by_handle RPC", () => {
  let alice: TestUser;
  let outsider: TestUser;

  beforeEach(async () => {
    [alice] = await createTestUsers(1);
    [outsider] = await createTestUsers(1);
  });

  it("returns profile for any valid handle (even non-co-member)", async () => {
    const aliceClient = authenticateAs(alice);
    const { data, error } = await aliceClient
      .rpc("lookup_user_by_handle", { p_handle: outsider.handle })
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.id).toBe(outsider.id);
  });

  it("returns empty for non-existent handle", async () => {
    const aliceClient = authenticateAs(alice);
    const { data } = await aliceClient
      .rpc("lookup_user_by_handle", { p_handle: "nonexistent_handle_xyz_999" });

    expect(data).toHaveLength(0);
  });
});

describe.skipIf(!isIntegrationTestReady)("get_my_profile owner-profile RPC", () => {
  let alice: TestUser;
  let bob: TestUser;
  let outsider: TestUser;

  beforeEach(async () => {
    [alice, bob] = await createTestUsers(2);
    [outsider] = await createTestUsers(1);

    // Make alice and bob accepted co-members of one group. That relationship
    // is exactly what users_read_visible relies on to expose a related user,
    // so building it also proves the setup is genuinely permissive.
    const group = await createTestGroup(alice.id, [bob.id]);
    await adminClient!
      .from("group_members")
      .update({ status: "accepted" })
      .eq("group_id", group.id);
  });

  it("get_my_profile returns only the caller's own row, never a related user's", async () => {
    const aliceClient = authenticateAs(alice);

    // The relationship is real and users_read_visible is permissive: Alice
    // can read Bob's full row through the ordinary users table.
    const { data: bobRow, error: bobError } = await aliceClient
      .from("users")
      .select("id, handle")
      .eq("id", bob.id)
      .maybeSingle();
    expect(bobError).toBeNull();
    expect(bobRow).not.toBeNull();
    expect(bobRow!.id).toBe(bob.id);

    // The argument-free RPC cannot be aimed at that visible target: it
    // derives its row from auth.uid() alone and returns Alice.
    const { data, error } = await aliceClient.rpc("get_my_profile");
    expect(error).toBeNull();
    const rows = data ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(alice.id);
    expect(rows[0].id).not.toBe(bob.id);
    expect(rows[0].handle).toBe(alice.handle);
  });

  it("get_my_profile returns each caller exactly their own single row", async () => {
    for (const user of [alice, bob, outsider]) {
      const client = authenticateAs(user);
      const { data, error } = await client.rpc("get_my_profile");
      expect(error).toBeNull();
      const rows = data ?? [];
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(user.id);
      expect(rows[0].handle).toBe(user.handle);
    }
  });

  it("get_my_profile exposes profile fields but never pix_key_encrypted", async () => {
    const aliceClient = authenticateAs(alice);
    const { data, error } = await aliceClient.rpc("get_my_profile");
    expect(error).toBeNull();
    const rows = data ?? [];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).not.toHaveProperty("pix_key_encrypted");
    expect(row.id).toBe(alice.id);
    expect(row.email).toBe(alice.email);
    expect(row.handle).toBe(alice.handle);
    expect(row.name).toBe(alice.name);
    expect(row.onboarded).toBe(alice.onboarded);
    expect(row.pix_key_type).toBe(alice.pixKeyType);
    expect(row.pix_key_hint).toBe(alice.pixKeyHint);
  });

  it("get_my_profile rejects a target-id argument", async () => {
    const aliceClient = authenticateAs(alice);
    const { data, error } = await aliceClient.rpc("get_my_profile", {
      p_user_id: bob.id,
    } as never);

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("get_my_profile denies an anonymous client", async () => {
    const anonClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );

    const { data, error } = await anonClient.rpc("get_my_profile");

    expect(error).not.toBeNull();
    expect(data).toBeNull();
    expect(error!.code).toBe("42501");
  });
});
