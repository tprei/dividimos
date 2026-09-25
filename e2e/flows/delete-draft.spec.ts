import { test, expect } from "@playwright/test";

test.use({ storageState: "e2e/.auth/alice.json", serviceWorkers: "block" });

test("keeps a draft on cancellation and discards only after confirmation", async ({ page }) => {
  await page.goto("/app/bill/new");
  await page.getByRole("button", { name: /Valor único/ }).click();
  await page.getByLabel("Nome da conta").fill("Cinema");
  await page.getByRole("button", { name: "Fechar" }).click();
  await page.getByRole("button", { name: "Sair e guardar" }).click();
  await page.goto("/app/bill/new");
  await page.getByRole("button", { name: "Descartar", exact: true }).click();
  await page.getByRole("button", { name: "Manter rascunho" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cinema" })).toBeVisible();
  await page.getByRole("button", { name: "Descartar", exact: true }).click();
  await page.getByRole("button", { name: "Descartar rascunho" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: /Valor único/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar", exact: true })).toHaveCount(0);
});
