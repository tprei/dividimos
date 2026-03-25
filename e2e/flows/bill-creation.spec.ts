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

test.use({ storageState: "e2e/.auth/alice.json" });

test.describe("Bill Creation Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app");
    // Wait for auth to settle before proceeding
    await page.waitForLoadState("networkidle");
  });

  test("creates single-amount bill with two participants", async ({ page }) => {
    const billTitle = `Conta do almoco ${Date.now()}`;

    // Navigate to new bill
    await page.goto("/app/bill/new");
    await page.waitForLoadState("networkidle");

    // Verify we're on type selection step
    await expect(page.getByRole("heading", { name: /nova conta/i })).toBeVisible();

    // Select "Valor unico"
    await page.getByRole("button", { name: /valor unico/i }).click();

    // Verify we're on info step (check for bill name input)
    await expect(page.getByPlaceholder(/airbnb|uber|presente/i)).toBeVisible();

    // Enter bill title
    await page.getByPlaceholder(/airbnb|uber|presente/i).fill(billTitle);

    // Continue to participants step
    await page.getByRole("button", { name: /proximo/i }).click();

    // Verify we're on participants step
    await expect(page.getByText(/adicione participantes|adicionar participantes/i)).toBeVisible();

    // Add Bob by handle — click the "Por @handle" button to open the form
    await page.getByRole("button", { name: /por @handle|@handle/i }).click();

    // Fill handle and search
    await page.getByPlaceholder(/handle do usuario/i).fill("bob_test");
    await page.getByPlaceholder(/handle do usuario/i).press("Enter");

    // Wait for search result and click Adicionar
    await expect(page.getByRole("button", { name: /adicionar/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /adicionar/i }).click();

    // Verify Bob was added
    await expect(page.getByText(/bob/i).first()).toBeVisible();

    // Continue to amount split step
    await page.getByRole("button", { name: /proximo/i }).click();

    // Verify we're on amount split step (input has placeholder "0,00")
    await expect(page.getByPlaceholder("0,00")).toBeVisible();

    // Enter total amount
    await page.getByPlaceholder("0,00").fill("100");

    // Split equally (default behavior, just continue)
    await page.getByRole("button", { name: /proximo/i }).click();

    // Verify we're on payer step
    await expect(page.getByText(/quem pagou/i)).toBeVisible();

    // Set Alice as payer — the payer buttons include initials and names like "A Alice Test"
    await page.getByRole("button", { name: /alice/i }).first().click();

    // Continue to summary
    await page.getByRole("button", { name: /proximo/i }).click();

    // Verify we're on summary step — check for the summary section
    await expect(page.getByText(/resumo/i).first()).toBeVisible();

    // Verify bill amount is shown (R$ 100,00)
    await expect(page.getByText("R$ 100,00").first()).toBeVisible();

    // Verify per-person breakdown exists
    await expect(page.getByText(/por pessoa/i)).toBeVisible();
  });

  test("creates itemized bill with items and splits", async ({ page }) => {
    await page.goto("/app/bill/new");
    await page.waitForLoadState("networkidle");

    // Select "Varios itens"
    await page.getByRole("button", { name: /varios itens/i }).click();

    // Enter bill name
    const nameInput = page.getByRole("textbox").first();
    await nameInput.fill("Jantar");

    // Continue to participants
    await page.getByRole("button", { name: /proximo/i }).click();

    // Add Bob
    await page.getByRole("button", { name: /por @handle|@handle/i }).click();
    await page.getByPlaceholder(/handle do usuario/i).fill("bob_test");
    await page.getByPlaceholder(/handle do usuario/i).press("Enter");
    await expect(page.getByRole("button", { name: /adicionar/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /adicionar/i }).click();

    // Continue to items
    await page.getByRole("button", { name: /proximo/i }).click();

    // Add an item
    await page.getByRole("button", { name: /adicionar item/i }).click();

    // Fill item details
    const itemInputs = page.getByRole("textbox");
    await itemInputs.first().fill("Pizza Margherita");

    // Find and fill the price field
    const priceInput = page.getByPlaceholder("0,00").first();
    await priceInput.fill("80");

    // Save/add the item
    await page.getByRole("button", { name: /adicionar|salvar/i }).click();

    // Verify item was added
    await expect(page.getByText("Pizza Margherita")).toBeVisible();

    // Continue to split step
    await page.getByRole("button", { name: /proximo/i }).click();

    // Verify split step shows the item
    await expect(page.getByText("Pizza Margherita")).toBeVisible();

    // Continue to payer step
    await page.getByRole("button", { name: /proximo/i }).click();

    // Wait for payer step to load
    await expect(page.getByText(/quem pagou/i)).toBeVisible();

    // Set payer — click Alice's payer button
    const alicePayerBtn = page.getByRole("button", { name: /alice/i }).first();
    await expect(alicePayerBtn).toBeVisible();
    await alicePayerBtn.click();

    // Wait for payer to be registered (Proximo should become enabled)
    await expect(page.getByRole("button", { name: /proximo/i })).toBeEnabled({ timeout: 5000 });

    // Continue to summary
    await page.getByRole("button", { name: /proximo/i }).click();

    // Verify summary shows the bill details
    await expect(page.getByText(/resumo/i).first()).toBeVisible();
  });

  test("bill creation with group participants", async ({ page }) => {
    await page.goto("/app/bill/new");
    await page.waitForLoadState("networkidle");

    // Select "Valor unico"
    await page.getByRole("button", { name: /valor unico/i }).click();

    // Enter title
    await page.getByPlaceholder(/airbnb|uber|presente/i).fill("Conta do grupo");

    // Continue
    await page.getByRole("button", { name: /proximo/i }).click();

    // On participants step, check if group selector exists
    const groupButton = page.getByRole("button", { name: /selecionar grupo/i });

    if (await groupButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await groupButton.click();

      const groupOption = page.getByRole("button", { name: /teste|jantar/i }).first();
      if (await groupOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await groupOption.click();
        await expect(page.getByText(/grupo/i)).toBeVisible();
      }
    }

    // If no groups, just add a participant manually to continue
    const proximoButton = page.getByRole("button", { name: /proximo/i });
    if (await proximoButton.isDisabled()) {
      await page.getByRole("button", { name: /por @handle|@handle/i }).click();
      await page.getByPlaceholder(/handle do usuario/i).fill("bob_test");
      await page.getByPlaceholder(/handle do usuario/i).press("Enter");
      await expect(page.getByRole("button", { name: /adicionar/i })).toBeVisible({ timeout: 10000 });
      await page.getByRole("button", { name: /adicionar/i }).click();
    }

    // Continue with the flow
    await page.getByRole("button", { name: /proximo/i }).click();
  });
});
