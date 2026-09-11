import { test, expect } from "../fixtures";

test.describe("Itemized participants dialog", () => {
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

    const dialog = page.getByRole("dialog", { name: "Participantes" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Por @handle" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Adicionar convidado" })).toBeVisible();
    await expect(dialog.getByText("Grupo Itens A")).toHaveCount(0);
    await expect(dialog.getByText("Grupo Itens B")).toHaveCount(0);
    await expect(dialog.getByText("Criar grupo com essas pessoas")).toHaveCount(0);

    const done = dialog.getByRole("button", { name: "Concluir" });
    await expect(done).toBeVisible();
    await expect(done).toBeInViewport();
  });
});
