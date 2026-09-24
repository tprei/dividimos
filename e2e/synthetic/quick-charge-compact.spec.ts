import { test, expect } from "../fixtures";

test.describe("Cobrar rápido popover compresses for the keyboard", () => {
  test("keeps amount, description and generation reachable in a short viewport", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Rápida", pixKeyType: "email" });

    await loginAs(alice);
    await page.getByRole("button", { name: "Cobrar rápido" }).click();

    const heading = page.getByRole("heading", { name: "Cobrar rápido" });
    await expect(heading).toBeVisible();

    const amount = page.getByRole("textbox", { name: "Valor da cobrança" });
    const description = page.getByPlaceholder("Descrição (opcional)");
    const generate = page.getByRole("button", { name: "Gerar QR" });
    await expect(description).toBeVisible();

    await page.setViewportSize({ width: 390, height: 450 });
    await amount.focus();
    await expect(amount).toBeFocused();
    await expect(description).toBeInViewport();
    await expect(generate).toBeInViewport();

    await page.getByRole("button", { name: "Adicionar R$5", exact: true }).click();
    await expect(amount).toHaveValue("5,00");
    await description.fill("Café");
    await expect(generate).toBeEnabled();
  });
});
