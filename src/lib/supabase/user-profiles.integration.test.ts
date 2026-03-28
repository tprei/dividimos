import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  authenticateAs,
  createTestGroup,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

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

    const ids = (data ?? []).map((p: { id: string }) => p.id);
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
