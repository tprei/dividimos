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
    await page.getByTestId("group-payment-confirm").click();

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
    await expect(page.getByRole("region", { name: "Quem paga quem" }).getByRole("button", { name: /^Pagar/ })).toHaveAccessibleName(/R\$\s*20,00/);
  });

  test("settles with the counterparty picked from the avatars, not the preselected one", async ({
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

    // The form opens on the largest open balance (Bob, R$ 50); the test picks
    // the other member so a picker that ignores the tap cannot pass.
    const people = page.getByRole("radiogroup", { name: "Com quem?" });
    await expect(people.getByRole("radio", { name: bob.name })).toBeChecked();
    await people.getByRole("radio", { name: carol.name }).click();
    await expect(people.getByRole("radio", { name: carol.name })).toBeChecked();
    await expect(
      page.getByRole("radio", { name: `Você pagou para ${carol.name}` }),
    ).toBeChecked();

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
          to_user_id: carol.id,
          amount_cents: 3000,
          status: "confirmed",
        },
      ]);
  });
});
