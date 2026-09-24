import { test, expect } from "../fixtures";

test.describe("Bill draft", () => {
  test("resumes a named draft with its values after leaving the wizard", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Draft" });
    await loginAs(alice);

    await page.goto("/app/bill/new");
    await page.getByRole("button", { name: /Valor único/ }).click();

    const titleInput = page.getByLabel("Nome da conta");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("Aluguel da praia");
    await page.getByRole("button", { name: "Adicionar convidado" }).click();
    await page.getByPlaceholder("Nome do convidado").fill("Bia");
    await page.getByPlaceholder("Nome do convidado").press("Enter");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByLabel("Valor total").fill("360,50");

    await page.getByRole("button", { name: "Fechar" }).click();
    await page.getByRole("button", { name: "Sair e guardar" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/groups");
    await expect(page).toHaveURL(/\/app\/groups$/);

    await page.goto("/app/bill/new");

    const banner = page.getByRole("status").filter({ hasText: "Aluguel da praia" });
    await expect(banner).toContainText("Aluguel da praia", { timeout: 10000 });
    await expect(page.getByText("R$ 360,50")).toBeVisible();

    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByLabel("Nome da conta")).toHaveValue("Aluguel da praia");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByLabel("Valor total")).toHaveValue("360,50");
  });

  test("discarding the draft resets the wizard", async ({ page, seed, loginAs }) => {
    const alice = await seed.createUser({ name: "Alice Discard" });
    await loginAs(alice);

    await page.goto("/app/bill/new");
    await page.getByRole("button", { name: /Valor único/ }).click();

    await page.getByLabel("Nome da conta").fill("Cinema sábado");

    await page.getByRole("button", { name: "Fechar" }).click();
    await page.getByRole("button", { name: "Sair e guardar" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/bill/new");

    await expect(page.getByRole("status").filter({ hasText: "Cinema sábado" })).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Descartar" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Descartar o rascunho?")).toBeVisible();
    await dialog.getByRole("button", { name: "Descartar rascunho" }).click();

    await expect(page.getByRole("button", { name: /Valor único/ })).toBeVisible();

    await page.getByRole("button", { name: "Fechar" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/bill/new");
    await expect(page.getByRole("button", { name: "Continuar", exact: true })).toBeHidden({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /Valor único/ })).toBeVisible();
  });

  test("resumes a draft after a hard reload / PWA cold start", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Reload Draft" });
    await loginAs(alice);

    await page.goto("/app/bill/new");
    await page.getByRole("button", { name: /Valor único/ }).click();

    const titleInput = page.getByLabel("Nome da conta");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("Aluguel da praia");
    await page.getByRole("button", { name: "Adicionar convidado" }).click();
    await page.getByPlaceholder("Nome do convidado").fill("Bia");
    await page.getByPlaceholder("Nome do convidado").press("Enter");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByLabel("Valor total").fill("360,50");

    await page.reload();

    await page.goto("/app/bill/new");

    const banner = page.getByRole("status").filter({ hasText: "Aluguel da praia" });
    await expect(banner).toContainText("Aluguel da praia", { timeout: 10000 });
    await expect(page.getByText("R$ 360,50")).toBeVisible();

    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByLabel("Nome da conta")).toHaveValue("Aluguel da praia");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByLabel("Valor total")).toHaveValue("360,50");
  });
});
