import { test, expect } from "../fixtures";

test.describe("Cobrar via Pix dialog stays usable in little vertical space", () => {
  test("keeps the footer reachable and offers icon-only amount shortcuts", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Compacta", pixKeyType: "email" });
    const bob = await seed.createUser({ name: "Bob Devedor" });
    const group = await seed.createGroup(alice.id, [bob.id], "Grupo Compacto");
    await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Jantar compacto",
      totalCents: 13130,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.getByRole("button", { name: /^Bob Devedor, .*Grupo Compacto$/ }).click();
    await page.getByRole("button", { name: "Cobrar via Pix" }).click();

    const dialog = page.getByRole("dialog", { name: "Cobrar via Pix" });
    await expect(dialog).toBeVisible();

    // The amount shortcuts are icons now; the value they set is the big number
    // above them, so the old "Tudo: R$ x" labels are gone.
    await expect(dialog.getByRole("button", { name: "Tudo" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Metade" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^Tudo: / })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^Metade: / })).toHaveCount(0);

    // The reported bug: on a short screen the footer scrolled out of the dialog.
    await page.setViewportSize({ width: 390, height: 560 });
    await expect(dialog.getByRole("button", { name: /Copiar código Pix/ })).toBeInViewport();
    await expect(dialog.getByRole("button", { name: /Já recebi|^Recebi/ })).toBeInViewport();
  });

  test("drops secondary copy while the keyboard is open", async ({ page, seed, loginAs }) => {
    const alice = await seed.createUser({ name: "Alice Teclado", pixKeyType: "email" });
    const bob = await seed.createUser({ name: "Bob Teclado" });
    const group = await seed.createGroup(alice.id, [bob.id], "Grupo Teclado");
    await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Conta teclado",
      totalCents: 9000,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.getByRole("button", { name: /^Bob Teclado, .*Grupo Teclado$/ }).click();
    await page.getByRole("button", { name: "Cobrar via Pix" }).click();

    const dialog = page.getByRole("dialog", { name: "Cobrar via Pix" });
    const recipientLine = dialog.getByText("de Bob Teclado");
    await expect(recipientLine).toBeVisible();

    // `useAppViewport` publishes this attribute when the visual viewport shrinks
    // with a text field focused; the layout reacts through the `keyboard:` variant.
    await page.setViewportSize({ width: 390, height: 430 });
    await page.evaluate(() => document.documentElement.setAttribute("data-keyboard", "open"));

    await expect(recipientLine).toBeHidden();
    await expect(dialog.getByRole("button", { name: /Copiar código Pix/ })).toBeInViewport();
  });
});
