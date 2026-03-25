import { test, expect } from "@playwright/test";

/**
 * Draft Deletion Flow Test
 *
 * Tests that a user can delete their own draft bills from the bills list:
 * 1. Alice creates a draft bill
 * 2. Navigates to bills list
 * 3. Clicks the trash icon on the draft
 * 4. Confirms deletion in the dialog
 * 5. Verifies the bill is removed from the list
 */

test.use({ storageState: "e2e/.auth/alice.json" });

test.describe("Draft Deletion Flow", () => {
  test("deletes a draft bill from the bills list", async ({ page }) => {
    const draftTitle = `Rascunho para excluir ${Date.now()}`;

    // Create a draft bill first
    await page.goto("/app/bill/new");
    await expect(page.getByRole("heading", { name: /nova conta/i })).toBeVisible();

    // Select "Valor unico"
    await page.getByRole("button", { name: /valor unico/i }).click();

    // Enter bill title
    await expect(page.getByLabel(/nome da conta/i)).toBeVisible();
    await page.getByLabel(/nome da conta/i).fill(draftTitle);

    // Navigate to participants step (this triggers a draft save)
    await page.getByRole("button", { name: /proximo/i }).click();
    await expect(page.getByText(/adicionar participantes/i)).toBeVisible();

    // Go to bills list
    await page.goto("/app/bills");

    // Wait for bills to load
    await expect(page.getByRole("heading", { name: /suas contas/i })).toBeVisible();

    // Verify the draft appears in the list
    await expect(page.getByText(draftTitle)).toBeVisible();

    // Click the trash icon on the draft bill
    const billCard = page.getByText(draftTitle).locator("../..");
    const trashButton = billCard.locator("..").getByRole("button", { name: /excluir rascunho/i });
    await trashButton.click();

    // Confirmation dialog should appear
    await expect(page.getByText(/excluir rascunho\?/i)).toBeVisible();
    await expect(page.getByText(/esta ação não pode ser desfeita/i)).toBeVisible();

    // Click "Excluir" to confirm
    await page.getByRole("button", { name: /^excluir$/i }).click();

    // Verify the bill is removed from the list
    await expect(page.getByText(draftTitle)).not.toBeVisible();
  });

  test("cancelling deletion keeps the draft", async ({ page }) => {
    const draftTitle = `Rascunho para manter ${Date.now()}`;

    // Create a draft
    await page.goto("/app/bill/new");
    await page.getByRole("button", { name: /valor unico/i }).click();
    await expect(page.getByLabel(/nome da conta/i)).toBeVisible();
    await page.getByLabel(/nome da conta/i).fill(draftTitle);
    await page.getByRole("button", { name: /proximo/i }).click();
    await expect(page.getByText(/adicionar participantes/i)).toBeVisible();

    // Go to bills list
    await page.goto("/app/bills");
    await expect(page.getByRole("heading", { name: /suas contas/i })).toBeVisible();
    await expect(page.getByText(draftTitle)).toBeVisible();

    // Click trash
    const billCard = page.getByText(draftTitle).locator("../..");
    const trashButton = billCard.locator("..").getByRole("button", { name: /excluir rascunho/i });
    await trashButton.click();

    // Cancel
    await page.getByRole("button", { name: /cancelar/i }).click();

    // Draft should still be visible
    await expect(page.getByText(draftTitle)).toBeVisible();
  });
});
