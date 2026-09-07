import { test, expect, loginInContext } from "../fixtures";

test.describe("Expense Lifecycle", () => {
  test("active expense settles once the creditor confirms", async ({
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
    await expect(page.getByText("Total da despesa")).toBeVisible();
    await expect(page.getByText("R$ 100,00", { exact: true })).toBeVisible();

    // Bob views the same expense in a separate context
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginInContext(bobContext, bobPage, bob);

    await bobPage.goto(`/app/bill/${expense.id}`);
    await bobPage.waitForLoadState("networkidle");

    await expect(bobPage.getByText("Lifecycle Dinner")).toBeVisible();
    await expect(bobPage.getByText("Total da despesa")).toBeVisible();

    // Bob sees the bill and his debt on the group page
    await bobPage.goto(`/app/groups/${group.id}`);
    await bobPage.waitForLoadState("networkidle");

    await expect(bobPage.getByText("Lifecycle Test")).toBeVisible();

    await bobPage.getByRole("tab", { name: "Contas" }).click();
    await expect(bobPage.getByText("Lifecycle Dinner")).toBeVisible();

    await bobPage.getByRole("tab", { name: "Saldos" }).click();
    await expect(bobPage.getByText("Você deve")).toBeVisible();
    await expect(bobPage.getByText("R$ 50,00").first()).toBeVisible({
      timeout: 10000,
    });

    // Bob records the payment; it stays pending until Alice confirms
    const bobClient = await seed.authenticateAs(bob.id);
    await bobClient.rpc("record_settlement", {
      p_operation_id: crypto.randomUUID(),
      p_group_id: group.id,
      p_to_user_id: alice.id,
      p_amount_cents: 5000,
    });

    const { data: pending } = await adminClient
      .from("settlements")
      .select("id")
      .eq("group_id", group.id)
      .eq("status", "pending");
    expect(pending).toHaveLength(1);

    const aliceClient = await seed.authenticateAs(alice.id);
    const { error: confirmError } = await aliceClient.rpc("confirm_settlement", {
      p_settlement_id: pending![0].id as string,
    });
    expect(confirmError).toBeNull();

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

    // participants step → nothing is persisted while the wizard is open
    await expect(page.getByText(bob.name).first()).toBeVisible({ timeout: 5000 });

    const { data: beforeSubmit } = await adminClient
      .from("expenses")
      .select("id")
      .eq("group_id", group.id);
    expect(beforeSubmit ?? []).toHaveLength(0);

    await page.getByRole("button", { name: /Próximo|Continuar/i }).click();
    await page.getByRole("button", { name: /Próximo|Continuar/i }).click();
    await page.getByRole("button", { name: alice.name }).click();
    await page.getByRole("button", { name: /Próximo|Continuar/i }).click();
    await page.getByRole("button", { name: /Gerar cobranças Pix/i }).click();

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
