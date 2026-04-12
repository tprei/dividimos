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

    await expect(page.getByText(bob.name)).toBeVisible();

    await page.goto(`/app/bill/new?groupId=${dm.id}&title=Uber&amount=2500`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("button", { name: /Valor único|Dividir|single/i }).first()).toBeVisible({ timeout: 5000 });
    const singleAmountBtn = page.getByRole("button", { name: /Valor único/i });
    if (await singleAmountBtn.isVisible()) {
      await singleAmountBtn.click();
    }

    const nextBtn = page.getByRole("button", { name: /Próximo|Continuar/i });
    if (await nextBtn.isVisible()) {
      await nextBtn.click();
    }

    await page.waitForLoadState("networkidle");

    const infoNext = page.getByRole("button", { name: /Próximo|Continuar/i });
    if (await infoNext.isVisible()) {
      await infoNext.click();
    }

    await page.waitForLoadState("networkidle");

    const participantsNext = page.getByRole("button", { name: /Próximo|Continuar/i });
    if (await participantsNext.isVisible()) {
      await participantsNext.click();
    }

    await page.waitForLoadState("networkidle");

    const amountNext = page.getByRole("button", { name: /Próximo|Continuar/i });
    if (await amountNext.isVisible()) {
      await amountNext.click();
    }

    await page.waitForLoadState("networkidle");

    const payerNext = page.getByRole("button", { name: /Próximo|Continuar/i });
    if (await payerNext.isVisible()) {
      await payerNext.click();
    }

    await page.waitForLoadState("networkidle");

    const confirmBtn = page.getByRole("button", { name: /Finalizar|Confirmar|Ativar/i });
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click();
      await page.waitForLoadState("networkidle");
    }

    const { data: expenses } = await adminClient
      .from("expenses")
      .select("id, status, group_id")
      .eq("group_id", dm.id)
      .eq("status", "active");

    expect(expenses).not.toBeNull();
    expect(expenses!.length).toBeGreaterThan(0);

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
