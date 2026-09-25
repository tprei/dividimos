import { test, expect } from "../fixtures";

test.describe("Cobrar via Pix dialog stays usable in little vertical space", () => {
  test("keeps the footer reachable and labels amount shortcuts", async ({
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

    const dialog = page.getByRole("dialog", { name: "Cobrar Bob Devedor" });
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole("button", { name: "Tudo" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Metade" })).toBeVisible();
    await dialog.getByRole("button", { name: "Metade" }).click();
    await expect(dialog.getByRole("slider")).toHaveValue("3283");

    // The reported bug: on a short screen the footer scrolled out of the dialog.
    await page.setViewportSize({ width: 390, height: 560 });
    await expect(dialog.getByRole("button", { name: /Já recebi|Registrar pagamento/ })).toBeInViewport();
  });

  test("keeps the counterparty and editable amount visible on a short screen", async ({ page, seed, loginAs }) => {
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

    const dialog = page.getByRole("dialog", { name: "Cobrar Bob Teclado" });
    await page.setViewportSize({ width: 390, height: 450 });
    await dialog.getByRole("button", { name: /^Editar valor/ }).click();
    await expect(dialog.getByRole("textbox", { name: "Editar valor" })).toBeFocused();
    await expect(dialog.getByRole("heading", { name: "Cobrar Bob Teclado" })).toBeInViewport();
    await expect(dialog.getByRole("button", { name: /Já recebi|Registrar pagamento/ })).toBeInViewport();
  });

  test("keeps the pay-mode actions reachable on a short screen", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Pagadora" });
    const bob = await seed.createUser({ name: "Bob Credor", pixKeyType: "email" });
    const group = await seed.createGroup(bob.id, [alice.id], "Grupo Pagamento");
    await seed.createExpense(group.id, bob.id, [alice.id, bob.id], {
      title: "Conta paga pelo Bob",
      totalCents: 10000,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.setViewportSize({ width: 390, height: 450 });
    await page.getByRole("button", { name: /^Bob Credor, .*Grupo Pagamento$/ }).click();
    await page.getByRole("button", { name: "Pagar via Pix" }).click();

    const dialog = page.getByRole("dialog", { name: "Pagar Bob Credor" });
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole("button", { name: /Editar valor/ })).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "Tudo" })).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: /Registrar pagamento|Já paguei/ }),
    ).toBeInViewport();
    const missingKey = dialog.getByText("Bob Credor ainda não cadastrou uma chave Pix");
    await expect(missingKey).toBeVisible();
    await expect.poll(() => missingKey.evaluate((element) => {
      const slider = element.closest('[role="dialog"]')?.querySelector('input[type="range"]');
      if (!slider) throw new Error("Payment slider is missing");
      return element.getBoundingClientRect().top >= slider.getBoundingClientRect().bottom;
    })).toBe(true);
  });
});
