import { test, expect } from "../fixtures";

test.describe("Home quick charge and Pix amount editing", () => {
  test("quick charge is a top-level home action gated on a Pix key", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Home", pixKeyType: "email" });

    await loginAs(alice);
    const quickCharge = page.getByRole("button", { name: "Cobrar rápido" });
    await expect(quickCharge).toBeEnabled();
    await quickCharge.click();
    await expect(page.getByRole("heading", { name: "Cobrar rápido" })).toBeVisible();
  });

  test("the charge stays above its button and fits without scrolling once the QR appears", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice QR", pixKeyType: "email" });
    // Seeded users carry only a key hint, so the server has nothing to encode.
    await page.route("**/api/pix/generate-self", (route) =>
      route.fulfill({ json: { copiaECola: "00020126580014br.gov.bcb.pix0136alice-qr@test.dividimos.local" } }),
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(alice);
    const quickCharge = page.getByRole("button", { name: "Cobrar rápido" });
    await quickCharge.click();

    const surface = page.getByTestId("quick-charge-modal");
    const sitsAboveButton = async () => {
      const [surfaceBox, buttonBox] = await Promise.all([
        surface.boundingBox(),
        quickCharge.boundingBox(),
      ]);
      return Boolean(surfaceBox && buttonBox && surfaceBox.y + surfaceBox.height <= buttonBox.y);
    };
    await expect.poll(sitsAboveButton).toBe(true);

    await page.getByRole("button", { name: "Adicionar R$20", exact: true }).click();
    await page.getByRole("button", { name: "Gerar QR" }).click();
    await expect(page.getByRole("img", { name: /QR Pix de/ })).toBeVisible();

    await expect.poll(sitsAboveButton).toBe(true);
    expect(await surface.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    await expect(page.getByRole("button", { name: "Já recebi" })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Copiar código" })).toBeInViewport({ ratio: 1 });
  });

  test("the Pix amount can be typed after tapping the pen", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Cobra", pixKeyType: "email" });
    const bob = await seed.createUser({ name: "Bob Deve" });
    const group = await seed.createGroup(alice.id, [bob.id], "Grupo Pix");
    await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Jantar Pix",
      totalCents: 8150,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.getByRole("button", { name: /^Bob Deve, .*Grupo Pix$/ }).click();
    await page.getByRole("button", { name: "Cobrar via Pix" }).click();

    const dialog = page.getByRole("dialog", { name: "Cobrar Bob Deve" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^Editar valor/ }).click();
    const amountInput = dialog.getByRole("textbox", { name: "Editar valor" });
    await expect(amountInput).toBeFocused();
    await amountInput.fill("20,00");
    await amountInput.press("Enter");

    await expect(dialog.getByRole("button", { name: /Editar valor, R\$\s*20,00/ })).toBeVisible();
    await expect(dialog.getByRole("slider", { name: "Valor do pagamento" })).toHaveValue("2000");
  });
});
