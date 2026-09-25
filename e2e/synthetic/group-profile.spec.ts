import { test, expect } from "../fixtures";

test.describe("Group profile behind the header", () => {
  test("opens from the header and shows what the group has spent", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Perfil" });
    const bob = await seed.createUser({ name: "Bob Perfil" });
    const group = await seed.createGroup(alice.id, [bob.id], "Grupo Perfil");
    await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Conta do perfil",
      totalCents: 12000,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);

    await page.getByRole("button", { name: "Ver perfil do grupo" }).click();

    await expect(page).toHaveURL(new RegExp(`/app/groups/${group.id}/info$`));
    await expect(page.getByRole("heading", { name: "Grupo Perfil", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: /2 pessoas/ })).toHaveAttribute("href", `/app/groups/${group.id}?tab=membros`);
    await expect(page.getByTestId("group-spending")).toContainText("120,00");
    await expect(page.getByRole("button", { name: "Convidar" })).toBeVisible();
    await page.getByRole("link", { name: /2 pessoas/ }).click();
    await expect(page.getByRole("radio", { name: "Membros" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Remover Bob Perfil" })).toBeVisible();
  });

  test("the header avatar links to the same profile", async ({ page, seed, loginAs }) => {
    const alice = await seed.createUser({ name: "Alice Avatar" });
    const group = await seed.createGroup(alice.id, [], "Grupo Avatar");

    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);

    await expect(page.getByRole("link", { name: "Ver perfil do grupo" })).toHaveAttribute(
      "href",
      `/app/groups/${group.id}/info`,
    );
  });
});
