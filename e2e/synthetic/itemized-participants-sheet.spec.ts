import { test, expect } from "../fixtures";

test.describe("Itemized participants sheet", () => {
  test("shows people controls only, since the Conta section owns the group", async ({
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

    await expect(page.getByRole("combobox", { name: "Grupo" })).toBeVisible();
    await page.getByRole("button", { name: /Participantes/ }).click();

    const sheet = page.getByRole("dialog", { name: "Participantes" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Por @handle" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Adicionar convidado" })).toBeVisible();
    await expect(sheet.getByText("Grupo Itens A")).toHaveCount(0);
    await expect(sheet.getByText("Grupo Itens B")).toHaveCount(0);
    await expect(sheet.getByText("Criar grupo com essas pessoas")).toHaveCount(0);
  });
});
