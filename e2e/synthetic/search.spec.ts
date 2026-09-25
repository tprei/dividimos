import { test, expect } from "../fixtures";

test.describe("Search", () => {
  test("finds a seeded group, a bill by title, and a person, and navigates on tap", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Finder" });
    const bob = await seed.createUser({ name: "Bob Findable" });
    const group = await seed.createGroup(alice.id, [bob.id], "Viagem Pipa");

    const expense = await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Pousada do farol",
    });

    // Load the group (and its expenses) into the local store first.
    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    const searchInput = page.getByPlaceholder("Buscar grupos, contas, pessoas...");

    await page.goto("/app/search");
    await searchInput.fill("Viagem");
    const groupResult = page.getByRole("link", { name: /Viagem Pipa/ });
    await expect(groupResult).toBeVisible({ timeout: 10000 });
    await groupResult.click();
    await expect(page).toHaveURL(new RegExp(`/app/groups/${group.id}$`));

    await page.goto("/app/search");
    await searchInput.fill("Pousada");
    const billResult = page.getByRole("link", { name: /Pousada do farol/ });
    await expect(billResult).toBeVisible({ timeout: 10000 });
    await billResult.click();
    await expect(page).toHaveURL(new RegExp(`/app/bill/${expense.id}$`));

    await page.goto("/app/search");
    await searchInput.fill("Bob");
    const personResult = page.getByRole("link", { name: /Bob Findable/ });
    await expect(personResult).toBeVisible({ timeout: 10000 });
    await personResult.click();
    await expect(page).toHaveURL(new RegExp(`/app/conversations/${bob.id}$`));
  });
});
