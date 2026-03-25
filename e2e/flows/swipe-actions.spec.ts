import { test, expect } from "@playwright/test";

/**
 * Swipeable Bill Card Actions E2E Test
 *
 * Tests the swipe-to-reveal interaction on draft bill cards:
 * 1. Creates a draft bill
 * 2. Navigates to bills list
 * 3. Swipes left on the draft card to reveal Edit/Delete buttons
 * 4. Tests both edit and delete actions via the revealed buttons
 * 5. Verifies the swipe hint chevron is visible on draft cards
 */

test.use({ storageState: "e2e/.auth/alice.json" });

/** Helper: create a draft bill and navigate to the bills list */
async function createDraftAndGoToBills(page: import("@playwright/test").Page, title: string) {
  await page.goto("/app/bill/new");
  await expect(page.getByRole("heading", { name: /nova conta/i })).toBeVisible();

  // Select "Valor unico"
  await page.getByRole("button", { name: /valor unico/i }).click();

  // Enter bill title
  await expect(page.getByLabel(/nome da conta/i)).toBeVisible();
  await page.getByLabel(/nome da conta/i).fill(title);

  // Navigate to participants step (triggers draft save)
  await page.getByRole("button", { name: /proximo/i }).click();
  await expect(page.getByText(/adicionar participantes/i)).toBeVisible();

  // Go to bills list
  await page.goto("/app/bills");
  await expect(page.getByRole("heading", { name: /suas contas/i })).toBeVisible();
  await expect(page.getByText(title)).toBeVisible();
}

/** Helper: swipe left on a bill card to reveal action buttons */
async function swipeCardLeft(page: import("@playwright/test").Page, title: string) {
  const billCard = page.getByText(title);
  const box = await billCard.boundingBox();
  if (!box) throw new Error(`Could not find bounding box for "${title}"`);

  // Perform a left swipe gesture starting from the right side of the card
  const startX = box.x + box.width - 20;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Drag left past the snap threshold (40px) + some extra
  await page.mouse.move(startX - 140, startY, { steps: 10 });
  await page.mouse.up();

  // Wait for spring animation to settle
  await page.waitForTimeout(500);
}

test.describe("Swipeable Bill Card Actions", () => {
  test("swipe hint chevron is visible on draft cards", async ({ page }) => {
    const draftTitle = `Swipe hint ${Date.now()}`;
    await createDraftAndGoToBills(page, draftTitle);

    // The swipe hint chevron should be visible on the draft card
    const billCard = page.getByText(draftTitle).locator("../..");
    // The chevron is inside a pointer-events-none container within the card
    const chevron = billCard.locator(".pointer-events-none").first();
    await expect(chevron).toBeVisible();
  });

  test("swiping left reveals edit and delete buttons", async ({ page }) => {
    const draftTitle = `Swipe reveal ${Date.now()}`;
    await createDraftAndGoToBills(page, draftTitle);

    // Before swipe, action buttons should not be interactable (hidden behind card)
    await swipeCardLeft(page, draftTitle);

    // After swipe, edit and delete buttons should be visible
    const editButton = page.getByRole("button", { name: /editar rascunho/i }).first();
    const deleteButton = page.getByRole("button", { name: /excluir rascunho/i }).first();

    await expect(editButton).toBeVisible();
    await expect(deleteButton).toBeVisible();
  });

  test("swipe then tap edit navigates to edit wizard", async ({ page }) => {
    const draftTitle = `Swipe edit ${Date.now()}`;
    await createDraftAndGoToBills(page, draftTitle);

    await swipeCardLeft(page, draftTitle);

    // Click the edit button
    const editButton = page.getByRole("button", { name: /editar rascunho/i }).first();
    await editButton.click();

    // Should navigate to the edit wizard
    await expect(page.getByRole("heading", { name: /editar rascunho/i })).toBeVisible({
      timeout: 10000,
    });
  });

  test("swipe then tap delete shows confirmation and removes bill", async ({ page }) => {
    const draftTitle = `Swipe delete ${Date.now()}`;
    await createDraftAndGoToBills(page, draftTitle);

    await swipeCardLeft(page, draftTitle);

    // Click the delete button
    const deleteButton = page.getByRole("button", { name: /excluir rascunho/i }).first();
    await deleteButton.click();

    // Confirmation dialog should appear
    await expect(page.getByText(/excluir rascunho\?/i)).toBeVisible();
    await expect(page.getByText(/esta ação não pode ser desfeita/i)).toBeVisible();

    // Confirm deletion
    await page.getByRole("button", { name: /^excluir$/i }).click();

    // Bill should be removed
    await expect(page.getByText(draftTitle)).not.toBeVisible();
  });

  test("swipe then cancel delete keeps the bill", async ({ page }) => {
    const draftTitle = `Swipe cancel ${Date.now()}`;
    await createDraftAndGoToBills(page, draftTitle);

    await swipeCardLeft(page, draftTitle);

    // Click delete
    const deleteButton = page.getByRole("button", { name: /excluir rascunho/i }).first();
    await deleteButton.click();

    // Cancel in dialog
    await page.getByRole("button", { name: /cancelar/i }).click();

    // Bill should still be visible
    await expect(page.getByText(draftTitle)).toBeVisible();
  });

  test("non-draft bills do not have swipe actions", async ({ page }) => {
    // Navigate to bills list — any finalized bills should not have the swipe hint
    await page.goto("/app/bills");
    await expect(page.getByRole("heading", { name: /suas contas/i })).toBeVisible();

    // Check if there are any non-draft bills
    const settledBadges = page.getByText(/liquidada|parcial|pendente/i);
    const count = await settledBadges.count();

    if (count > 0) {
      // Non-draft bill cards should not have the pointer-events-none swipe hint
      const firstSettled = settledBadges.first();
      const card = firstSettled.locator("../..");
      // The edit/delete action buttons should not exist for non-drafts
      await expect(card.getByRole("button", { name: /editar rascunho/i })).not.toBeVisible();
    }
  });
});

test.describe("Swipeable Bill Card on Home Page", () => {
  test("swipe actions work on recent bills section", async ({ page }) => {
    const draftTitle = `Home swipe ${Date.now()}`;

    // Create a draft
    await page.goto("/app/bill/new");
    await page.getByRole("button", { name: /valor unico/i }).click();
    await expect(page.getByLabel(/nome da conta/i)).toBeVisible();
    await page.getByLabel(/nome da conta/i).fill(draftTitle);
    await page.getByRole("button", { name: /proximo/i }).click();
    await expect(page.getByText(/adicionar participantes/i)).toBeVisible();

    // Go to home page
    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    // Verify draft appears in recent bills
    await expect(page.getByText(draftTitle)).toBeVisible({ timeout: 10000 });

    // Swipe on the home page
    const billText = page.getByText(draftTitle);
    const box = await billText.boundingBox();
    if (!box) throw new Error("Could not find bill card");

    const startX = box.x + box.width - 20;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 140, startY, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(500);

    // Action buttons should be revealed
    const editButton = page.getByRole("button", { name: /editar rascunho/i }).first();
    await expect(editButton).toBeVisible();
  });
});
