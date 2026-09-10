import { test, expect, loginInContext } from "../fixtures";

test.describe("Expense Lifecycle", () => {
  test("active expense settles once the debtor records the payment", async ({
    page,
    seed,
    loginAs,
    browser,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Lifecycle" });
    const bob = await seed.createUser({ name: "Bob Lifecycle" });
    const group = await seed.createGroup(alice.id, [bob.id], "Lifecycle Test");

    const expense = await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Lifecycle Dinner",
      totalCents: 10000,
      expenseType: "single_amount",
    });

    // Alice views the active expense
    await loginAs(alice);
    await page.goto(`/app/bill/${expense.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Lifecycle Dinner")).toBeVisible();
    await expect(page.getByText("Total", { exact: true })).toBeVisible();
    await expect(page.getByText("R$ 100,00", { exact: true })).toBeVisible();

    // Bob views the same expense in a separate context
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginInContext(bobContext, bobPage, bob);

    await bobPage.goto(`/app/bill/${expense.id}`);
    await bobPage.waitForLoadState("networkidle");

    await expect(bobPage.getByText("Lifecycle Dinner")).toBeVisible();
    await expect(bobPage.getByText("Total", { exact: true })).toBeVisible();

    // Bob sees the bill and his debt on the group page
    await bobPage.goto(`/app/groups/${group.id}`);
    await bobPage.waitForLoadState("networkidle");

    await expect(bobPage.getByText("Lifecycle Test")).toBeVisible();

    await bobPage.getByRole("tab", { name: "Contas" }).click();
    await expect(bobPage.getByText("Lifecycle Dinner")).toBeVisible();

    await bobPage.getByRole("tab", { name: "Saldos" }).click();
    const payRow = bobPage.getByRole("button", { name: /Você paga/i });
    await expect(payRow).toBeVisible({ timeout: 10000 });
    await expect(payRow).toContainText("R$ 50,00");

    // Bob records the payment
    const bobClient = await seed.authenticateAs(bob.id);
    const { error: recordError } = await bobClient.rpc("record_settlement", {
      p_operation_id: crypto.randomUUID(),
      p_group_id: group.id,
      p_from_user_id: bob.id,
      p_to_user_id: alice.id,
      p_amount_cents: 5000,
    });
    expect(recordError).toBeNull();

    const { data: settlements } = await adminClient
      .from("settlements")
      .select("status")
      .eq("group_id", group.id);
    expect(settlements).toHaveLength(1);
    expect(settlements![0].status).toBe("confirmed");

    // The group page reflects zero balances
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Tudo liquidado!")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Nenhuma dívida pendente no grupo")).toBeVisible();

    await bobContext.close();
  });

  test("wizard holds the draft locally until submit creates one active expense", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Draft" });
    const bob = await seed.createUser({ name: "Bob Draft" });
    const group = await seed.createGroup(alice.id, [bob.id]);

    await loginAs(alice);
    await page.goto(`/app/bill/new?groupId=${group.id}&title=Draft Test&amount=8000`);
    await page.waitForLoadState("networkidle");

    // participants sheet → nothing is persisted while the form is open
    await page.getByRole("button", { name: "Participantes" }).click();
    await expect(page.getByText(bob.name).first()).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Concluir" }).click();

    const { data: beforeSubmit } = await adminClient
      .from("expenses")
      .select("id")
      .eq("group_id", group.id);
    expect(beforeSubmit ?? []).toHaveLength(0);

    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("button", { name: /Alice/ }).click();
    await page.getByRole("button", { name: "Criar conta" }).click();

    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{8,}/i, { timeout: 15000 });

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("expenses")
            .select("id")
            .eq("group_id", group.id);
          return data?.length ?? 0;
        },
        { timeout: 10000 },
      )
      .toBe(1);

    const { data: afterSubmit } = await adminClient
      .from("expenses")
      .select("id, status, current_version_no")
      .eq("group_id", group.id);
    expect(afterSubmit).toHaveLength(1);
    expect(afterSubmit![0].status).toBe("active");
    expect(afterSubmit![0].current_version_no).toBe(1);
  });
});
