import { test, expect } from "../fixtures";

test.describe("Itemized payer split balances percentages as you type", () => {
  test("completes the other payer and names both amounts", async ({
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
    await page.getByLabel("Nome da conta").fill("Conta detalhada");
    await page.getByLabel("Nome da conta").press("Enter");
    await page.getByRole("button", { name: "Hoje", exact: true }).click();
    await page.getByRole("button", { name: /Grupo Percentual/ }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();

    await page.getByRole("textbox", { name: "Taxa de serviço (%)" }).fill("0");
    await page.getByPlaceholder("Descrição (ex: Picanha 400g)").fill("Rodízio");
    await page.getByRole("textbox", { name: "Preço unitário" }).fill("100,00");
    await page.getByRole("button", { name: "Adicionar", exact: true }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();

    await page.getByRole("button", { name: "Dividir tudo igualmente" }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();

    const payers = page.getByRole("list", { name: "Quem pagou" });
    await payers.getByRole("button", { name: /Bob/ }).click();
    await page.getByRole("radiogroup", { name: "Como dividir: Quem pagou" }).getByText("%", { exact: true }).click();
    await page.getByRole("textbox", { name: "Percentual que Alice Percentual pagou" }).fill("40");

    await expect(page.getByRole("textbox", { name: "Percentual que Bob Percentual pagou" })).toHaveValue("60");
    await expect(payers.getByText(/R\$\s*40,00/)).toBeVisible();
    await expect(payers.getByText(/R\$\s*60,00/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Salvar conta" })).toBeEnabled();
  });
});
