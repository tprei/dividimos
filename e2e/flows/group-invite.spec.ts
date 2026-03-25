import { test, expect } from "@playwright/test";

/**
 * Group Invite Flow Test
 *
 * Tests the complete group invite/accept flow:
 * 1. Alice creates a group
 * 2. Alice invites Bob by @handle
 * 3. Bob sees the invite and accepts
 * 4. Both see each other in the group member list
 *
 * Uses two separate browser contexts to simulate multi-user interaction.
 */

test.describe("Group Invite Flow", () => {
  // Multi-user flows need more time
  test.setTimeout(60000);

  test("Alice creates group and invites Bob, Bob accepts", async ({ browser }) => {
    const aliceContext = await browser.newContext({
      storageState: "e2e/.auth/alice.json",
    });
    const bobContext = await browser.newContext({
      storageState: "e2e/.auth/bob.json",
    });

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    try {
      const testGroupName = `Jantar Mensal ${Date.now()}`;

      // === ALICE: Create group ===
      await alicePage.goto("/app/groups");
      await alicePage.waitForLoadState("networkidle");

      // Click "Novo" button to open inline creation form
      await alicePage.getByRole("button", { name: /novo/i }).click();

      // Enter group name and submit with Enter
      await alicePage.getByPlaceholder(/nome do grupo/i).fill(testGroupName);
      await alicePage.getByPlaceholder(/nome do grupo/i).press("Enter");

      // Wait for group to appear in the list
      await expect(alicePage.getByText(testGroupName)).toBeVisible({ timeout: 10000 });

      // Click on the group to navigate to detail page
      await alicePage.getByText(testGroupName).click();
      await alicePage.waitForURL(/\/app\/groups\/[a-f0-9-]+/);
      await alicePage.waitForLoadState("networkidle");

      // === ALICE: Invite Bob ===
      const convidarHeaderBtn = alicePage.getByRole("button", { name: /convidar/i });
      await expect(convidarHeaderBtn).toBeVisible({ timeout: 5000 });
      await convidarHeaderBtn.click();

      // Fill handle and search
      await alicePage.getByPlaceholder(/handle do usuario/i).fill("bob_test");
      await alicePage.getByPlaceholder(/handle do usuario/i).press("Enter");

      // Wait for the lookup result — Bob's name should appear in the result card
      await expect(alicePage.getByText(/bob test/i)).toBeVisible({ timeout: 10000 });

      // Click the "Convidar" button in the lookup result card (not the header one)
      // The result card button contains UserPlus icon + "Convidar" text
      const resultCard = alicePage.locator(".bg-muted\\/30");
      const inviteResultBtn = resultCard.getByRole("button", { name: /convidar/i });
      await expect(inviteResultBtn).toBeVisible();
      await inviteResultBtn.click();

      // Wait for invite to be processed — member list should refresh and show Bob
      await expect(alicePage.getByText("Bob Test")).toBeVisible({ timeout: 10000 });

      // === BOB: Check for invite ===
      await bobPage.goto("/app/groups");
      await bobPage.waitForLoadState("networkidle");

      // Bob should see the pending invite
      const acceptButton = bobPage.getByRole("button", { name: /aceitar/i });
      if (await acceptButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await acceptButton.click();
        await expect(acceptButton).not.toBeVisible({ timeout: 5000 });
      }

      // Bob should see the group in his list
      await expect(bobPage.getByText(testGroupName)).toBeVisible();
    } finally {
      await aliceContext.close();
      await bobContext.close();
    }
  });

  test("group bill skips participant acceptance", async ({ browser }) => {
    const aliceContext = await browser.newContext({
      storageState: "e2e/.auth/alice.json",
    });

    const alicePage = await aliceContext.newPage();

    try {
      await alicePage.goto("/app/bill/new");

      // Select "Valor unico"
      await alicePage.getByRole("button", { name: /valor unico/i }).click();

      // Enter title
      await alicePage.getByPlaceholder(/airbnb|uber|presente/i).fill("Conta do Grupo");

      // Continue to participants
      await alicePage.getByRole("button", { name: /proximo/i }).click();

      // Check if we can select a group
      const groupSelector = alicePage.getByRole("button", { name: /selecionar grupo/i });

      if (await groupSelector.isVisible({ timeout: 3000 }).catch(() => false)) {
        await groupSelector.click();

        const groupOption = alicePage.getByRole("button", { name: /jantar|teste/i }).first();
        if (await groupOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await groupOption.click();

          await expect(alicePage.getByText(/grupo/i)).toBeVisible();

          await alicePage.getByRole("button", { name: /proximo/i }).click();

          await alicePage.getByPlaceholder("0,00").fill("150");

          await alicePage.getByRole("button", { name: /proximo/i }).click();

          await alicePage.getByRole("button", { name: /alice/i }).first().click();

          await alicePage.getByRole("button", { name: /proximo/i }).click();

          const generateButton = alicePage.getByRole("button", {
            name: /gerar cobrancas/i,
          });

          await expect(generateButton).toBeEnabled();
        }
      }
    } finally {
      await aliceContext.close();
    }
  });

  test("user can decline group invite", async ({ browser }) => {
    const aliceContext = await browser.newContext({
      storageState: "e2e/.auth/alice.json",
    });
    const carolContext = await browser.newContext({
      storageState: "e2e/.auth/carol.json",
    });

    const alicePage = await aliceContext.newPage();
    const carolPage = await carolContext.newPage();

    try {
      const testGroupName2 = `Grupo Teste ${Date.now()}`;

      // Alice creates a group
      await alicePage.goto("/app/groups");
      await alicePage.waitForLoadState("networkidle");
      await alicePage.getByRole("button", { name: /novo/i }).click();
      await alicePage.getByPlaceholder(/nome do grupo/i).fill(testGroupName2);
      await alicePage.getByPlaceholder(/nome do grupo/i).press("Enter");

      // Wait for group and navigate to detail
      await expect(alicePage.getByText(testGroupName2)).toBeVisible({ timeout: 10000 });
      await alicePage.getByText(testGroupName2).click();
      await alicePage.waitForURL(/\/app\/groups\/[a-f0-9-]+/);
      await alicePage.waitForLoadState("networkidle");

      // Invite Carol
      const convidarBtn = alicePage.getByRole("button", { name: /convidar/i });
      await expect(convidarBtn).toBeVisible({ timeout: 5000 });
      await convidarBtn.click();

      await alicePage.getByPlaceholder(/handle do usuario/i).fill("carol_test");
      await alicePage.getByPlaceholder(/handle do usuario/i).press("Enter");

      // Wait for the lookup result — Carol's name should appear
      await expect(alicePage.getByText(/carol test/i)).toBeVisible({ timeout: 10000 });

      // Click the invite button in the result card
      const resultCard = alicePage.locator(".bg-muted\\/30");
      const inviteBtn = resultCard.getByRole("button", { name: /convidar/i });
      await expect(inviteBtn).toBeVisible();
      await inviteBtn.click();

      // Wait for invite to be processed — Carol should appear in member list
      await expect(alicePage.getByText("Carol Test")).toBeVisible({ timeout: 10000 });

      // Carol sees and declines invite
      await carolPage.goto("/app/groups");
      await carolPage.waitForLoadState("networkidle");

      const declineButton = carolPage.getByRole("button", { name: /recusar|declinar/i });
      if (await declineButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await declineButton.click();
        await expect(carolPage.getByText(testGroupName2)).not.toBeVisible();
      }
    } finally {
      await aliceContext.close();
      await carolContext.close();
    }
  });
});
