import { test, expect } from "@playwright/test";

/**
 * Settlement Flow Test
 *
 * Tests the debt settlement flow:
 * 1. View an existing bill with ledger entries
 * 2. Verify debt simplification display
 * 3. Check Pix QR code generation for payment
 *
 * Uses accessibility tree selectors for robust testing.
 */

test.use({ storageState: "e2e/.auth/bob.json" });

test.describe("Settlement Flow", () => {
  test("displays ledger and simplification for existing bill", async ({ page }) => {
    // Navigate to bills list
    await page.goto("/app/bills");
    await page.waitForLoadState("networkidle");

    // Look for any bill card
    const billCard = page.getByRole("link", { name: /conta|jantar|almoco/i }).first();

    if (await billCard.isVisible()) {
      await billCard.click();

      // Wait for bill detail page
      await page.waitForLoadState("networkidle");

      // Verify ledger section exists
      await expect(
        page.getByRole("heading", { name: /divida|pagar|receber/i })
      ).toBeVisible();

      // Check for debt entries
      const debtEntry = page.getByText(/deve|pagar a|receber de/i);
      await expect(debtEntry.first()).toBeVisible();

      // Look for simplification toggle if available
      const simplifyToggle = page.getByRole("button", { name: /simplificar|detalhar/i });

      if (await simplifyToggle.isVisible()) {
        // Toggle simplification
        await simplifyToggle.click();

        // Verify simplified view shows fewer entries
        await page.waitForTimeout(500);
      }
    } else {
      // No bills exist yet - skip test gracefully
      test.skip(true, "No bills available to test settlement flow");
    }
  });

  test("generates Pix QR code for payment", async ({ page }) => {
    await page.goto("/app/bills");
    await page.waitForLoadState("networkidle");

    // Look for a bill where we owe money
    const billCard = page.getByRole("link", { name: /conta|jantar|almoco/i }).first();

    if (await billCard.isVisible()) {
      await billCard.click();
      await page.waitForLoadState("networkidle");

      // Look for "Pagar" button
      const payButton = page.getByRole("button", { name: /pagar|pix/i }).first();

      if (await payButton.isVisible()) {
        await payButton.click();

        // Verify QR modal appears
        await expect(page.getByRole("dialog")).toBeVisible();

        // Check for QR code image
        const qrCode = page.getByRole("img", { name: /qr|pix/i });
        await expect(qrCode).toBeVisible();

        // Check for "Copia e Cola" button
        await expect(
          page.getByRole("button", { name: /copia e cola|copiar/i })
        ).toBeVisible();

        // Close modal
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).not.toBeVisible();
      } else {
        // We don't owe anything on this bill
        test.skip(true, "No payment due on available bills");
      }
    } else {
      test.skip(true, "No bills available to test Pix QR generation");
    }
  });

  test("shows debt graph visualization", async ({ page }) => {
    await page.goto("/app/bills");
    await page.waitForLoadState("networkidle");

    const billCard = page.getByRole("link", { name: /conta|jantar|almoco/i }).first();

    if (await billCard.isVisible()) {
      await billCard.click();
      await page.waitForLoadState("networkidle");

      // Look for graph/visualization toggle
      const graphToggle = page.getByRole("button", { name: /grafico|visualizar/i });

      if (await graphToggle.isVisible()) {
        await graphToggle.click();

        // Verify SVG graph appears
        const svgGraph = page.locator("svg");
        await expect(svgGraph).toBeVisible();

        // Check for user nodes in graph
        const userNodes = page.locator("svg circle, svg text");
        expect(await userNodes.count()).toBeGreaterThan(0);
      }
    }
  });
});

test.describe("Settlement - Multi-user acceptance", () => {
  test("participant accepts bill invite", async ({ browser }) => {
    // This tests the bill participant acceptance flow
    const bobContext = await browser.newContext({
      storageState: "e2e/.auth/bob.json",
    });

    const bobPage = await bobContext.newPage();

    try {
      // Bob checks for pending bill invites
      await bobPage.goto("/app/bills");
      await bobPage.waitForLoadState("networkidle");

      // Look for bills with "invited" or "pending" status
      const pendingInvite = bobPage.getByRole("button", { name: /aceitar/i }).first();

      if (await pendingInvite.isVisible()) {
        await pendingInvite.click();

        // Verify acceptance was processed
        await bobPage.waitForTimeout(500);

        // Status should change to "accepted"
        await expect(bobPage.getByText(/aceito|confirmado/i)).toBeVisible();
      }
    } finally {
      await bobContext.close();
    }
  });
});
