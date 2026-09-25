import { test, expect } from "@playwright/test";

test.use({ storageState: "e2e/.auth/alice.json", serviceWorkers: "block" });

test("resumes and edits a local draft without creating an expense", async ({ page }) => {
  await page.goto("/app/bill/new");
  await page.getByRole("button", { name: /Valor único/ }).click();
  await page.getByLabel("Nome da conta").fill("Pizza de sexta");
  await page.getByRole("button", { name: "Adicionar convidado" }).click();
  await page.getByPlaceholder("Nome do convidado").fill("Carla");
  await page.getByPlaceholder("Nome do convidado").press("Enter");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("Valor total").fill("80");
  await page.getByRole("button", { name: "Fechar" }).click();
  await page.getByRole("button", { name: "Sair e guardar" }).click();
  await page.goto("/app/bill/new");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("Nome da conta").fill("Pizza de sábado");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByLabel("Valor total")).toHaveValue("80,00");
  await page.reload();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByLabel("Nome da conta")).toHaveValue("Pizza de sábado");
});
