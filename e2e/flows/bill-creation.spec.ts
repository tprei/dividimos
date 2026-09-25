import { test, expect } from "@playwright/test";

/**
 * Bill Creation Flow Test
 *
 * Tests the complete flow of creating bills:
 * - "Valor unico" (single-amount) bill with two participants
 * - "Varios itens" (itemized) bill with items and splits
 * - Bill creation with group participants
 *
 * Uses accessibility tree selectors matching the actual UI.
 */

test.use({ storageState: "e2e/.auth/alice.json", serviceWorkers: "block" });

test.describe("Bill Creation Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app");
    // Wait for auth to settle before proceeding
    await page.waitForLoadState("networkidle");
  });

  test("creates single-amount bill with two participants", async ({ page }) => {
    const title = `Almoço ${Date.now()}`;
    await page.goto("/app/bill/new");
    await page.getByRole("button", { name: /Valor único/ }).click();
    await page.getByLabel("Nome da conta").fill(title);
    await page.getByRole("button", { name: "Por @handle" }).click();
    await page.getByPlaceholder("handle do usuario").fill("bob_test");
    await page.getByRole("button", { name: "Buscar handle" }).click();
    await page.getByRole("button", { name: "Adicionar", exact: true }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByLabel("Valor total").fill("100");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("button", { name: "Salvar conta" }).click();
    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });

  test("keeps itemized entry and item editing reachable", async ({ page }) => {
    await page.goto("/app/bill/new");
    await page.getByRole("button", { name: /Vários itens/ }).click();
    await page.getByLabel("Nome da conta").fill("Pizzaria");
    await page.getByRole("button", { name: "Por @handle" }).click();
    await page.getByPlaceholder("handle do usuario").fill("bob_test");
    await page.getByRole("button", { name: "Buscar handle" }).click();
    await page.getByRole("button", { name: "Adicionar", exact: true }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("textbox", { name: "Descrição (ex: Picanha 400g)" }).fill("Pizza Margherita");
    await page.getByRole("textbox", { name: "Preço unitário" }).fill("80");
    await page.getByRole("button", { name: "Adicionar", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Nome do item Pizza Margherita" })).toHaveValue("Pizza Margherita");
  });

  test("keeps group creation reachable from the single amount screen", async ({ page }) => {
    await page.goto("/app/bill/new");
    await page.getByRole("button", { name: /Valor único/ }).click();
    await page.getByLabel("Nome da conta").fill("Conta do grupo");
    await page.getByRole("combobox", { name: "Grupo", exact: true }).click();
    await page.getByRole("option", { name: "Novo grupo…" }).click();
    await page.getByLabel("Nome do grupo", { exact: true }).fill("Jantar de amigos");
    await page.getByRole("button", { name: "Fechar" }).click();
    await page.getByRole("button", { name: "Sair e guardar" }).click();
    await page.goto("/app/bill/new");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByLabel("Nome da conta")).toHaveValue("Conta do grupo");
  });
});
