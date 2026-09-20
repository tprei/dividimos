import { test, expect } from "../fixtures";

test.describe("Percentage payer split shows money while you drag", () => {
  test("names each payer's amount before the split reaches 100%", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Percentual" });
    const bob = await seed.createUser({ name: "Bob Percentual" });
    await seed.createGroup(alice.id, [bob.id], "Grupo Percentual");

    await loginAs(alice);
    await page.goto("/app/bill/new");

    await page.getByRole("button", { name: /Vários itens/ }).click();
    await page.getByRole("textbox", { name: "Nome" }).fill("Conta detalhada");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Grupo Percentual" }).click();

    await page.getByRole("tab", { name: "Itens" }).click();
    // No service fee, so the percentages map onto round numbers.
    await page.getByRole("textbox", { name: "Taxa de serviço (%)" }).fill("0");
    await page.getByRole("button", { name: "Adicionar item" }).click();
    await page.getByPlaceholder("Descrição (ex: Picanha 400g)").fill("Rodízio");
    await page.getByRole("textbox", { name: "Preço unitário" }).fill("100,00");
    await page.getByRole("button", { name: "Adicionar", exact: true }).click();

    await page.getByRole("tab", { name: "Pagamento" }).click();
    await page.getByRole("button", { name: "Mais de uma pessoa pagou" }).click();
    await page.getByRole("button", { name: "Porcentagem" }).click();

    const alicePercent = page.getByRole("slider", { name: "Percentual pago por Alice Percentual" });
    await alicePercent.fill("40");

    // The whole point: the amount is readable while the split is still short,
    // instead of an em dash until the sliders happen to land on 100%.
    await expect(page.getByText(/R\$\s*40,00/).first()).toBeVisible();
    await expect(page.getByText(/faltam .*% para completar 100%/)).toBeVisible();

    const bobPercent = page.getByRole("slider", { name: "Percentual pago por Bob Percentual" });
    await bobPercent.fill("70");

    await expect(page.getByText(/excede 100% em/)).toBeVisible();
    await expect(page.getByText(/R\$\s*70,00/).first()).toBeVisible();
  });
});
