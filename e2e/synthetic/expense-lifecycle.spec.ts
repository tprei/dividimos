import { test, expect, loginInContext } from "../fixtures";

test.describe("Expense Lifecycle", () => {
  test("draft → active → settled with two users", async ({
    page,
    seed,
    loginAs,
    browser,
  }) => {
    const alice = await seed.createUser({ name: "Alice Lifecycle" });
    const bob = await seed.createUser({ name: "Bob Lifecycle" });
    const group = await seed.createGroup(alice.id, [bob.id], "Lifecycle Test");

    const expense = await seed.createActiveExpense(
      group.id,
      alice.id,
      [alice.id, bob.id],
      {
        title: "Jantar Lifecycle",
        totalAmount: 10000,
        expenseType: "single_amount",
      },
    );

    // Alice views the active expense
    await loginAs(alice);
    await page.goto(`/app/bill/${expense.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Jantar Lifecycle")).toBeVisible();
    await expect(page.getByText("Ativo")).toBeVisible();
    await expect(page.getByText("R$ 100,00")).toBeVisible();

    const paymentTab = page.getByRole("button", { name: /Pagamento/i });
    await paymentTab.click();

    await expect(
      page.getByText(/te deve|Ir para acerto do grupo/i).first(),
    ).toBeVisible();

    // Bob views the same expense in a separate context
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginInContext(bobContext, bobPage, bob);

    await bobPage.goto(`/app/bill/${expense.id}`);
    await bobPage.waitForLoadState("networkidle");

    await expect(bobPage.getByText("Jantar Lifecycle")).toBeVisible();
    await expect(bobPage.getByText("Ativo")).toBeVisible();

    const bobPaymentTab = bobPage.getByRole("button", { name: /Pagamento/i });
    await bobPaymentTab.click();

    await expect(
      bobPage.getByText(/Voce deve|Ir para acerto do grupo/i).first(),
    ).toBeVisible();

    // Bob navigates to the group settlement tab
    await bobPage.goto(`/app/groups/${group.id}`);
    await bobPage.waitForLoadState("networkidle");

    await expect(bobPage.getByText("Lifecycle Test")).toBeVisible();

    const contasTab = bobPage.getByRole("button", { name: "Contas" });
    await contasTab.click();
    await expect(bobPage.getByText("Jantar Lifecycle")).toBeVisible();
    await expect(bobPage.getByText("Pendente")).toBeVisible();

    const acertoTab = bobPage.getByRole("button", { name: "Acerto" });
    await acertoTab.click();

    await expect(bobPage.getByText("R$ 50,00").first()).toBeVisible({
      timeout: 10000,
    });

    // Settle the debt via RPC
    const bobClient = await seed.authenticateAs(bob.id);
    await bobClient.rpc("record_and_settle", {
      p_group_id: group.id,
      p_from_user_id: bob.id,
      p_to_user_id: alice.id,
      p_amount_cents: 5000,
    });

    // Group settlement tab reflects zero balances
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Acerto" }).click();
    await expect(page.getByText("Tudo liquidado!")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Nenhuma divida pendente no grupo")).toBeVisible();

    // Pagamentos tab shows confirmed settlement
    await page.getByRole("button", { name: "Pagamentos" }).click();
    await expect(
      page.getByText(/Confirmado/i).first(),
    ).toBeVisible({ timeout: 10000 });

    await bobContext.close();
  });

  test("non-creator sees waiting state for draft expense", async ({
    page,
    seed,
    loginAs,
    browser,
  }) => {
    const alice = await seed.createUser({ name: "Alice Draft" });
    const bob = await seed.createUser({ name: "Bob Draft" });
    const group = await seed.createGroup(alice.id, [bob.id]);

    const draft = await seed.createExpense(
      group.id,
      alice.id,
      [alice.id, bob.id],
      { title: "Rascunho Teste", totalAmount: 8000 },
    );

    // Bob views the draft
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginInContext(bobContext, bobPage, bob);

    await bobPage.goto(`/app/bill/${draft.id}`);
    await bobPage.waitForLoadState("networkidle");

    await expect(bobPage.getByText("Rascunho", { exact: true })).toBeVisible();
    await expect(
      bobPage.getByText(/Aguardando.*finalizar/i),
    ).toBeVisible();
    await expect(bobPage.getByText("R$ 80,00")).toBeVisible();

    // Alice sees the creator draft view
    await loginAs(alice);
    await page.goto(`/app/bill/${draft.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Rascunho", { exact: true })).toBeVisible();
    await expect(page.getByText("Rascunho Teste")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Finalizar despesa/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Editar rascunho/i }),
    ).toBeVisible();

    await bobContext.close();
  });
});
