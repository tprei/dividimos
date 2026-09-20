import { test, expect } from "../fixtures";

test.describe("Cobrar rápido popover compresses for the keyboard", () => {
  test("puts the amount and its shortcuts on one row and keeps the action visible", async ({
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
    const generate = page.getByRole("button", { name: "Gerar QR Code" });
    await expect(description).toBeVisible();

    // `useAppViewport` publishes this attribute when the visual viewport shrinks
    // with a text field focused; the layout reacts through the `keyboard:` variant.
    await page.setViewportSize({ width: 390, height: 430 });
    await page.evaluate(() => document.documentElement.setAttribute("data-keyboard", "open"));

    await expect(page.getByText("Gere um QR Pix para qualquer pessoa te pagar")).toBeHidden();
    await expect(description).toBeHidden();
    await expect(generate).toBeInViewport();

    // Amount and shortcuts share a row rather than stacking.
    const amountBox = await amount.boundingBox();
    const shortcutBox = await page.getByRole("button", { name: "Adicionar R$5", exact: true }).boundingBox();
    expect(amountBox).not.toBeNull();
    expect(shortcutBox).not.toBeNull();
    expect(shortcutBox!.x).toBeGreaterThan(amountBox!.x);
  });
});
