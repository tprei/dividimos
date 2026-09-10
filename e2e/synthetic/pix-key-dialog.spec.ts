import { test, expect } from "../fixtures";

test.describe("Pix key dialog", () => {
  test("changing the key type keeps the dialog in place and saves the new key", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Pix", pixKeyType: "email" });

    await loginAs(alice, { navigate: false });
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto("/app/profile");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Alterar chave" }).click();
    const dialog = page.getByRole("dialog", { name: "Chave Pix" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("radio", { name: "E-mail" })).toHaveAttribute("aria-checked", "true");

    const rect = () =>
      dialog.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
      });
    await dialog.evaluate(
      (node) =>
        new Promise<void>((resolve) => {
          let last = "";
          const tick = () => {
            const r = node.getBoundingClientRect();
            const key = `${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.width)}:${Math.round(r.height)}`;
            if (key === last) resolve();
            else {
              last = key;
              requestAnimationFrame(tick);
            }
          };
          requestAnimationFrame(tick);
        }),
    );
    const before = await rect();

    await page.getByRole("radio", { name: "Telefone" }).click();
    await expect(page.getByRole("radio", { name: "Telefone" })).toHaveAttribute("aria-checked", "true");
    expect(await rect()).toEqual(before);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("listbox")).toHaveCount(0);

    await page.getByLabel("Chave", { exact: true }).fill("11999998888");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("(**) *****-8888")).toBeVisible();
  });
});
