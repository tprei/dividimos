import { test, expect } from "../fixtures";

test.describe("Itemized participants step", () => {
  test("asks the group once, then keeps people controls inline", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Itens" });
    const bob = await seed.createUser({ name: "Bob Itens" });
    await seed.createGroup(alice.id, [bob.id], "Grupo Itens A");
    await seed.createGroup(alice.id, [bob.id], "Grupo Itens B");

    await loginAs(alice, { navigate: false });
    await page.goto("/app/bill/new");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Vários itens/ }).click();

    const title = page.getByRole("textbox", { name: "Nome da conta" });
    await title.fill("Rodízio");
    await title.press("Enter");
    await page.getByRole("button", { name: "Ontem", exact: true }).click();

    await expect(page.getByRole("heading", { name: "De qual grupo?" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Grupo Itens B/ })).toBeVisible();
    await page.getByRole("button", { name: /Grupo Itens A/ }).click();

    await expect(page.getByRole("textbox", { name: "Nome da conta" })).toHaveValue("Rodízio");
    await expect(page.getByRole("button", { name: "Data: Ontem" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Grupo: Grupo Itens A" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Por @handle" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Adicionar convidado" })).toBeVisible();
    await expect(page.getByText("Escolher um grupo existente")).toHaveCount(0);
    await expect(page.getByText("Criar grupo com essas pessoas")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bob Itens" })).toHaveAttribute("aria-pressed", "true");
  });
});
