import { test, expect } from "../fixtures";

test.describe("Settlement void", () => {
  test("payer undoes a recorded payment and the group debt comes back", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Void" });
    const bob = await seed.createUser({ name: "Bob Void" });
    const group = await seed.createGroup(alice.id, [bob.id], "Void Test");

    await seed.createExpenseWithSettlements(group.id, alice.id, [alice.id, bob.id], {
      title: "Jantar Desfeito",
      totalCents: 10000,
    });

    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Tudo acertado")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Ninguém deve nada por aqui.")).toBeVisible();

    await page.goto("/app/activity");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Bob Void pagou R$ 50,00 pra você")).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole("button", { name: "Desfazer" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Desfazer este registro?")).toBeVisible();
    await dialog.getByRole("button", { name: "Desfazer registro" }).click();

    await expect(page.getByText("Pagamento desfeito")).toBeVisible({ timeout: 10000 });

    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    const chargeRow = page
      .getByRole("region", { name: "Quem paga quem" })
      .getByRole("button", { name: /Cobrar R\$\s*50,00/ });
    await expect(chargeRow).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Tudo acertado")).toBeHidden();
  });
});
