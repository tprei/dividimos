import { test, expect, loginInContext } from "../fixtures";

test.describe("DM first expense", () => {
  test("wizard creates expense and its event appears in thread", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Expense" });
    const bob = await seed.createUser({ name: "Bob DM Expense" });

    const dm = await seed.createDmGroup(alice, bob);

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(bob.name).first()).toBeVisible();

    // Open the wizard with the chat-edit URL shape (title + amount). The
    // bill-new page consumes these params and lands at the participants step
    // with title and totalAmountInput pre-filled, skipping the type and info
    // steps the same way ?dm= jumps straight to amount-split.
    await page.goto(`/app/bill/new?groupId=${dm.id}&title=Uber&amount=2500`);
    await page.waitForLoadState("networkidle");

    // participants step → amount-split (group members auto-loaded from groupId)
    await expect(page.getByText(bob.name).first()).toBeVisible({
      timeout: 5000,
    });
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .click();

    // amount-split step → payer (split is auto-equal because totalInput is set)
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .click();

    // payer step needs an explicit selection; pick alice as the full payer
    await page.getByRole("button", { name: alice.name }).click();
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .click();

    // summary step → finalize ("Gerar cobranças Pix" calls create_expense; on
    // success the page navigates to /app/bill/{id})
    await page
      .getByRole("button", { name: /Gerar cobranças Pix/i })
      .click();

    // Wait for navigation away from /new — the page only leaves /app/bill/new
    // after create_expense completes.
    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{8,}/i, {
      timeout: 15000,
    });

    // Poll the DB for the expense — create_expense is async and may lag
    // slightly behind the navigation.
    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("expenses")
            .select("id")
            .eq("group_id", dm.id)
            .eq("status", "active");
          return data?.length ?? 0;
        },
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);

    const { data: expenses } = await adminClient
      .from("expenses")
      .select("id, status, group_id")
      .eq("group_id", dm.id)
      .eq("status", "active");

    const expense = expenses![0];

    const { data: events } = await adminClient
      .from("group_events")
      .select("id, kind, expense_id")
      .eq("group_id", dm.id)
      .eq("kind", "expense_created");

    expect(events).toHaveLength(1);
    expect(events![0].expense_id).toBe(expense.id);

    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("link", { name: /Uber/ })).toBeVisible({
      timeout: 5000,
    });
  });

  test("both users see the expense event via fresh page load", async ({
    page,
    seed,
    loginAs,
    browser,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Both" });
    const bob = await seed.createUser({ name: "Bob DM Both" });

    const dm = await seed.createDmGroup(alice, bob);

    await seed.createExpense(dm.id, alice.id, [alice.id, bob.id], {
      title: "Lunch",
      totalCents: 5000,
      expenseType: "single_amount",
    });

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("link", { name: /Lunch/ })).toBeVisible({
      timeout: 5000,
    });

    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginInContext(bobContext, bobPage, bob);

    await bobPage.goto(`/app/conversations/${alice.id}`);
    await bobPage.waitForLoadState("networkidle");

    await expect(bobPage.getByRole("link", { name: /Lunch/ })).toBeVisible({
      timeout: 5000,
    });

    const { data: events } = await adminClient
      .from("group_events")
      .select("id, expense_id")
      .eq("group_id", dm.id)
      .eq("kind", "expense_created");

    expect(events).toHaveLength(1);

    await bobContext.close();
  });

  test("seeded expense in DM emits an expense-created event", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Seed" });
    const bob = await seed.createUser({ name: "Bob DM Seed" });

    const dm = await seed.createDmGroup(alice, bob);

    await seed.createExpense(dm.id, alice.id, [alice.id, bob.id], {
      title: "Seed Test",
      totalCents: 2500,
      expenseType: "single_amount",
    });

    const { data: events } = await adminClient
      .from("group_events")
      .select("id, expense_id")
      .eq("group_id", dm.id)
      .eq("kind", "expense_created");

    expect(events).toHaveLength(1);

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("link", { name: /Seed Test/ })).toBeVisible({
      timeout: 5000,
    });
  });
});
