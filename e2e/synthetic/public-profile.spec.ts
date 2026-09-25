import { test, expect } from "../fixtures";

test.describe("Public profile", () => {
  test("shows name and handle, and every action leads somewhere real", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Visit" });
    const bob = await seed.createUser({ name: "Bob Target" });
    await loginAs(alice);

    await page.goto(`/u/${bob.handle}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Bob Target" })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(`@${bob.handle}`)).toBeVisible();

    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await page.waitForURL(new RegExp(`/app/conversations/${bob.id}$`), { timeout: 15000 });
    await expect(page.getByText("Bob Target").first()).toBeVisible({ timeout: 10000 });

    await page.goto(`/u/${bob.handle}`);
    await page.getByRole("button", { name: "Dividir uma conta" }).click();
    await page.waitForURL(/\/app\/bill\/new\?dm=/, { timeout: 15000 });
    await expect(page.getByLabel("Nome da conta")).toHaveValue("Cobrança - Bob", { timeout: 10000 });
  });
});
