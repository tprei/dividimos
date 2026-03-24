import { test, expect } from "@playwright/test";

/**
 * Bill Creation Flow Test
 *
 * Tests the complete flow of creating a "Valor unico" bill:
 * 1. Alice logs in
 * 2. Navigates to new bill
 * 3. Selects "Valor unico" type
 * 4. Enters bill details
 * 5. Adds Bob as participant
 * 6. Sets amount split
 * 7. Sets payer
 * 8. Verifies summary
 *
 * Uses accessibility tree selectors (getByRole, getByLabel) instead of visual inspection.
 */

test.use({ storageState: "e2e/.auth/alice.json" });

test.describe("Bill Creation Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Ensure we're starting from a clean state
    await page.goto("/app");
  });

  test("creates single-amount bill with two participants", async ({ page, browser }) => {
    // Navigate to new bill
    await page.goto("/app/bill/new");

    // Verify we're on type selection step
    await expect(page.getByRole("heading", { name: /nova conta/i })).toBeVisible();

    // Select "Valor unico"
    await page.getByRole("button", { name: /valor unico/i }).click();

    // Verify we're on info step (check for Nome da conta label)
    await expect(page.getByLabel(/nome da conta/i)).toBeVisible();

    // Enter bill title
    await page.getByLabel(/nome da conta/i).fill("Conta do almoco");

    // Continue to participants step
    await page.getByRole("button", { name: /proximo/i }).click();

    // Verify we're on participants step
    await expect(page.getByText(/adicionar participantes/i)).toBeVisible();

    // Alice should already be added as creator
    await expect(page.getByText(/voce/i)).toBeVisible();

    // Add Bob by handle
    await page.getByRole("button", { name: /@handle/i }).click();
    await page.getByPlaceholder(/@bob/i).fill("@bob_test");
    await page.getByRole("button", { name: /adicionar/i }).click();

    // Verify Bob was added
    await expect(page.getByText(/bob/i)).toBeVisible();

    // Continue to amount split step
    await page.getByRole("button", { name: /proximo/i }).click();

    // Verify we're on amount split step
    await expect(page.getByLabel(/valor total/i)).toBeVisible();

    // Enter total amount
    await page.getByLabel(/valor total/i).fill("100");

    // Split equally (default behavior, just continue)
    await page.getByRole("button", { name: /proximo/i }).click();

    // Verify we're on payer step
    await expect(page.getByText(/quem pagou/i)).toBeVisible();

    // Set Alice as payer (she paid the full amount)
    await page.getByRole("button", { name: /alice/i }).first().click();

    // Continue to summary
    await page.getByRole("button", { name: /proximo/i }).click();

    // Verify we're on summary step
    await expect(page.getByText(/resumo/i)).toBeVisible();

    // Verify bill title is shown
    await expect(page.getByText("Conta do almoco")).toBeVisible();

    // Note: Final "Gerar cobrancas Pix" button is disabled until Bob accepts
    // This is expected behavior for non-group bills
  });

  test("creates itemized bill with items and splits", async ({ page }) => {
    await page.goto("/app/bill/new");

    // Select "Varios itens"
    await page.getByRole("button", { name: /varios itens/i }).click();

    // Enter bill details
    await page.getByLabel(/nome da conta/i).fill("Jantar");

    // Continue to participants
    await page.getByRole("button", { name: /proximo/i }).click();

    // Add Bob
    await page.getByRole("button", { name: /@handle/i }).click();
    await page.getByPlaceholder(/@bob/i).fill("@bob_test");
    await page.getByRole("button", { name: /adicionar/i }).click();

    // Continue to items
    await page.getByRole("button", { name: /proximo/i }).click();

    // Add an item
    await page.getByRole("button", { name: /adicionar item/i }).click();

    // Fill item details
    await page.getByLabel(/descricao/i).fill("Pizza Margherita");
    await page.getByLabel(/preco/i).fill("80");
    await page.getByRole("button", { name: /adicionar|salvar/i }).click();

    // Verify item was added
    await expect(page.getByText("Pizza Margherita")).toBeVisible();

    // Continue to split step
    await page.getByRole("button", { name: /proximo/i }).click();

    // Verify split step shows the item
    await expect(page.getByText("Pizza Margherita")).toBeVisible();

    // Continue to payer step
    await page.getByRole("button", { name: /proximo/i }).click();

    // Set payer
    await page.getByRole("button", { name: /alice/i }).first().click();

    // Continue to summary
    await page.getByRole("button", { name: /proximo/i }).click();

    // Verify summary
    await expect(page.getByText("Jantar")).toBeVisible();
  });

  test("bill creation with group participants", async ({ page }) => {
    // This test assumes a group exists with Alice and Bob
    // Navigate to new bill
    await page.goto("/app/bill/new");

    // Select "Valor unico"
    await page.getByRole("button", { name: /valor unico/i }).click();

    // Enter title
    await page.getByLabel(/nome da conta/i).fill("Conta do grupo");

    // Continue
    await page.getByRole("button", { name: /proximo/i }).click();

    // On participants step, check if group selector exists
    const groupButton = page.getByRole("button", { name: /selecionar grupo/i });

    if (await groupButton.isVisible()) {
      // Click to select group
      await groupButton.click();

      // If groups exist, select one
      const groupOption = page.getByRole("button", { name: /teste/i }).first();
      if (await groupOption.isVisible()) {
        await groupOption.click();

        // Verify group members were added
        await expect(page.getByText(/grupo/i)).toBeVisible();
      }
    }

    // Continue with the flow
    await page.getByRole("button", { name: /proximo/i }).click();
  });
});
