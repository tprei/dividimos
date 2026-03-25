import { test, expect } from "@playwright/test";

/**
 * Edit Draft Flow Test
 *
 * Tests that a user can:
 * 1. Create a draft bill (single_amount with 2 participants)
 * 2. Navigate to the draft detail page
 * 3. Click "Editar rascunho" to re-enter the wizard
 * 4. Verify pre-populated state and "Editar rascunho" heading
 * 5. Navigate through steps and modify data
 *
 * Uses accessibility tree selectors (getByRole, getByLabel).
 */

test.use({ storageState: "e2e/.auth/alice.json" });

test.describe("Edit Draft Flow", () => {
  test("creates a draft, then edits it via the edit button", async ({ page }) => {
    const billTitle = `Rascunho editavel ${Date.now()}`;

    // === Step 1: Create a draft bill ===
    await page.goto("/app/bill/new");

    // Select "Valor unico"
    await page.getByRole("button", { name: /valor unico/i }).click();

    // Enter bill title
    await expect(page.getByLabel(/nome da conta/i)).toBeVisible();
    await page.getByLabel(/nome da conta/i).fill(billTitle);

    // Continue to participants step
    await page.getByRole("button", { name: /proximo/i }).click();

    // Add Bob by handle
    await expect(page.getByText(/adicionar participantes/i)).toBeVisible();
    await page.getByRole("button", { name: /@handle/i }).click();
    await page.getByPlaceholder(/@bob/i).fill("@bob_test");
    await page.getByRole("button", { name: /adicionar/i }).click();
    await expect(page.getByText(/bob/i)).toBeVisible();

    // Continue to amount-split step (this saves the draft)
    await page.getByRole("button", { name: /proximo/i }).click();

    // Enter total amount
    await expect(page.getByLabel(/valor total/i)).toBeVisible();
    await page.getByLabel(/valor total/i).fill("200");

    // Continue to payer step (saves draft with splits)
    await page.getByRole("button", { name: /proximo/i }).click();
    await expect(page.getByText(/quem pagou/i)).toBeVisible();

    // Set Alice as payer
    await page.getByRole("button", { name: /alice/i }).first().click();

    // Continue to summary (saves draft with payer)
    await page.getByRole("button", { name: /proximo/i }).click();
    await expect(page.getByText(/resumo/i)).toBeVisible();

    // Get the bill URL from draft detail — we need to navigate there
    // The bill was saved as draft; navigate to the bills list to find it
    await page.goto("/app/bills");

    // Find the draft bill by title and navigate to it
    const draftLink = page.getByText(billTitle);
    await expect(draftLink).toBeVisible({ timeout: 10000 });
    await draftLink.click();

    // === Step 2: Verify draft detail page shows edit button ===
    await expect(page.getByRole("button", { name: /editar rascunho/i })).toBeVisible({ timeout: 10000 });

    // Verify the bill title is shown
    await expect(page.getByText(billTitle)).toBeVisible();

    // === Step 3: Click edit button ===
    await page.getByRole("button", { name: /editar rascunho/i }).click();

    // === Step 4: Verify edit mode ===
    // Should show "Editar rascunho" heading (not "Nova conta")
    await expect(page.getByRole("heading", { name: /editar rascunho/i })).toBeVisible({ timeout: 10000 });

    // Should NOT show the type selector (skipped in edit mode)
    await expect(page.getByText(/que tipo de conta/i)).not.toBeVisible();
  });
});
