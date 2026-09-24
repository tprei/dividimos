import { test, expect } from "../fixtures";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Receipt review participants", () => {
  test("a scan without a group can still add people before splitting", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Recibo" });
    const bob = await seed.createUser({ name: "Bob Recibo" });

    await page.route("**/api/receipt/ocr", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          merchant: "Padaria Sintética",
          items: [{ description: "Pão de queijo", quantity: 2, unitPriceCents: 500, totalCents: 1000 }],
          serviceFeeBasisPoints: 0,
          fixedFeesCents: 0,
          totalCents: 1000,
        }),
      });
    });

    await loginAs(alice, { navigate: false });
    await page.goto("/app/bill/new?scan=true");
    await page.waitForLoadState("networkidle");

    await page.locator('input[type="file"]:not([capture])').setInputFiles({
      name: "recibo.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    await page.getByRole("button", { name: "Processar" }).click();

    await expect(page.getByRole("heading", { name: "Recibo" })).toBeVisible({ timeout: 20000 });

    const createRoom = page.getByRole("button", { name: "Criar sala de divisão" });
    const managePeople = page.getByRole("button", { name: "Gerenciar pessoas" });
    const proceed = page.getByRole("button", { name: "Dividir manualmente" });

    const addPeople = page.getByRole("button", { name: "Adicionar pessoas" });
    await expect(addPeople).toBeVisible();
    await expect(createRoom).toBeEnabled();
    await expect(proceed).toBeDisabled();

    await addPeople.click();
    await page.getByRole("button", { name: "Por @handle" }).click();
    await page.getByPlaceholder("handle do usuario").fill(bob.handle);
    await page.getByRole("button", { name: "Buscar handle" }).click();
    await page.getByRole("button", { name: "Adicionar" }).click();
    await page.getByRole("button", { name: "Concluir" }).click();

    await expect(managePeople).toBeVisible();
    await expect(managePeople).toHaveAccessibleName(/^Gerenciar pessoas Alice/);
    await expect(createRoom).toBeDisabled();
    await expect(
      page.getByText(
        "Você adicionou pessoas para dividir manualmente. Remova essas pessoas para criar uma sala.",
      ),
    ).toBeVisible();
    await expect(proceed).toBeEnabled();

    await proceed.click();
    await expect(managePeople).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Itens" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Nome do item Pão de queijo" })).toHaveValue("Pão de queijo");
  });
});
