import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import type { SeedHelper, SeededUser } from "../seed-helper";

async function openBills(page: Page, seed: SeedHelper, loginAs: (user: SeededUser) => Promise<void>) {
  const user = await seed.createUser({ name: "Ana Contas" });
  const group = await seed.createGroup(user.id, [], "Contas da Ana");
  const expense = await seed.createExpense(group.id, user.id, [user.id], { title: "Compra compartilhada", totalCents: 12000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(user);
  await page.goto("/app/bills");
  const row = page.getByRole("link", { name: /Compra compartilhada/ });
  await expect(row).toBeVisible();
  return { expense, row };
}

test.describe("Bill row actions at 390px", () => {
  test("delete stays reachable without the gesture and remains reversible", async ({ page, seed, loginAs }) => {
    const { expense, row } = await openBills(page, seed, loginAs);
    const remove = page.getByRole("button", { name: "Excluir conta", exact: true });
    await page.getByRole("button", { name: "Mostrar ações da conta" }).click();
    await remove.click();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(row).toBeVisible();
    await page.getByRole("button", { name: "Mostrar ações da conta" }).click();
    await remove.click();
    await page.getByRole("button", { name: "Excluir", exact: true }).click();
    await expect(row).toContainText("Excluída");
    await row.click();
    await expect(page).toHaveURL(`/app/bill/${expense.id}`);
    await page.getByRole("button", { name: "Restaurar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Editar conta" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test.describe("with a swipe", () => {
    test.skip(({ browserName }) => browserName !== "chromium", "WebKit ignores a synthetic mouse drag");

    test("swiping a row left reveals the delete action", async ({ page, seed, loginAs }) => {
      const { row } = await openBills(page, seed, loginAs);
      const box = await row.boundingBox();
      if (!box) throw new Error("Conta não apareceu");
      await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 150, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
      await expect(page.getByRole("button", { name: "Excluir conta", exact: true })).toBeVisible();
    });
  });
});
