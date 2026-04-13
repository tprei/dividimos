import { test, expect } from "../fixtures";

test.describe("DM navigation and deep links", () => {
  test("nav inferior tem tab Conversas e não tem Contas", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Nav" });

    await loginAs(alice);

    const conversasLink = page.getByRole("link", { name: /Conversas/i });
    await expect(conversasLink).toBeVisible();
    await expect(conversasLink).toHaveAttribute("href", "/app/conversations");

    const contasLink = page.getByRole("link", { name: /^Contas$/i });
    await expect(contasLink).not.toBeVisible();
  });

  // Test 2: Dashboard debt card from regular group → creates DM on tap
  test("card de dívida de grupo comum navega e cria DM com contraparte", async ({
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
    await seed.createActiveExpense(
      trip.id,
      bob.id,
      [alice.id, bob.id],
      {
        title: "Viagem",
        totalAmount: 10000,
        expenseType: "single_amount",
        payers: { [bob.id]: 10000 },
      },
    );

    await loginAs(alice);
    await page.waitForLoadState("networkidle");

    // Wait for debt card to appear and click the card header button
    const debtCard = page.locator(".rounded-2xl.border.bg-card").first();
    await expect(debtCard).toBeVisible({ timeout: 10000 });

    const cardHeader = debtCard.locator("button[type='button']").first();
    await expect(cardHeader).toBeVisible();
    await cardHeader.click();

    await expect(page).toHaveURL(/\/app\/conversations\/.+/, { timeout: 8000 });

    // Wait for the conversation page to finish initialize() — bob's name in
    // the header only renders after getOrCreateDmGroup completes, so this
    // proves the DM pair has been written before we query it.
    await expect(page.getByText(bob.name).first()).toBeVisible({
      timeout: 10000,
    });

    // A DM pair should now exist for alice+bob
    const { data: dmPairs } = await adminClient
      .from("dm_pairs")
      .select("id, user_a, user_b")
      .or(`user_a.eq.${alice.id},user_b.eq.${alice.id}`);

    const matching = (dmPairs ?? []).filter(
      (p) => p.user_a === bob.id || p.user_b === bob.id,
    );
    expect(matching.length).toBeGreaterThan(0);
  });

  // Test 3: Debt card direct link when debt is already in a DM
  test("card de dívida de DM existente navega direto para a conversa", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Direct" });
    const bob = await seed.createUser({ name: "Bob DM Direct" });

    // Both in a regular group so DM auto-accepts
    await seed.createGroup(alice.id, [bob.id], "Shared");
    const dm = await seed.createDmGroup(alice, bob);

    // Create expense in DM: bob paid R$ 60, split equally → alice owes R$ 30
    await seed.createActiveExpense(
      dm.id,
      bob.id,
      [alice.id, bob.id],
      {
        title: "Jantar DM",
        totalAmount: 6000,
        expenseType: "single_amount",
        payers: { [bob.id]: 6000 },
      },
    );

    await loginAs(alice);
    await page.waitForLoadState("networkidle");

    const debtCard = page.locator(".rounded-2xl.border.bg-card").first();
    await expect(debtCard).toBeVisible({ timeout: 10000 });

    const cardHeader = debtCard.locator("button[type='button']").first();
    await cardHeader.click();

    await expect(page).toHaveURL(`/app/conversations/${bob.id}`, {
      timeout: 8000,
    });

    // Page renders the conversation header with bob's full name
    await expect(page.getByText(bob.name, { exact: true }).first()).toBeVisible({
      timeout: 5000,
    });
  });

  // Test 4: Conversas tab navigation from a non-conversations page
  test("clique na tab Conversas navega para a lista de conversas", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice ConvTab" });
    const bob = await seed.createUser({ name: "Bob ConvTab" });

    await seed.createGroup(alice.id, [bob.id], "Grupo ConvTab");
    const dm = await seed.createDmGroup(alice, bob);
    await seed.sendChatMessage(dm.id, bob.id, "Olá Alice!");

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
