import { test, expect } from "../fixtures";

test.describe("Bill draft", () => {
  test("resumes a named draft with its values after leaving the wizard", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Draft" });
    await loginAs(alice);

    await page.locator("nav").getByRole("link", { name: "Nova conta" }).click();
    await page.getByRole("button", { name: /Valor único/ }).click();

    const titleInput = page.getByLabel("Nome");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("Aluguel da praia");
    await page.getByLabel("Valor total").fill("360,50");

    // Leave mid-draft and come back later, the way a user does: through the
    // bottom navigation, never reloading the page.
    await page.getByRole("button", { name: "Voltar" }).click();
    await page.getByRole("link", { name: "Fechar" }).click();
    await page.locator("nav").getByRole("link", { name: "Grupos" }).click();
    await expect(page).toHaveURL(/\/app\/groups$/);

    await page.locator("nav").getByRole("link", { name: "Nova conta" }).click();

    const banner = page.getByText("Continuar de onde você parou?");
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("«Aluguel da praia»")).toBeVisible();
    await expect(page.getByText("R$ 360,50")).toBeVisible();

    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByLabel("Nome")).toHaveValue("Aluguel da praia");
    await expect(page.getByLabel("Valor total")).toHaveValue("360,50");
  });

  test("discarding the draft resets the wizard", async ({ page, seed, loginAs }) => {
    const alice = await seed.createUser({ name: "Alice Discard" });
    await loginAs(alice);

    await page.locator("nav").getByRole("link", { name: "Nova conta" }).click();
    await page.getByRole("button", { name: /Valor único/ }).click();

    await page.getByLabel("Nome").fill("Cinema sábado");
    await page.getByLabel("Valor total").fill("84,00");

    await page.getByRole("button", { name: "Voltar" }).click();
    await page.getByRole("link", { name: "Fechar" }).click();
    await page.locator("nav").getByRole("link", { name: "Nova conta" }).click();

    await expect(page.getByText("Continuar de onde você parou?")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Descartar" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Descartar o rascunho?")).toBeVisible();
    await dialog.getByRole("button", { name: "Descartar rascunho" }).click();

    await expect(page.getByText("Que tipo de conta?")).toBeVisible();

    // A later visit reads the same reset store: no banner comes back.
    await page.getByRole("link", { name: "Fechar" }).click();
    await page.locator("nav").getByRole("link", { name: "Nova conta" }).click();
    await expect(page.getByText("Continuar de onde você parou?")).toBeHidden({ timeout: 10000 });
    await expect(page.getByText("Que tipo de conta?")).toBeVisible();
  });

  test("resumes a draft after a hard reload / PWA cold start", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Reload Draft" });
    await loginAs(alice);

    await page.locator("nav").getByRole("link", { name: "Nova conta" }).click();
    await page.getByRole("button", { name: /Valor único/ }).click();

    const titleInput = page.getByLabel("Nome");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("Aluguel da praia");
    await page.getByLabel("Valor total").fill("360,50");

    await page.reload();

    await page.goto("/app/bill/new");

    const banner = page.getByText("Continuar de onde você parou?");
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("«Aluguel da praia»")).toBeVisible();
    await expect(page.getByText("R$ 360,50")).toBeVisible();

    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByLabel("Nome")).toHaveValue("Aluguel da praia");
    await expect(page.getByLabel("Valor total")).toHaveValue("360,50");
  });
});
