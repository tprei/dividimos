import { test, expect, loginInContext } from "../fixtures";

test.describe("DM first expense", () => {
  test("wizard creates expense and system message appears in thread", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Expense" });
    const bob = await seed.createUser({ name: "Bob DM Expense" });

    await seed.createGroup(alice.id, [bob.id], "Prior Shared");
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

    // summary step → finalize ("Gerar cobranças Pix" saves the draft and
    // calls activate_expense; on success the page navigates to /app/bill/{id})
    await page
      .getByRole("button", { name: /Gerar cobranças Pix/i })
      .click();

    // Wait for navigation away from /new — the page only leaves /app/bill/new
    // after saveExpenseDraft + activate_expense complete.
    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{8,}/i, {
      timeout: 15000,
    });

    // Poll the DB for the active expense — saveExpenseDraft + activate_expense
    // are async and may lag slightly behind the navigation.
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

    const { data: chatMessages } = await adminClient
      .from("chat_messages")
      .select("id, message_type, expense_id")
      .eq("group_id", dm.id)
      .eq("message_type", "system_expense");

    expect(chatMessages).not.toBeNull();
    expect(chatMessages!.length).toBeGreaterThan(0);
    expect(chatMessages![0].expense_id).toBe(expense.id);

    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Uber")).toBeVisible({ timeout: 5000 });
  });

  test("both users see system message via fresh page load", async ({
    page,
    seed,
    loginAs,
    browser,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Both" });
    const bob = await seed.createUser({ name: "Bob DM Both" });

    await seed.createGroup(alice.id, [bob.id], "Prior Both Shared");
    const dm = await seed.createDmGroup(alice, bob);

    await seed.createActiveExpense(dm.id, alice.id, [alice.id, bob.id], {
      title: "Almoço",
      totalAmount: 5000,
      expenseType: "single_amount",
    });

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Almoço")).toBeVisible({ timeout: 5000 });

    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginInContext(bobContext, bobPage, bob);

    await bobPage.goto(`/app/conversations/${alice.id}`);
    await bobPage.waitForLoadState("networkidle");

    await expect(bobPage.getByText("Almoço")).toBeVisible({ timeout: 5000 });

    const { data: messages } = await adminClient
      .from("chat_messages")
      .select("id, message_type, expense_id")
      .eq("group_id", dm.id)
      .eq("message_type", "system_expense");

    expect(messages).not.toBeNull();
    expect(messages!.length).toBeGreaterThan(0);

    await bobContext.close();
  });

  test("seeded active expense in DM inserts system message", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Seed" });
    const bob = await seed.createUser({ name: "Bob DM Seed" });

    await seed.createGroup(alice.id, [bob.id], "Prior Seed Shared");
    const dm = await seed.createDmGroup(alice, bob);

    await seed.createActiveExpense(dm.id, alice.id, [alice.id, bob.id], {
      title: "Teste Seed",
      totalAmount: 2500,
      expenseType: "single_amount",
    });

    const { data: messages } = await adminClient
      .from("chat_messages")
      .select("id, message_type, expense_id")
      .eq("group_id", dm.id)
      .eq("message_type", "system_expense");

    expect(messages).not.toBeNull();
    expect(messages!.length).toBeGreaterThan(0);

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Teste Seed")).toBeVisible({ timeout: 5000 });
  });
});
