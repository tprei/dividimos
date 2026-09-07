import { test, expect } from "../fixtures";

test.describe("DM navigation and deep links", () => {
  test("bottom nav has a Conversations tab and no Bills tab", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Nav" });

    await loginAs(alice);

    const conversationsLink = page.getByRole("link", { name: /Conversas/i });
    await expect(conversationsLink).toBeVisible();
    await expect(conversationsLink).toHaveAttribute("href", "/app/conversations");

    const billsLink = page.getByRole("link", { name: /^Contas$/i });
    await expect(billsLink).not.toBeVisible();
  });

  // Test 2: Dashboard debt card from regular group → creates DM on tap
  test("a regular-group debt card navigates and creates a DM with the counterparty", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Deeplink" });
    const bob = await seed.createUser({ name: "Bob Deeplink" });

    // Create a regular group "Trip" with both members accepted
    const trip = await seed.createGroup(alice.id, [bob.id], "Trip");

    // Bob paid R$ 100, split equally → alice owes bob R$ 50
    await seed.createExpense(trip.id, bob.id, [alice.id, bob.id], {
      title: "Trip Expense",
      totalCents: 10000,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.waitForLoadState("networkidle");

    // Wait for debt card to appear and click the card header button
    const debtCard = page.locator(".rounded-2xl.border.bg-card").first();
    await expect(debtCard).toBeVisible({ timeout: 10000 });

    const cardLink = debtCard.locator("a[href*='/app/conversations/']").first();
    await expect(cardLink).toBeVisible();
    await cardLink.click();

    await expect(page).toHaveURL(/\/app\/conversations\/.+/, { timeout: 8000 });

    // Wait for the conversation page to finish initialize() — bob's name in
    // the header only renders after getOrCreateDmGroup completes, so this
    // proves the DM pair has been written before we query it.
    await expect(page.getByText(bob.name).first()).toBeVisible({
      timeout: 10000,
    });

    // A DM should now exist for the canonical alice+bob pair
    const [userA, userB] = [alice.id, bob.id].sort();
    const { data: dmGroups, error: dmGroupsError } = await adminClient
      .from("groups")
      .select("id, kind")
      .eq("dm_user_a", userA)
      .eq("dm_user_b", userB);

    expect(dmGroupsError).toBeNull();
    expect(dmGroups).toHaveLength(1);
    expect(dmGroups![0].kind).toBe("dm");
  });

  // Test 3: Debt card direct link when debt is already in a DM
  test("an existing DM debt card navigates straight to the conversation", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Direct" });
    const bob = await seed.createUser({ name: "Bob DM Direct" });

    const dm = await seed.createDmGroup(alice, bob);

    // Create expense in DM: bob paid R$ 60, split equally → alice owes R$ 30
    await seed.createExpense(dm.id, bob.id, [alice.id, bob.id], {
      title: "DM Dinner",
      totalCents: 6000,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.waitForLoadState("networkidle");

    const debtCard = page.locator(".rounded-2xl.border.bg-card").first();
    await expect(debtCard).toBeVisible({ timeout: 10000 });

    const cardLink = debtCard.locator("a[href*='/app/conversations/']").first();
    await cardLink.click();

    await expect(page).toHaveURL(`/app/conversations/${bob.id}`, {
      timeout: 8000,
    });

    // Page renders the conversation header with bob's full name
    await expect(page.getByText(bob.name, { exact: true }).first()).toBeVisible({
      timeout: 5000,
    });
  });

  // Test 4: Conversations tab navigation from a non-conversations page
  test("clicking the Conversations tab navigates to the conversation list", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice ConvTab" });
    const bob = await seed.createUser({ name: "Bob ConvTab" });

    await seed.createGroup(alice.id, [bob.id], "ConvTab Group");
    const dm = await seed.createDmGroup(alice, bob);
    await seed.sendChatMessage(dm.id, bob.id, "Hello Alice!");

    await loginAs(alice, { navigate: false });
    await page.goto("/app/profile");
    await page.waitForLoadState("networkidle");

    const conversasLink = page.getByRole("link", { name: /Conversas/i });
    await conversasLink.click();

    await expect(page).toHaveURL("/app/conversations", { timeout: 8000 });
    await page.waitForLoadState("networkidle");

    // Bob should appear in the conversations list
    await expect(page.getByText(bob.name.split(" ")[0])).toBeVisible({
      timeout: 5000,
    });
  });

  // Test 5 (unread badge) skipped: requires two browser contexts with realtime sync
  // and the badge state may not initialise quickly enough in the test environment.
  // Coverage for this is handled by unit tests on useUnreadConversations.
});
