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
