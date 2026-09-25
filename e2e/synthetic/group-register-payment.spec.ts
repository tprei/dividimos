import { test, expect } from "../fixtures";

test.describe("Group register payment", () => {
  test("records a payment from group chat without a bill and moves the balance", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Paga" });
    const bob = await seed.createUser({ name: "Bob Recebe" });
    const group = await seed.createGroup(alice.id, [bob.id], "Grupo Pagamento");
    await seed.createExpense(group.id, bob.id, [alice.id, bob.id], {
      title: "Churrasco",
      totalCents: 10000,
      expenseType: "single_amount",
    });

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/groups/${group.id}/chat`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    const amount = page.getByRole("textbox", { name: "Valor do pagamento" });
    await amount.click();
    await amount.fill("30,00");
    await page.getByRole("button", { name: /^Registrar$|Confirmar/ }).click();

    await expect(page.getByText(/Você pagou/)).toBeVisible({ timeout: 15000 });

    await expect
      .poll(async () => {
        const { data } = await adminClient
          .from("settlements")
          .select("from_user_id, to_user_id, amount_cents, status")
          .eq("group_id", group.id);
        return data ?? [];
      })
      .toEqual([
        {
          from_user_id: alice.id,
          to_user_id: bob.id,
          amount_cents: 3000,
          status: "confirmed",
        },
      ]);

    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("radio", { name: "Saldos" }).click();
    await expect(page.getByRole("button", { name: /Você paga/i })).toContainText("R$ 20,00");
  });

  test("settles with the counterparty picked from the list, not the default one", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Escolhe" });
    const bob = await seed.createUser({ name: "Bob Primeiro" });
    const carol = await seed.createUser({ name: "Carol Segunda" });
    const group = await seed.createGroup(alice.id, [bob.id, carol.id], "Grupo Escolha");
    // Alice owes both, so whichever one she picks has a debt to clear and the
    // amount never has to be typed past a cap of zero.
    await seed.createExpense(group.id, bob.id, [alice.id, bob.id], {
      title: "Churrasco",
      totalCents: 10000,
      expenseType: "single_amount",
    });
    await seed.createExpense(group.id, carol.id, [alice.id, carol.id], {
      title: "Uber",
      totalCents: 6000,
      expenseType: "single_amount",
    });

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/groups/${group.id}/chat`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Registrar pagamento" }).click();

    // The sheet opens on the group's first member; the test picks the other
    // one so a select that ignores the click cannot pass.
    const picker = page.getByRole("combobox", { name: "Com quem?" });
    await expect(picker).toBeVisible();
    const shown = (await picker.textContent()) ?? "";
    const target = shown.includes(`@${bob.handle}`) ? carol : bob;
    const expectedCents = target.id === bob.id ? 5000 : 3000;

    await picker.click();
    await page
      .getByRole("option", { name: `${target.name} (@${target.handle})`, exact: true })
      .click();
    await expect(page.getByText(`Você pagou para ${target.name}`)).toBeVisible();

    await page.getByTestId("group-payment-settle-all").click();
    await page.getByTestId("group-payment-confirm").click();

    await expect
      .poll(async () => {
        const { data } = await adminClient
          .from("settlements")
          .select("from_user_id, to_user_id, amount_cents, status")
          .eq("group_id", group.id);
        return data ?? [];
      })
      .toEqual([
        {
          from_user_id: alice.id,
          to_user_id: target.id,
          amount_cents: expectedCents,
          status: "confirmed",
        },
      ]);
  });
});
