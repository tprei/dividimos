import { test, expect } from "../fixtures";

test.describe("DM auto-creation", () => {
  test("opening a conversation creates one DM with a canonical user pair", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Open" });
    const bob = await seed.createUser({ name: "Bob DM Open" });

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(bob.name, { exact: true })).toBeVisible();

    const [userA, userB] = [alice.id, bob.id].sort();

    const { data: groups } = await adminClient
      .from("groups")
      .select("id, kind, dm_user_a, dm_user_b")
      .eq("dm_user_a", userA)
      .eq("dm_user_b", userB);

    expect(groups).toHaveLength(1);
    expect(groups![0].kind).toBe("dm");

    const { data: members } = await adminClient
      .from("group_members")
      .select("user_id, status")
      .eq("group_id", groups![0].id);

    expect(members).toHaveLength(2);

    expect(members?.find((m) => m.user_id === alice.id)?.status).toBe("accepted");
    expect(members?.find((m) => m.user_id === bob.id)?.status).toBe("invited");
  });

  test("idempotent — repeated opens return the same DM group", async ({
    seed,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Idem" });
    const bob = await seed.createUser({ name: "Bob DM Idem" });

    const first = await seed.createDmGroup(alice, bob);
    const second = await seed.createDmGroup(alice, bob);

    expect(first.id).toBe(second.id);

    const [userA, userB] = [alice.id, bob.id].sort();

    const { data: groups } = await adminClient
      .from("groups")
      .select("id")
      .eq("dm_user_a", userA)
      .eq("dm_user_b", userB);

    expect(groups).toHaveLength(1);
    expect(groups![0].id).toBe(first.id);
  });
});
