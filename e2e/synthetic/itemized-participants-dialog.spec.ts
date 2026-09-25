import { test, expect } from "../fixtures";

test.describe("Itemized participants step", () => {
  test("keeps people controls inline and leaves the group to the group picker", async ({
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

    await expect(page.getByRole("combobox", { name: "Grupo", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Por @handle" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Adicionar convidado" })).toBeVisible();
    await expect(page.getByText("Escolher um grupo existente")).toHaveCount(0);
    await expect(page.getByText("Criar grupo com essas pessoas")).toHaveCount(0);

    await page.getByRole("combobox", { name: "Grupo", exact: true }).click();
    await page.getByRole("option", { name: "Grupo Itens A" }).click();
    await expect(page.getByRole("button", { name: "Bob Itens" })).toHaveAttribute("aria-pressed", "true");
  });
});
