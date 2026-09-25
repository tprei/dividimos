import { test, expect } from "../fixtures";

test.describe("Bills and charges", () => {
  test("bills list shows seeded bills, filters by title, and switches tabs", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Bills" });
    const bob = await seed.createUser({ name: "Bob Bills" });
    const group = await seed.createGroup(alice.id, [bob.id], "Bills Test");

    await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Jantar de sexta",
    });
    await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Cinema sábado",
    });

    await loginAs(alice);
    await page.goto("/app/bills");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Contas", exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Jantar de sexta")).toBeVisible();
    await expect(page.getByText("Cinema sábado")).toBeVisible();

    const search = page.getByRole("textbox", { name: "Buscar contas" });
    await search.fill("Cinema");
    await expect(page.getByText("Cinema sábado")).toBeVisible();
    await expect(page.getByText("Jantar de sexta")).toBeHidden();

    await search.fill("pipoca");
    await expect(page.getByText("Nenhum resultado")).toBeVisible();

    await search.fill("");
    await expect(page.getByText("Jantar de sexta")).toBeVisible();
    await expect(page.getByText("Cinema sábado")).toBeVisible();

    await page.getByRole("radio", { name: "Cobranças" }).click();
    await expect(page.getByText("Nenhuma cobrança ainda")).toBeVisible({ timeout: 10000 });
  });

  test("charges page shows the empty state for a fresh user", async ({
    page,
    seed,
    loginAs,
  }) => {
    const fresh = await seed.createUser({ name: "Fresh Charges" });
    await loginAs(fresh);

    await page.goto("/app/charges");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Cobranças", exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Nenhuma cobrança ainda")).toBeVisible();
  });
});
