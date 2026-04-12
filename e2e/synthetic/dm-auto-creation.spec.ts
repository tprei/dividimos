import { test, expect } from "../fixtures";

test.describe("DM auto-creation", () => {
  test("first visit auto-creates DM group with invite wall for strangers", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Stranger" });
    const bob = await seed.createUser({ name: "Bob DM Stranger" });

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(bob.name)).toBeVisible();

    const { data: pairs } = await adminClient
      .from("dm_pairs")
      .select("group_id, user_a, user_b")
      .or(`user_a.eq.${alice.id},user_b.eq.${alice.id}`);

    const pair = (pairs ?? []).find(
      (p) =>
        (p.user_a === alice.id && p.user_b === bob.id) ||
        (p.user_a === bob.id && p.user_b === alice.id),
    );

    expect(pair).toBeDefined();

    const { data: group } = await adminClient
      .from("groups")
      .select("is_dm")
      .eq("id", pair!.group_id)
      .single();

    expect(group?.is_dm).toBe(true);

    const { data: members } = await adminClient
      .from("group_members")
      .select("user_id, status")
      .eq("group_id", pair!.group_id);

    const aliceRow = (members ?? []).find((m) => m.user_id === alice.id);
    const bobRow = (members ?? []).find((m) => m.user_id === bob.id);

    expect(aliceRow?.status).toBe("accepted");
    expect(bobRow?.status).toBe("invited");

    await expect(
      page.getByText(/Aguardando.*aceitar/i),
    ).toBeVisible();
  });

  test("auto-accepts both members when they already share an accepted group", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const carol = await seed.createUser({ name: "Carol DM Friends" });
    const dan = await seed.createUser({ name: "Dan DM Friends" });

    await seed.createGroup(carol.id, [dan.id], "Carol Dan Shared");

    await loginAs(carol, { navigate: false });
    await page.goto(`/app/conversations/${dan.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(dan.name)).toBeVisible();

    const { data: pairs } = await adminClient
      .from("dm_pairs")
      .select("group_id, user_a, user_b")
      .or(`user_a.eq.${carol.id},user_b.eq.${carol.id}`);

    const pair = (pairs ?? []).find(
      (p) =>
        (p.user_a === carol.id && p.user_b === dan.id) ||
        (p.user_a === dan.id && p.user_b === carol.id),
    );

    expect(pair).toBeDefined();

    const { data: members } = await adminClient
      .from("group_members")
      .select("user_id, status")
      .eq("group_id", pair!.group_id);

    const carolRow = (members ?? []).find((m) => m.user_id === carol.id);
    const danRow = (members ?? []).find((m) => m.user_id === dan.id);

    expect(carolRow?.status).toBe("accepted");
    expect(danRow?.status).toBe("accepted");

    await expect(page.getByText(/Aguardando.*aceitar/i)).not.toBeVisible();
  });

  test("idempotent — visiting the same conversation twice returns the same DM group", async ({
    seed,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Idem" });
    const bob = await seed.createUser({ name: "Bob DM Idem" });

    await seed.createGroup(alice.id, [bob.id], "Alice Bob Shared");

    const first = await seed.createDmGroup(alice, bob);
    const second = await seed.createDmGroup(alice, bob);

    expect(first.id).toBe(second.id);

    const { data: pairs } = await adminClient
      .from("dm_pairs")
      .select("group_id")
      .or(`user_a.eq.${alice.id},user_b.eq.${alice.id}`);

    const relevant = (pairs ?? []).filter((p) => p.group_id === first.id);
    expect(relevant).toHaveLength(1);
  });
});
